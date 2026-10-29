"""
MIS module — report & dashboard catalog, per-user access, enforcement and audit.

How a developer adds a report/dashboard (no DB entry, no change to user management):
  * Table report:   decorate a function with @report(code=..., name=..., category=...) below (or in any module
                    imported by main.py). It returns {"columns": [...], "rows": [...]}; the catalog row is created
                    automatically at the next startup and it appears in the admin's access picker.
  * Dashboard/page: call register_item(...) with item_type="dashboard" and the frontend component key.
  * Any other API that serves a report: protect it with Depends(require_catalog_access("<code>")).

Rules enforced here (on the server, never only in the UI):
  * role "mis_user" may use only items that are Active AND (mis_access_all OR explicitly assigned); otherwise 403.
  * admin may use everything; every other role gets 403 on MIS-only endpoints.
  * assignments / revocations and every MIS access are written to append-only log tables.
  * the per-user allowed-code set is cached for a short time and invalidated when assignments or item status change.
"""
import datetime
import threading
import time
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from . import models as m
from .auth import audit, get_current_user, require_role
from .db import SessionLocal, get_db

MIS_ROLE = "mis_user"
router = APIRouter(prefix="/api/mis", tags=["MIS"])

# --------------------------------------------------------------------------------------
# Registry (the "registration config"): code-owned definition of every report / dashboard
# --------------------------------------------------------------------------------------

CATALOG_REGISTRY: dict[str, dict] = {}
REPORT_HANDLERS: dict[str, Callable] = {}
_scope_fn: Optional[Callable] = None  # set by main.py: (db, user) -> Query of the surveys this user may see


def set_scope(fn: Callable) -> None:
    global _scope_fn
    _scope_fn = fn


def register_item(*, code: str, name: str, item_type: str, category: str = "General", description: str = "",
                  route: Optional[str] = None, component: str = "GenericReport", display_order: int = 100) -> None:
    if item_type not in ("report", "dashboard"):
        raise ValueError("item_type must be 'report' or 'dashboard'")
    CATALOG_REGISTRY[code] = {
        "code": code, "name": name, "item_type": item_type, "category": category, "description": description,
        "route": route or f"/mis/view/{code}", "component": component, "display_order": display_order,
    }


def report(*, code: str, name: str, category: str, description: str = "", display_order: int = 100, dashboard: bool = False):
    """Decorator: register a table report/dashboard and its data function in one step."""
    def deco(fn: Callable) -> Callable:
        register_item(code=code, name=name, item_type="dashboard" if dashboard else "report", category=category,
                      description=description, display_order=display_order)
        REPORT_HANDLERS[code] = fn
        return fn
    return deco


# Built-in items that wrap pages/APIs the app already has.
register_item(code="dash.programme", name="Programme Dashboard", item_type="dashboard", category="Programme Overview",
              description="Headline KPIs, district coverage, seasonality and yield estimator.",
              component="ProgrammeDashboard", display_order=10)
register_item(code="rpt.plots_map", name="Plots Registry Map", item_type="report", category="Geo & Plots",
              description="Plot boundaries and GPS points on a Karnataka map.", component="PlotsMap", display_order=20)


def sync_catalog() -> dict:
    """Upsert the registry into catalog_item. New code -> inserted Active. Existing -> code-owned fields refreshed,
    admin-owned fields (status, display_order) left alone. Codes no longer in the registry are retired (inactive)."""
    db = SessionLocal()
    try:
        existing = {i.code: i for i in db.query(m.CatalogItem).all()}
        added = updated = retired = 0
        for code, meta in CATALOG_REGISTRY.items():
            row = existing.get(code)
            if row is None:
                db.add(m.CatalogItem(**meta, status="active", registered=True))
                added += 1
            else:
                for k in ("name", "item_type", "category", "description", "route", "component"):
                    if getattr(row, k) != meta[k]:
                        setattr(row, k, meta[k]); updated += 1
                row.registered = True
        for code, row in existing.items():
            if code not in CATALOG_REGISTRY and row.registered:
                row.registered = False
                row.status = "inactive"
                retired += 1
        db.commit()
        invalidate()
        return {"added": added, "updated": updated, "retired": retired, "total": len(CATALOG_REGISTRY)}
    finally:
        db.close()


# --------------------------------------------------------------------------------------
# Permission cache (short TTL + explicit invalidation)
# --------------------------------------------------------------------------------------

CACHE_TTL_SECONDS = 30
_cache: dict[int, tuple[float, frozenset]] = {}
_cache_lock = threading.Lock()
_last_access_log: dict[tuple[int, str], float] = {}
ACCESS_LOG_DEDUPE_SECONDS = 60


def invalidate(user_id: Optional[int] = None) -> None:
    with _cache_lock:
        if user_id is None:
            _cache.clear()
        else:
            _cache.pop(user_id, None)


def allowed_codes(db: Session, user: m.User) -> frozenset:
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(user.id)
        if hit and hit[0] > now:
            return hit[1]
    q = db.query(m.CatalogItem.code).filter(m.CatalogItem.status == "active", m.CatalogItem.registered.is_(True))
    if not user.mis_access_all:
        q = q.join(m.UserCatalogAccess, m.UserCatalogAccess.item_id == m.CatalogItem.id).filter(m.UserCatalogAccess.user_id == user.id)
    codes = frozenset(c for (c,) in q.all())
    with _cache_lock:
        _cache[user.id] = (now + CACHE_TTL_SECONDS, codes)
    return codes


def _device(request: Request) -> Optional[str]:
    raw = (request.headers.get("x-device-id") or "").strip()[:100]
    return raw or None


def _ip(request: Request) -> Optional[str]:
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else None)


def authorize(db: Session, request: Request, user: m.User, code: str, *, log: bool = True) -> None:
    """Raise 403 unless this user may open catalog item `code`; log MIS users' access."""
    if user.role == "admin":
        return
    if user.role != MIS_ROLE or code not in allowed_codes(db, user):
        raise HTTPException(status_code=403, detail="You do not have access to this report or dashboard.")
    if log:
        key = (user.id, code)
        now = time.monotonic()
        if now - _last_access_log.get(key, 0) >= ACCESS_LOG_DEDUPE_SECONDS:
            _last_access_log[key] = now
            db.add(m.CatalogAccessLog(user_id=user.id, username=user.username, item_code=code, ip_address=_ip(request), device_id=_device(request)))
            db.commit()


def require_catalog_access(code: str):
    """Dependency for any API that serves catalog item `code` (MIS users need the assignment; admin always passes)."""
    def dependency(request: Request, db: Session = Depends(get_db), user: m.User = Depends(get_current_user)) -> m.User:
        authorize(db, request, user, code)
        return user
    return dependency


def dashboard_viewer(code: str):
    """For endpoints that already served every logged-in user: unchanged for existing roles, but an MIS user
    additionally needs the catalog assignment for `code`."""
    def dependency(request: Request, db: Session = Depends(get_db), user: m.User = Depends(get_current_user)) -> m.User:
        if user.role == MIS_ROLE:
            authorize(db, request, user, code)
        return user
    return dependency


def permission_or_catalog(permission: str, code: str):
    """Existing module permission for normal users; the catalog assignment for MIS users."""
    def dependency(request: Request, db: Session = Depends(get_db), user: m.User = Depends(get_current_user)) -> m.User:
        if user.role == MIS_ROLE:
            authorize(db, request, user, code)
        elif user.role != "admin" and permission not in (user.permissions or "").split(","):
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")
        return user
    return dependency


def reject_mis(user: m.User = Depends(get_current_user)) -> m.User:
    """For data endpoints that only apply to record-keeping roles."""
    if user.role == MIS_ROLE:
        raise HTTPException(status_code=403, detail="MIS users can only open their assigned reports and dashboards.")
    return user


# --------------------------------------------------------------------------------------
# Assignment (shared by user create/edit, bulk and copy) with audit logging
# --------------------------------------------------------------------------------------

def _log(db: Session, actor: m.User, target: m.User, action: str, item_code: Optional[str] = None, note: Optional[str] = None) -> None:
    db.add(m.CatalogAssignmentLog(actor_user_id=actor.id, actor_username=actor.username, target_user_id=target.id,
                                  target_username=target.username, item_code=item_code, action=action, note=note))


def apply_access(db: Session, actor: m.User, target: m.User, *, mis_access_all: Optional[bool] = None,
                 item_ids: Optional[list] = None, districts: Optional[list] = None, mode: str = "replace") -> None:
    """Change what `target` (an MIS user) may open. Flushes only — the caller commits."""
    if mis_access_all is not None and bool(target.mis_access_all) != bool(mis_access_all):
        target.mis_access_all = bool(mis_access_all)
        _log(db, actor, target, "all_on" if mis_access_all else "all_off",
             note="all current and future reports/dashboards" if mis_access_all else None)

    if item_ids is not None:
        wanted = set(item_ids)
        items = {i.id: i for i in db.query(m.CatalogItem).filter(m.CatalogItem.id.in_(wanted))} if wanted else {}
        if len(items) != len(wanted):
            raise HTTPException(status_code=400, detail="One or more selected reports/dashboards do not exist.")
        current = {l.item_id: l for l in target.catalog_links}
        if mode == "add":
            to_add, to_remove = wanted - set(current), set()
        elif mode == "remove":
            to_add, to_remove = set(), set(current) & wanted
        else:  # replace
            to_add, to_remove = wanted - set(current), set(current) - wanted
        for iid in to_add:
            target.catalog_links.append(m.UserCatalogAccess(item_id=iid, assigned_by_user_id=actor.id))
            _log(db, actor, target, "grant", items[iid].code)
        removed_codes = {i.id: i.code for i in db.query(m.CatalogItem).filter(m.CatalogItem.id.in_(to_remove))} if to_remove else {}
        for iid in to_remove:
            target.catalog_links.remove(current[iid])
            _log(db, actor, target, "revoke", removed_codes.get(iid))

    if districts is not None:
        valid = {n for (n,) in db.query(m.District.name).all()}
        bad = [d for d in districts if d not in valid]
        if bad:
            raise HTTPException(status_code=400, detail=f"Unknown district(s): {', '.join(bad)}")
        new_value = ",".join(sorted(set(districts))) or None
        if new_value != (target.data_scope_districts or None):
            target.data_scope_districts = new_value
            _log(db, actor, target, "scope", note=new_value or "all districts")
    db.flush()
    invalidate(target.id)


def clear_access(db: Session, actor: m.User, target: m.User) -> None:
    """Used when a user stops being an MIS user."""
    apply_access(db, actor, target, mis_access_all=False, item_ids=[], districts=[])


# --------------------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------------------

def _item_dict(i: m.CatalogItem) -> dict:
    return {"id": i.id, "code": i.code, "name": i.name, "item_type": i.item_type, "category": i.category,
            "description": i.description, "route": i.route, "component": i.component, "status": i.status,
            "display_order": i.display_order, "registered": i.registered, "created_at": i.created_at}


@router.get("/my-menu")
def my_menu(request: Request, db: Session = Depends(get_db), user: m.User = Depends(get_current_user)):
    """The reports and dashboards this user may open — exactly the menu an MIS user sees."""
    if user.role not in (MIS_ROLE, "admin"):
        raise HTTPException(status_code=403, detail="Not permitted for this role")
    q = db.query(m.CatalogItem).filter(m.CatalogItem.status == "active", m.CatalogItem.registered.is_(True))
    if user.role == MIS_ROLE:
        codes = allowed_codes(db, user)
        q = q.filter(m.CatalogItem.code.in_(codes)) if codes else q.filter(False)
    items = q.order_by(m.CatalogItem.category, m.CatalogItem.display_order, m.CatalogItem.name).all()
    return {"items": [_item_dict(i) for i in items], "scope_districts": user.data_scope_district_list, "all_access": bool(user.mis_access_all)}


@router.get("/catalog")
def list_catalog(
    response: Response,
    status: Optional[str] = Query(None, pattern="^(active|inactive)$"),
    item_type: Optional[str] = Query(None, pattern="^(report|dashboard)$"),
    q: Optional[str] = Query(None, max_length=100),
    db: Session = Depends(get_db),
    admin: m.User = Depends(require_role("admin")),
):
    query = db.query(m.CatalogItem)
    if status:
        query = query.filter(m.CatalogItem.status == status)
    if item_type:
        query = query.filter(m.CatalogItem.item_type == item_type)
    if q:
        like = f"%{q}%"
        query = query.filter(m.CatalogItem.name.ilike(like) | m.CatalogItem.code.ilike(like) | m.CatalogItem.category.ilike(like))
    rows = query.order_by(m.CatalogItem.category, m.CatalogItem.display_order, m.CatalogItem.name).all()
    counts = dict(db.query(m.UserCatalogAccess.item_id, func.count(m.UserCatalogAccess.id)).group_by(m.UserCatalogAccess.item_id).all())
    response.headers["X-Total-Count"] = str(len(rows))
    return [{**_item_dict(i), "assigned_users": counts.get(i.id, 0)} for i in rows]


class CatalogPatch(BaseModel):
    status: Optional[str] = Field(None, pattern="^(active|inactive)$")
    display_order: Optional[int] = Field(None, ge=0, le=100000)


@router.patch("/catalog/{item_id}")
def patch_catalog_item(item_id: int, payload: CatalogPatch, request: Request, db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    item = db.query(m.CatalogItem).get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    if payload.status is not None:
        if payload.status == "active" and not item.registered:
            raise HTTPException(status_code=400, detail="This item was removed from the application and cannot be activated.")
        item.status = payload.status
    if payload.display_order is not None:
        item.display_order = payload.display_order
    db.commit()
    invalidate()
    audit(db, request, "catalog_item_update", user=admin, resource=f"catalog:{item.code}", detail=f"status={item.status} order={item.display_order}")
    return _item_dict(item)


@router.post("/catalog/sync")
def sync_now(request: Request, db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    result = sync_catalog()
    audit(db, request, "catalog_sync", user=admin, detail=str(result))
    return result


class AccessIn(BaseModel):
    mis_access_all: Optional[bool] = None
    item_ids: Optional[list[int]] = Field(None, max_length=2000)
    data_scope_districts: Optional[list[str]] = Field(None, max_length=50)


def _mis_target(db: Session, user_id: int) -> m.User:
    u = db.query(m.User).get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.role != MIS_ROLE:
        raise HTTPException(status_code=400, detail="This user does not have the MIS User role.")
    return u


@router.get("/users/{user_id}/access")
def get_user_access(user_id: int, db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    u = _mis_target(db, user_id)
    return {"mis_access_all": bool(u.mis_access_all), "item_ids": u.catalog_item_ids, "data_scope_districts": u.data_scope_district_list}


@router.put("/users/{user_id}/access")
def put_user_access(user_id: int, payload: AccessIn, request: Request, db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    u = _mis_target(db, user_id)
    apply_access(db, admin, u, mis_access_all=payload.mis_access_all, item_ids=payload.item_ids, districts=payload.data_scope_districts)
    db.commit()
    audit(db, request, "mis_access_update", user=admin, resource=f"user:{u.id}")
    return {"mis_access_all": bool(u.mis_access_all), "item_ids": u.catalog_item_ids, "data_scope_districts": u.data_scope_district_list}


class BulkIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=500)
    item_ids: list[int] = Field(min_length=1, max_length=2000)
    mode: str = Field("add", pattern="^(add|remove|replace)$")


@router.post("/access/bulk")
def bulk_access(payload: BulkIn, request: Request, db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    users = db.query(m.User).filter(m.User.id.in_(payload.user_ids), m.User.role == MIS_ROLE).all()
    if len(users) != len(set(payload.user_ids)):
        raise HTTPException(status_code=400, detail="Every selected user must have the MIS User role.")
    for u in users:
        apply_access(db, admin, u, item_ids=payload.item_ids, mode=payload.mode)
    db.commit()
    audit(db, request, "mis_access_bulk", user=admin, detail=f"{payload.mode} {len(payload.item_ids)} item(s) for {len(users)} user(s)")
    return {"ok": True, "users": len(users)}


@router.post("/users/{user_id}/copy-from/{source_id}")
def copy_access(user_id: int, source_id: int, request: Request, db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    target, source = _mis_target(db, user_id), _mis_target(db, source_id)
    apply_access(db, admin, target, mis_access_all=bool(source.mis_access_all), item_ids=source.catalog_item_ids, districts=source.data_scope_district_list)
    db.commit()
    audit(db, request, "mis_access_copy", user=admin, resource=f"user:{target.id}", detail=f"copied from {source.username}")
    return {"mis_access_all": bool(target.mis_access_all), "item_ids": target.catalog_item_ids, "data_scope_districts": target.data_scope_district_list}


def _paged(query, response: Response, limit: int, offset: int):
    response.headers["X-Total-Count"] = str(query.order_by(None).count())
    return query.offset(offset).limit(limit).all()


@router.get("/logs/access")
def access_log(response: Response, user_id: Optional[int] = None, item_code: Optional[str] = None,
               date_from: Optional[datetime.date] = None, date_to: Optional[datetime.date] = None,
               limit: int = Query(20, ge=1, le=200), offset: int = Query(0, ge=0),
               db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    q = db.query(m.CatalogAccessLog)
    if user_id:
        q = q.filter(m.CatalogAccessLog.user_id == user_id)
    if item_code:
        q = q.filter(m.CatalogAccessLog.item_code == item_code)
    if date_from:
        q = q.filter(m.CatalogAccessLog.timestamp >= datetime.datetime.combine(date_from, datetime.time.min))
    if date_to:
        q = q.filter(m.CatalogAccessLog.timestamp < datetime.datetime.combine(date_to + datetime.timedelta(days=1), datetime.time.min))
    rows = _paged(q.order_by(m.CatalogAccessLog.id.desc()), response, limit, offset)
    return [{"id": r.id, "timestamp": r.timestamp, "user_id": r.user_id, "username": r.username, "item_code": r.item_code, "ip_address": r.ip_address, "device_id": r.device_id} for r in rows]


@router.get("/logs/assignments")
def assignment_log(response: Response, target_user_id: Optional[int] = None, item_code: Optional[str] = None,
                   limit: int = Query(20, ge=1, le=200), offset: int = Query(0, ge=0),
                   db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    q = db.query(m.CatalogAssignmentLog)
    if target_user_id:
        q = q.filter(m.CatalogAssignmentLog.target_user_id == target_user_id)
    if item_code:
        q = q.filter(m.CatalogAssignmentLog.item_code == item_code)
    rows = _paged(q.order_by(m.CatalogAssignmentLog.id.desc()), response, limit, offset)
    return [{"id": r.id, "timestamp": r.timestamp, "actor": r.actor_username, "target_user_id": r.target_user_id, "target": r.target_username,
             "item_code": r.item_code, "action": r.action, "note": r.note} for r in rows]


@router.get("/reports/{code}")
def report_data(code: str, request: Request, db: Session = Depends(get_db), user: m.User = Depends(get_current_user)):
    handler = REPORT_HANDLERS.get(code)
    if handler is None:
        raise HTTPException(status_code=404, detail="Report not found")
    authorize(db, request, user, code)
    item = db.query(m.CatalogItem).filter(m.CatalogItem.code == code).first()
    if item is None or item.status != "active":
        raise HTTPException(status_code=403, detail="This report is not currently available.")
    out = handler(db, user)
    out["generated_at"] = datetime.datetime.utcnow().isoformat()
    out["scope_districts"] = user.data_scope_district_list
    return out


# --------------------------------------------------------------------------------------
# Built-in table reports (examples of the @report registration; add new ones the same way)
# --------------------------------------------------------------------------------------

def _surveys(db: Session, user: m.User):
    if _scope_fn is None:  # pragma: no cover - set at startup by main.py
        raise HTTPException(status_code=500, detail="Report scope is not configured.")
    return _scope_fn(db, user)


@report(code="rpt.district_coverage", name="District & Taluka Coverage", category="Coverage", display_order=30,
        description="Farmers surveyed and areca area by district and taluka.")
def district_coverage(db: Session, user: m.User) -> dict:
    F = m.FarmerSurvey
    rows = (_surveys(db, user).filter(F.district.isnot(None))
            .with_entities(F.district, F.taluka, func.count(F.id), func.coalesce(func.sum(F.areca_area_acres), 0.0),
                           func.sum(case((F.status == "draft", 1), else_=0)))
            .group_by(F.district, F.taluka).order_by(F.district, F.taluka).all())
    data = [{"district": d, "taluka": t or "—", "farmers": n, "areca_area_acres": round(float(a), 2), "drafts": int(dr or 0)} for d, t, n, a, dr in rows]
    return {"title": "District & Taluka Coverage",
            "columns": [{"key": "district", "label": "District", "type": "text"}, {"key": "taluka", "label": "Taluka", "type": "text"},
                        {"key": "farmers", "label": "Farmers", "type": "number"}, {"key": "areca_area_acres", "label": "Areca area (acres)", "type": "number"},
                        {"key": "drafts", "label": "Of which drafts", "type": "number"}],
            "rows": data,
            "summary": {"farmers": sum(r["farmers"] for r in data), "areca_area_acres": round(sum(r["areca_area_acres"] for r in data), 2)}}


@report(code="rpt.survey_status", name="Survey Status Summary", category="Data Quality", display_order=40,
        description="Submitted, draft and frozen (verified) surveys by district.")
def survey_status(db: Session, user: m.User) -> dict:
    F = m.FarmerSurvey
    rows = (_surveys(db, user)
            .with_entities(func.coalesce(F.district, "(not entered)"), func.count(F.id),
                           func.sum(case((F.status == "draft", 1), else_=0)),
                           func.sum(case((F.is_frozen.is_(True), 1), else_=0)))
            .group_by(func.coalesce(F.district, "(not entered)")).order_by(func.count(F.id).desc()).all())
    data = [{"district": d, "total": n, "submitted": n - int(dr or 0), "drafts": int(dr or 0), "frozen": int(fr or 0)} for d, n, dr, fr in rows]
    return {"title": "Survey Status Summary",
            "columns": [{"key": "district", "label": "District", "type": "text"}, {"key": "total", "label": "Total", "type": "number"},
                        {"key": "submitted", "label": "Submitted", "type": "number"}, {"key": "drafts", "label": "Drafts", "type": "number"},
                        {"key": "frozen", "label": "Frozen (verified)", "type": "number"}],
            "rows": data,
            "summary": {"total": sum(r["total"] for r in data), "frozen": sum(r["frozen"] for r in data)}}
