"""
Client User role: external organisations that commission surveys.

A client user (role "client") may only reach /api/client/* (enforced for the whole
API in auth.get_current_user). Inside it, three layers apply to every request:

  1. Module guard   - the module must be granted to the client group (client_module rows),
                      optionally overridden per user (client_user_module). 403 otherwise.
  2. Scope filter   - every query starts from scoped_query(): submitted surveys only, limited to the
                      client's districts / talukas / survey years. No scope row type = unrestricted on
                      that axis; a client with no scope rows at all is unrestricted, a user without a
                      client (or an inactive client) sees nothing.
  3. Field masking  - responses are built from explicit allowlists (LIST_FIELDS / DETAIL_GROUPS), then
                      passed through scrub() which strips any BANNED key, so a future code slip cannot
                      leak them. Sorting / filtering / searching only accept allowlisted columns.

Modules are declared in CLIENT_MODULES (code registry); the admin assignment screen reads that registry,
so a module added here appears there with no change to user management.
"""
import datetime
import io
import threading
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, event, false, func, or_
from sqlalchemy.orm import Session

from . import models as m
from .auth import CLIENT_ROLE, get_current_user, hash_password, require_role, validate_password_strength, audit
from .db import get_db

router = APIRouter(prefix="/api/client", tags=["Client"])
F = m.FarmerSurvey

# --------------------------------------------------------------------------------------
# Module registry
# --------------------------------------------------------------------------------------

CLIENT_MODULES: dict[str, dict] = {}


def register_client_module(code: str, label: str, description: str, route: str, order: int = 100) -> None:
    CLIENT_MODULES[code] = {"code": code, "label": label, "description": description, "route": route, "order": order}


register_client_module("client_dashboard", "Dashboard", "KPI dashboard with drill-down by geography and society / FPC.", "/client", 10)
register_client_module("client_farmer_records", "View Farmer Records", "Read-only list and profile of the farmers in the client's scope.", "/client/farmers", 20)
register_client_module("client_export", "Export to Excel", "Download the current dashboard view or farmer list (same masking applies).", "", 30)

# --------------------------------------------------------------------------------------
# Field masking
# --------------------------------------------------------------------------------------

# Never shown or returned to a client user, anywhere. (Internal ids and other personal / operational fields are
# kept out by the allowlists below as well; this set is the hard backstop applied to every response.)
BANNED = frozenset({
    "mobile_no", "mobile", "mobile_verified", "created_by", "created_by_user_id", "created_on", "created_at", "entry_timestamp",
    "device_id", "created_from_device", "last_modified_by", "last_modified_by_user_id", "last_modified_on", "last_modified_at",
    "last_modified_device_id", "last_modified_from_device", "enumerator_name", "assigned_to_user_id", "client_uuid",
    "aadhaar_no", "guardian_name", "geo_lat", "geo_long", "field_photo", "plot_boundary", "frozen_by_user_id", "frozen_at", "is_frozen",
})

LIST_FIELDS = [
    "farmer_id", "farmer_name", "gender", "age", "village", "taluka", "district", "society_assoc", "society_name",
    "credit_linkage", "credit_source", "land_holding_acres", "areca_area_acres", "areca_plant_count",
    "marketing_channel", "sale_type", "survey_year",
]
LIST_LABELS = {
    "farmer_id": "Farmer ID", "farmer_name": "Farmer name", "gender": "Gender", "age": "Age", "village": "Village",
    "taluka": "Taluk", "district": "District", "society_assoc": "Society / FPC linked", "society_name": "Society / FPC",
    "credit_linkage": "Credit linked", "credit_source": "Credit source", "land_holding_acres": "Land holding (own, ac)",
    "areca_area_acres": "Areca area (ac)", "areca_plant_count": "Tree count", "marketing_channel": "Marketing channel",
    "sale_type": "Sale type", "survey_year": "Survey year",
}
DETAIL_GROUPS = {
    "Personal": ["farmer_id", "farmer_name", "gender", "age"],
    "Location": ["village", "taluka", "district"],
    "Society / FPC": ["society_assoc", "society_name", "society_since_year", "society_benefits", "society_benefits_other"],
    "Land": ["land_own_acres", "land_leased_acres", "land_holding_acres", "areca_area_acres", "areca_plant_count",
             "organic_farming", "organic_certified", "intercropping", "intercrop_crops", "intercrop_crops_other", "intercrop_area_acres",
             "irrigation_source", "soil_test_done", "crop_insurance"],
    "Crop & production": ["cultivation_cost_inr", "yield_raw_qtl", "yield_processed_qtl", "crop2_name", "crop2_area_acres", "crop2_yield",
                          "crop3_name", "crop3_area_acres", "crop3_yield"],
    "Credit": ["credit_linkage", "credit_source", "credit_source_other", "credit_amount_inr", "credit_interest_rate_pct",
               "credit_repayment_months", "credit_outstanding_inr_lakh", "kcc_account", "kcc_limit_inr_lakh", "bank_account"],
    "Marketing": ["sale_type", "marketing_channel", "marketing_channel_detail", "rate_inr_per_kg", "total_income_inr", "sale_month",
                  "grading_done", "storage_duration_months", "storage_source", "logistics_provider", "logistics_cost_inr_per_qtl"],
    "Challenges": ["cultivation_challenges", "cultivation_challenges_other", "input_challenges", "irrigation_challenges"],
    "Survey": ["survey_year", "status"],
}
SORTABLE = {
    "farmer_id": F.farmer_id, "farmer_name": F.farmer_name, "village": F.village, "taluka": F.taluka, "district": F.district,
    "society_name": F.society_name, "areca_plant_count": F.areca_plant_count, "areca_area_acres": F.areca_area_acres,
    "survey_year": F.survey_year,
}
LAND_EXPR = F.land_own_acres  # land holding = the farmer's own land (leased land is shown separately in the profile)
SORTABLE["land_holding_acres"] = LAND_EXPR


def scrub(obj):
    """Recursively drop every banned key from a response body (defence in depth)."""
    if isinstance(obj, dict):
        return {k: scrub(v) for k, v in obj.items() if str(k).lower() not in BANNED}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    return obj


def _val(s: F, field: str):
    if field == "land_holding_acres":
        return None if s.land_own_acres is None else round(s.land_own_acres, 2)
    return getattr(s, field, None)


def list_row(s: F, columns: list[str]) -> dict:
    return {c: _val(s, c) for c in columns}


def detail_body(s: F) -> dict:
    return {g: {f: _val(s, f) for f in fields} for g, fields in DETAIL_GROUPS.items()}


# --------------------------------------------------------------------------------------
# Access context: client, effective modules, scope
# --------------------------------------------------------------------------------------

def _client_of(db: Session, user: m.User) -> Optional[m.ClientOrg]:
    if user.role != CLIENT_ROLE or not user.client_id:
        return None
    org = db.query(m.ClientOrg).get(user.client_id)
    return org if org and org.is_active else None


def effective_modules(db: Session, user: m.User) -> set:
    org = _client_of(db, user)
    if not org:
        return set()
    mods = {c.module_code for c in org.modules}
    for o in db.query(m.ClientUserModule).filter(m.ClientUserModule.user_id == user.id).all():
        (mods.add if o.granted else mods.discard)(o.module_code)
    return {c for c in mods if c in CLIENT_MODULES}


def apply_user_client(db: Session, user: m.User, client_id: Optional[int], module_codes: Optional[list]) -> None:
    """Attach a client user to an organisation and store the per-user module difference against the group's grants."""
    org = db.query(m.ClientOrg).get(client_id) if client_id else None
    if not org:
        raise HTTPException(status_code=400, detail="Select the client organisation for this user.")
    bad = [c for c in (module_codes or []) if c not in CLIENT_MODULES]
    if bad:
        raise HTTPException(status_code=400, detail=f"Unknown module: {bad[0]}")
    user.client_id = org.id
    user.client_org = org
    user.client_overrides = []
    if module_codes is not None:
        group = {c.module_code for c in org.modules}
        want = set(module_codes)
        user.client_overrides = ([m.ClientUserModule(module_code=c, granted=True) for c in sorted(want - group)]
                                 + [m.ClientUserModule(module_code=c, granted=False) for c in sorted(group - want)])


def clear_user_client(user: m.User) -> None:
    user.client_id = None
    user.client_overrides = []


def log_access(db: Session, request: Request, user: m.User, action: str, farmer_id: Optional[str] = None, detail: Optional[str] = None) -> None:
    db.add(m.ClientAccessLog(user_id=user.id, client_id=user.client_id, action=action, farmer_id=farmer_id, detail=(detail or "")[:500] or None,
                             ip_address=request.client.host if request.client else None))
    db.commit()


def client_module(code: str, writes: bool = False):
    """Dependency: authenticated client user holding `code`. Client users are strictly read-only."""
    def dep(request: Request, db: Session = Depends(get_db), user: m.User = Depends(get_current_user)) -> m.User:
        if user.role != CLIENT_ROLE:
            raise HTTPException(status_code=403, detail="Client users only.")
        if request.method not in ("GET", "HEAD"):
            raise HTTPException(status_code=403, detail="Client users have read-only access.")
        if code not in effective_modules(db, user):
            log_access(db, request, user, "denied", detail=f"module {code}")
            raise HTTPException(status_code=403, detail="This module is not assigned to your account.")
        return user
    return dep


def scope_values(org: m.ClientOrg, scope_type: str) -> list[str]:
    return [s.value for s in org.scopes if s.scope_type == scope_type]


def scoped_query(db: Session, user: m.User):
    """Submitted surveys inside the client's scope. The ONLY entry point for client data queries."""
    org = _client_of(db, user)
    q = db.query(F)
    if not org:
        return q.filter(false())
    q = q.filter(or_(F.status.is_(None), F.status == "submitted"))
    d, t, y = scope_values(org, "district"), scope_values(org, "taluka"), scope_values(org, "survey_year")
    if d:
        q = q.filter(F.district.in_(d))
    if t:
        q = q.filter(F.taluka.in_(t))
    if y:
        q = q.filter(F.survey_year.in_([int(v) for v in y if v.isdigit()]))
    return q


# --------------------------------------------------------------------------------------
# Filters (shared by dashboard, drill-down, list and export)
# --------------------------------------------------------------------------------------

class Filters(BaseModel):
    district: Optional[str] = None
    taluka: Optional[str] = None
    village: Optional[str] = None
    society: Optional[str] = None
    crop: Optional[str] = None
    year_from: Optional[int] = None
    year_to: Optional[int] = None


def filters_dep(district: Optional[str] = None, taluka: Optional[str] = None, village: Optional[str] = None, society: Optional[str] = None,
                crop: Optional[str] = None, year_from: Optional[int] = None, year_to: Optional[int] = None) -> Filters:
    return Filters(district=district, taluka=taluka, village=village, society=society, crop=crop, year_from=year_from, year_to=year_to)


def apply_filters(q, f: Filters):
    if f.district:
        q = q.filter(F.district == f.district)
    if f.taluka:
        q = q.filter(F.taluka == f.taluka)
    if f.village:
        q = q.filter(F.village == f.village)
    if f.society:
        q = q.filter(F.society_name == f.society)
    if f.crop:
        q = q.filter(or_(F.crop2_name == f.crop, F.crop3_name == f.crop))
    if f.year_from is not None:
        q = q.filter(F.survey_year >= f.year_from)
    if f.year_to is not None:
        q = q.filter(F.survey_year <= f.year_to)
    return q


def _like_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _contains_item(col, item: str):
    """Comma-separated multi-value column contains exactly `item`."""
    return or_(col == item, col.like(_like_escape(item) + ",%", escape="\\"), col.like("%," + _like_escape(item), escape="\\"),
               col.like("%," + _like_escape(item) + ",%", escape="\\"))


# --------------------------------------------------------------------------------------
# KPI definitions
# --------------------------------------------------------------------------------------

NOT_CAPTURED = "Not captured"
SALE_BUCKET = {"Sold raw areca": "Raw", "Sold processed areca": "Processed", "Sold both raw and processed areca": "Both raw and processed"}
BUCKET_SALE = {v: k for k, v in SALE_BUCKET.items()}

KPI_DEFS = [
    {"code": "farmers_surveyed", "title": "Farmers Surveyed", "kind": "count",
     "definition": "Count of farmers with a submitted (completed) survey in scope. Drafts are never counted."},
    {"code": "society_linked", "title": "Society / FPC Linked", "kind": "share",
     "definition": "Farmers with society_assoc = Yes. % = linked / farmers with the answer captured."},
    {"code": "avg_yield", "title": "Average Yield per Acre", "kind": "ratio",
     "definition": "Sum of raw yield (qtl) / sum of areca area (acres), over farmers having both values. Same basis as the Programme Dashboard."},
    {"code": "credit_linked", "title": "Credit Linked", "kind": "share",
     "definition": "Farmers with credit_linkage = Yes. % = linked / farmers with the answer captured."},
    {"code": "marketing_channel", "title": "Marketing Channel Share", "kind": "dist",
     "definition": "Farmers by the channel they sell through (marketing_channel); % of farmers with a channel captured."},
    {"code": "raw_vs_processed", "title": "Raw vs Processed Sale Share", "kind": "dist",
     "definition": "Farmers by sale type: raw, processed, or both; % of farmers with a sale type captured."},
    {"code": "credit_source", "title": "Credit Source Mix", "kind": "dist",
     "definition": "Credit-linked farmers by credit source; % of credit-linked farmers with a source captured."},
    {"code": "challenges", "title": "Top Cultivation Challenges", "kind": "dist",
     "definition": "Farmers reporting each challenge (a farmer may report several, so shares exceed 100%); % of farmers with any challenge captured."},
    {"code": "avg_land", "title": "Average Farmer Land Holding", "kind": "mean",
     "definition": "Mean of the farmers' own land holding (land_own_acres) over farmers with it captured; leased land is not included."},
    {"code": "avg_leased", "title": "Average Leased Land", "kind": "mean",
     "definition": "Mean of land_leased_acres over farmers with it captured."},
    {"code": "avg_areca_area", "title": "Average Areca Area", "kind": "mean",
     "definition": "Mean of areca_area_acres (area under areca cultivation) over farmers with it captured."},
    {"code": "avg_trees", "title": "Average Tree Count", "kind": "mean",
     "definition": "Mean areca_plant_count over farmers with it captured."},
]
KPI_BY_CODE = {k["code"]: k for k in KPI_DEFS}

DIMS = {"state": None, "district": F.district, "taluka": F.taluka, "village": F.village, "society": F.society_name}
NEXT_LEVEL = {"state": "district", "district": "taluka", "taluka": "village", "village": None}


def _r(v, d=2):
    return None if v is None else round(float(v), d)


def _cat_col(kpi: str):
    return {"marketing_channel": F.marketing_channel, "raw_vs_processed": F.sale_type, "credit_source": F.credit_source}.get(kpi)


def apply_category(q, kpi: str, category: Optional[str]):
    """Restrict to one slice of a distribution KPI (used when drilling from a chart segment)."""
    if not category:
        return q
    if kpi == "challenges":
        return q.filter(_contains_item(F.cultivation_challenges, category))
    if kpi == "credit_source":
        q = q.filter(F.credit_linkage == "Yes")
    col = _cat_col(kpi)
    if kpi == "raw_vs_processed":
        return q.filter(F.sale_type == BUCKET_SALE.get(category, "\0")) if category != NOT_CAPTURED else q.filter(F.sale_type.is_(None))
    if col is None:
        raise HTTPException(status_code=400, detail="This KPI has no categories.")
    return q.filter(col.is_(None)) if category == NOT_CAPTURED else q.filter(col == category)


def _headline(kpi: str, rows) -> dict:
    """Aggregate row(s) from _agg_query -> {farmers, value, pct, n, not_captured}. `rows` is one tuple."""
    farmers, a, b = rows[0] or 0, rows[1], rows[2]
    n = rows[3] or 0
    kind = KPI_BY_CODE[kpi]["kind"]
    if kind == "count":
        return {"farmers": farmers, "value": farmers, "pct": None, "n": farmers, "not_captured": 0}
    if kind == "share":
        yes = int(a or 0)
        return {"farmers": farmers, "value": yes, "pct": round(100 * yes / n, 1) if n else None, "n": n, "not_captured": farmers - n}
    if kind == "ratio":
        return {"farmers": farmers, "value": round(a / b, 2) if b else None, "pct": None, "n": n, "not_captured": farmers - n}
    return {"farmers": farmers, "value": _r(a), "pct": None, "n": n, "not_captured": farmers - n}  # mean


def _agg_exprs(kpi: str):
    """(farmers, a, b, n) SQL expressions for the scalar KPIs."""
    farmers = func.count(F.id)
    if kpi == "farmers_surveyed":
        return farmers, None, None, farmers
    if kpi == "society_linked":
        return farmers, func.sum(case((F.society_assoc == "Yes", 1), else_=0)), None, func.sum(case((F.society_assoc.in_(["Yes", "No"]), 1), else_=0))
    if kpi == "credit_linked":
        return farmers, func.sum(case((F.credit_linkage == "Yes", 1), else_=0)), None, func.sum(case((F.credit_linkage.in_(["Yes", "No"]), 1), else_=0))
    if kpi == "avg_yield":
        ok = and_(F.yield_raw_qtl.isnot(None), F.areca_area_acres.isnot(None), F.areca_area_acres > 0)
        return (farmers, func.sum(case((ok, F.yield_raw_qtl), else_=0)), func.sum(case((ok, F.areca_area_acres), else_=0)),
                func.sum(case((ok, 1), else_=0)))
    if kpi == "avg_land":
        return farmers, func.avg(LAND_EXPR), None, func.count(LAND_EXPR)
    if kpi == "avg_trees":
        return farmers, func.avg(F.areca_plant_count), None, func.count(F.areca_plant_count)
    if kpi == "avg_leased":
        return farmers, func.avg(F.land_leased_acres), None, func.count(F.land_leased_acres)
    if kpi == "avg_areca_area":
        return farmers, func.avg(F.areca_area_acres), None, func.count(F.areca_area_acres)
    raise HTTPException(status_code=400, detail="Unknown KPI")


def _distribution(kpi: str, q, top: int) -> dict:
    """Category counts for a distribution KPI over query q (already scoped / filtered)."""
    farmers = q.count()
    if kpi == "challenges":
        counts: dict[str, int] = {}
        with_any = 0
        for (v,) in q.with_entities(F.cultivation_challenges).all():
            items = {p.strip() for p in (v or "").split(",") if p.strip()}
            if items:
                with_any += 1
            for it in items:
                counts[it] = counts.get(it, 0) + 1
        rows = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        base, nc = with_any, farmers - with_any
        rows = rows[:top]
    else:
        base_q = q.filter(F.credit_linkage == "Yes") if kpi == "credit_source" else q
        farmers = base_q.count()
        col = _cat_col(kpi)
        raw = base_q.with_entities(col, func.count(F.id)).group_by(col).all()
        merged: dict[str, int] = {}
        nc = 0
        for k, c in raw:
            if k is None or str(k).strip() == "":
                nc += c
                continue
            label = SALE_BUCKET.get(k, k) if kpi == "raw_vs_processed" else k
            merged[label] = merged.get(label, 0) + c
        rows = sorted(merged.items(), key=lambda kv: (-kv[1], kv[0]))
        base = farmers - nc
    return {"farmers": farmers, "n": base, "not_captured": nc,
            "items": [{"label": k, "farmers": c, "pct": round(100 * c / base, 1) if base else None} for k, c in rows]}


# --- tiny TTL cache, invalidated whenever any survey row changes ---------------------------------

_cache: dict = {}
_cache_lock = threading.Lock()
_data_version = 0
CACHE_TTL = 60


def _bump(*_args):
    global _data_version
    _data_version += 1


for _ev in ("after_insert", "after_update", "after_delete"):
    event.listen(F, _ev, _bump)


def cached(key: tuple, producer):
    k = (_data_version,) + key
    now = time.time()
    with _cache_lock:
        hit = _cache.get(k)
        if hit and now - hit[0] < CACHE_TTL:
            return hit[1]
        if len(_cache) > 500:
            _cache.clear()
    val = producer()
    with _cache_lock:
        _cache[k] = (now, val)
    return val


def invalidate_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _scope_key(db: Session, user: m.User) -> tuple:
    org = _client_of(db, user)
    return (org.id, tuple(sorted((s.scope_type, s.value) for s in org.scopes))) if org else (None,)


# --------------------------------------------------------------------------------------
# Endpoints: session info, filter options
# --------------------------------------------------------------------------------------

@router.get("/me")
def client_me(db: Session = Depends(get_db), user: m.User = Depends(get_current_user)):
    if user.role != CLIENT_ROLE:
        raise HTTPException(status_code=403, detail="Client users only.")
    org = _client_of(db, user)
    mods = effective_modules(db, user)
    return {
        "client": org.name if org else None,
        "modules": sorted([CLIENT_MODULES[c] for c in mods], key=lambda x: x["order"]),
        "scope": {t: scope_values(org, t) for t in ("district", "taluka", "survey_year")} if org else {},
    }


@router.get("/filters")
def filter_options(district: Optional[str] = None, taluka: Optional[str] = None, db: Session = Depends(get_db), user: m.User = Depends(get_current_user)):
    if user.role != CLIENT_ROLE or not (effective_modules(db, user) & {"client_dashboard", "client_farmer_records"}):
        raise HTTPException(status_code=403, detail="Not available.")
    q = scoped_query(db, user)

    def distinct(col, qq):
        return sorted(v for (v,) in qq.with_entities(col).distinct().all() if v not in (None, ""))

    years = [y for y in distinct(F.survey_year, q)]
    crops = sorted(set(distinct(F.crop2_name, q)) | set(distinct(F.crop3_name, q)))
    q_d = q.filter(F.district == district) if district else q
    q_t = q_d.filter(F.taluka == taluka) if taluka else q_d
    return {"districts": distinct(F.district, q), "talukas": distinct(F.taluka, q_d), "villages": distinct(F.village, q_t),
            "societies": distinct(F.society_name, q_t), "crops": crops, "years": years}


# --------------------------------------------------------------------------------------
# Dashboard + drill-down
# --------------------------------------------------------------------------------------

def _summary(db: Session, user: m.User, f: Filters, top: int) -> dict:
    q = apply_filters(scoped_query(db, user), f)
    out = {}
    for k in KPI_DEFS:
        code = k["code"]
        if k["kind"] == "dist":
            body = _distribution(code, q, top)
        else:
            ex = _agg_exprs(code)
            exprs = [e if e is not None else func.count(F.id) * 0 for e in ex]
            body = _headline(code, q.with_entities(*exprs).one())
        out[code] = {"title": k["title"], "kind": k["kind"], "definition": k["definition"], **body}
    return out


@router.get("/dashboard")
def dashboard(request: Request, top: int = Query(10, ge=1, le=25), f: Filters = Depends(filters_dep), db: Session = Depends(get_db),
              user: m.User = Depends(client_module("client_dashboard"))):
    body = cached(("dash", user.client_id, _scope_key(db, user), f.model_dump_json(), top), lambda: _summary(db, user, f, top))
    log_access(db, request, user, "dashboard", detail=f.model_dump_json(exclude_none=True))
    return scrub({"kpis": body, "not_captured_label": NOT_CAPTURED, "filters": f.model_dump(exclude_none=True)})


def _drill(db: Session, user: m.User, kpi: str, by: str, f: Filters, category: Optional[str]) -> dict:
    if kpi not in KPI_BY_CODE:
        raise HTTPException(status_code=404, detail="Unknown KPI")
    if by not in DIMS:
        raise HTTPException(status_code=400, detail="by must be one of: " + ", ".join(DIMS))
    kind = KPI_BY_CODE[kpi]["kind"]
    q = apply_category(apply_filters(scoped_query(db, user), f), kpi, category)
    if kpi == "credit_source":
        q = q.filter(F.credit_linkage == "Yes")
    parent_total = q.count()
    dim = DIMS[by]
    rows = []
    if kind == "dist" and not category:
        # distribution KPIs drill by geography via the category slices: each row = farmers in that geography
        groups = q.with_entities(dim if dim is not None else func.count(F.id) * 0 + 0, func.count(F.id)).group_by(dim).all() if dim is not None else [(None, parent_total)]
        rows = [{"key": g, "label": g if g else NOT_CAPTURED, "farmers": c, "value": c, "pct": None} for g, c in groups]
    else:
        ex = _agg_exprs(kpi) if kind != "dist" else (func.count(F.id), None, None, func.count(F.id))
        exprs = [e if e is not None else func.count(F.id) * 0 for e in ex]
        if dim is None:
            res = [(None,) + tuple(q.with_entities(*exprs).one())]
        else:
            res = q.with_entities(dim, *exprs).group_by(dim).all()
        for r in res:
            key = r[0]
            h = _headline(kpi if kind != "dist" else "farmers_surveyed", r[1:])
            rows.append({"key": key, "label": key if key else NOT_CAPTURED, **h})
    rows.sort(key=lambda r: (-r["farmers"], str(r["label"])))
    assert sum(r["farmers"] for r in rows) == parent_total, "drill-down must reconcile with the parent total"
    return {"kpi": kpi, "by": by, "category": category, "parent_total": parent_total, "next_level": NEXT_LEVEL.get(by) if by != "society" else None,
            "rows": rows, "title": KPI_BY_CODE[kpi]["title"], "kind": kind}


@router.get("/dashboard/drill")
def dashboard_drill(request: Request, kpi: str, by: str = "district", category: Optional[str] = None, f: Filters = Depends(filters_dep),
                    db: Session = Depends(get_db), user: m.User = Depends(client_module("client_dashboard"))):
    body = _drill(db, user, kpi, by, f, category)
    log_access(db, request, user, "dashboard", detail=f"drill {kpi} by {by} {f.model_dump_json(exclude_none=True)}")
    return scrub(body)


# --------------------------------------------------------------------------------------
# Farmer records (read-only)
# --------------------------------------------------------------------------------------

def _farmer_query(db: Session, user: m.User, f: Filters, *, q_text: Optional[str], farmer_id: Optional[str], credit: Optional[str],
                  land_min: Optional[float], land_max: Optional[float], kpi: Optional[str] = None, category: Optional[str] = None):
    q = apply_filters(scoped_query(db, user), f)
    if kpi:
        if kpi not in KPI_BY_CODE:
            raise HTTPException(status_code=404, detail="Unknown KPI")
        q = apply_category(q, kpi, category)
        if kpi == "credit_source":
            q = q.filter(F.credit_linkage == "Yes")  # same population as the dashboard figure
        if kpi == "society_linked":
            q = q.filter(F.society_assoc == "Yes") if category == "Yes" else q
        if kpi == "credit_linked" and category == "Yes":
            q = q.filter(F.credit_linkage == "Yes")
    if q_text:
        t = "%" + _like_escape(q_text.strip()) + "%"
        q = q.filter(or_(F.farmer_name.ilike(t, escape="\\"), F.farmer_id.ilike(t, escape="\\")))   # name / farmer id only — never mobile
    if farmer_id:
        q = q.filter(F.farmer_id == farmer_id)
    if credit in ("Y", "N"):
        q = q.filter(F.credit_linkage == ("Yes" if credit == "Y" else "No"))
    if land_min is not None:
        q = q.filter(LAND_EXPR >= land_min)
    if land_max is not None:
        q = q.filter(LAND_EXPR <= land_max)
    return q


def _columns(columns: Optional[str]) -> list[str]:
    if not columns:
        return list(LIST_FIELDS)
    cols = [c for c in columns.split(",") if c]
    bad = [c for c in cols if c not in LIST_FIELDS]
    if bad:
        raise HTTPException(status_code=400, detail=f"Column not available: {bad[0]}")
    return cols


def _sorted(q, sort: str, direction: str):
    if sort not in SORTABLE:
        raise HTTPException(status_code=400, detail=f"Cannot sort by {sort}")
    col = SORTABLE[sort]
    primary = col.desc() if direction == "desc" else col.asc()
    return q.order_by(primary, F.farmer_id.asc())  # never by internal id / insertion order


@router.get("/farmers")
def list_farmers(request: Request, response: Response, page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                 sort: str = "farmer_name", dir: str = Query("asc", pattern="^(asc|desc)$"), columns: Optional[str] = None,
                 q: Optional[str] = Query(None, max_length=100), farmer_id: Optional[str] = Query(None, max_length=50),
                 credit: Optional[str] = Query(None, pattern="^[YN]$"), land_min: Optional[float] = Query(None, ge=0), land_max: Optional[float] = Query(None, ge=0),
                 kpi: Optional[str] = None, category: Optional[str] = Query(None, max_length=100),
                 f: Filters = Depends(filters_dep), db: Session = Depends(get_db), user: m.User = Depends(client_module("client_farmer_records"))):
    cols = _columns(columns)
    base = _farmer_query(db, user, f, q_text=q, farmer_id=farmer_id, credit=credit, land_min=land_min, land_max=land_max, kpi=kpi, category=category)
    total = base.count()
    rows = _sorted(base, sort, dir).offset((page - 1) * limit).limit(limit).all()
    log_access(db, request, user, "list", detail=f"page {page} total {total}")
    response.headers["X-Total-Count"] = str(total)
    return scrub({"total": total, "page": page, "limit": limit, "columns": [{"key": c, "label": LIST_LABELS[c]} for c in cols],
                  "items": [list_row(s, cols) for s in rows]})


@router.get("/farmers/export")
def export_farmers(request: Request, columns: Optional[str] = None, q: Optional[str] = Query(None, max_length=100), farmer_id: Optional[str] = None,
                   credit: Optional[str] = Query(None, pattern="^[YN]$"), land_min: Optional[float] = None, land_max: Optional[float] = None,
                   kpi: Optional[str] = None, category: Optional[str] = None, sort: str = "farmer_name", dir: str = Query("asc", pattern="^(asc|desc)$"),
                   f: Filters = Depends(filters_dep), db: Session = Depends(get_db), user: m.User = Depends(client_module("client_export"))):
    if "client_farmer_records" not in effective_modules(db, user):
        raise HTTPException(status_code=403, detail="This module is not assigned to your account.")
    cols = _columns(columns)
    base = _farmer_query(db, user, f, q_text=q, farmer_id=farmer_id, credit=credit, land_min=land_min, land_max=land_max, kpi=kpi, category=category)
    rows = _sorted(base, sort, dir).limit(50000).all()
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Farmers"
    ws.append([LIST_LABELS[c] for c in cols])
    for s in rows:
        ws.append([_val(s, c) for c in cols])
    log_access(db, request, user, "export", detail=f"farmers {len(rows)} rows {f.model_dump_json(exclude_none=True)}")
    return _xlsx(wb, "farmers.xlsx")


def _xlsx(wb, name: str) -> Response:
    buf = io.BytesIO()
    wb.save(buf)
    return Response(buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/farmers/{farmer_id:path}")
def farmer_detail(farmer_id: str, request: Request, db: Session = Depends(get_db), user: m.User = Depends(client_module("client_farmer_records"))):
    # Looked up THROUGH the scoped query: a farmer outside the client's scope is indistinguishable from a non-existent one (404, no IDOR).
    s = scoped_query(db, user).filter(F.farmer_id == farmer_id).order_by(F.survey_year.desc(), F.farmer_id).first()
    if not s:
        log_access(db, request, user, "denied", farmer_id=farmer_id[:50], detail="record not in scope")
        raise HTTPException(status_code=404, detail="Farmer not found")
    log_access(db, request, user, "view_record", farmer_id=s.farmer_id)
    return scrub({"farmer_id": s.farmer_id, "groups": detail_body(s)})


@router.get("/dashboard/export")
def export_dashboard(request: Request, top: int = Query(10, ge=1, le=25), kpi: Optional[str] = None, by: str = "district", category: Optional[str] = None,
                     f: Filters = Depends(filters_dep), db: Session = Depends(get_db), user: m.User = Depends(client_module("client_export"))):
    if "client_dashboard" not in effective_modules(db, user):
        raise HTTPException(status_code=403, detail="This module is not assigned to your account.")
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    if kpi:
        body = scrub(_drill(db, user, kpi, by, f, category))
        ws.title = "Drill-down"
        ws.append([body["title"], f"by {by}" + (f" · {category}" if category else ""), f"Total {body['parent_total']}"])
        ws.append(["Group", "Farmers", "Value", "%", "Not captured"])
        for r in body["rows"]:
            ws.append([r["label"], r["farmers"], r.get("value"), r.get("pct"), r.get("not_captured")])
    else:
        body = scrub(_summary(db, user, f, top))
        ws.title = "KPIs"
        ws.append(["KPI", "Item", "Farmers", "Value / %", "Definition"])
        for code, k in body.items():
            if k["kind"] == "dist":
                for it in k["items"]:
                    ws.append([k["title"], it["label"], it["farmers"], it["pct"], k["definition"]])
                ws.append([k["title"], NOT_CAPTURED, k["not_captured"], None, k["definition"]])
            else:
                ws.append([k["title"], "", k["farmers"], k["value"] if k["pct"] is None else f'{k["value"]} ({k["pct"]}%)', k["definition"]])
    log_access(db, request, user, "export", detail=f"dashboard {kpi or 'summary'} {f.model_dump_json(exclude_none=True)}")
    return _xlsx(wb, "dashboard.xlsx")


# --------------------------------------------------------------------------------------
# Admin: client groups, modules, scope, users, access log
# --------------------------------------------------------------------------------------

admin = APIRouter(prefix="/api/client/admin", tags=["Client Admin"])


def _org_dict(o: m.ClientOrg, users: Optional[list] = None) -> dict:
    return {"id": o.id, "name": o.name, "is_active": o.is_active, "modules": sorted(c.module_code for c in o.modules),
            "scope": {t: sorted(s.value for s in o.scopes if s.scope_type == t) for t in ("district", "taluka", "survey_year")},
            "user_count": len(users) if users is not None else None}


class OrgIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    is_active: bool = True
    modules: list[str] = []
    districts: list[str] = []
    talukas: list[str] = []
    survey_years: list[int] = []


def _apply_org(db: Session, o: m.ClientOrg, p: OrgIn) -> None:
    bad = [c for c in p.modules if c not in CLIENT_MODULES]
    if bad:
        raise HTTPException(status_code=400, detail=f"Unknown module: {bad[0]}")
    o.name, o.is_active = p.name.strip(), p.is_active
    o.modules = [m.ClientModule(module_code=c) for c in dict.fromkeys(p.modules)]
    o.scopes = ([m.ClientScope(scope_type="district", value=v) for v in dict.fromkeys(p.districts)]
                + [m.ClientScope(scope_type="taluka", value=v) for v in dict.fromkeys(p.talukas)]
                + [m.ClientScope(scope_type="survey_year", value=str(v)) for v in dict.fromkeys(p.survey_years)])


@admin.get("/modules")
def admin_modules(_: m.User = Depends(require_role("admin"))):
    return sorted(CLIENT_MODULES.values(), key=lambda x: x["order"])


@admin.get("/scope-options")
def scope_options(db: Session = Depends(get_db), _: m.User = Depends(require_role("admin"))):
    def distinct(col):
        return sorted(v for (v,) in db.query(col).distinct().all() if v not in (None, ""))
    return {"districts": distinct(F.district), "talukas": distinct(F.taluka), "survey_years": distinct(F.survey_year)}


@admin.get("/orgs")
def list_orgs(db: Session = Depends(get_db), _: m.User = Depends(require_role("admin"))):
    out = []
    for o in db.query(m.ClientOrg).order_by(m.ClientOrg.name).all():
        users = db.query(m.User).filter(m.User.client_id == o.id).all()
        out.append(_org_dict(o, users))
    return out


@admin.post("/orgs")
def create_org(p: OrgIn, request: Request, db: Session = Depends(get_db), a: m.User = Depends(require_role("admin"))):
    if db.query(m.ClientOrg).filter(func.lower(m.ClientOrg.name) == p.name.strip().lower()).first():
        raise HTTPException(status_code=400, detail="A client with that name already exists.")
    o = m.ClientOrg(name=p.name.strip())
    _apply_org(db, o, p)
    db.add(o)
    db.commit()
    audit(db, request, "client_create", user=a, resource=f"client:{o.id}", detail=o.name)
    invalidate_cache()
    return _org_dict(o, [])


@admin.put("/orgs/{org_id}")
def update_org(org_id: int, p: OrgIn, request: Request, db: Session = Depends(get_db), a: m.User = Depends(require_role("admin"))):
    o = db.query(m.ClientOrg).get(org_id)
    if not o:
        raise HTTPException(status_code=404, detail="Client not found")
    if db.query(m.ClientOrg).filter(func.lower(m.ClientOrg.name) == p.name.strip().lower(), m.ClientOrg.id != org_id).first():
        raise HTTPException(status_code=400, detail="A client with that name already exists.")
    _apply_org(db, o, p)
    db.commit()
    audit(db, request, "client_update", user=a, resource=f"client:{o.id}", detail=f"modules={sorted(p.modules)} districts={p.districts} talukas={p.talukas} years={p.survey_years}")
    invalidate_cache()
    return _org_dict(o)


def _user_dict(db: Session, u: m.User) -> dict:
    over = {r.module_code: r.granted for r in db.query(m.ClientUserModule).filter(m.ClientUserModule.user_id == u.id).all()}
    return {"id": u.id, "username": u.username, "full_name": u.full_name, "email": u.email, "is_active": u.is_active, "overrides": over,
            "effective_modules": sorted(effective_modules(db, u))}


@admin.get("/orgs/{org_id}/users")
def org_users(org_id: int, db: Session = Depends(get_db), _: m.User = Depends(require_role("admin"))):
    return [_user_dict(db, u) for u in db.query(m.User).filter(m.User.client_id == org_id).order_by(m.User.username).all()]


class ClientUserIn(BaseModel):
    username: str = Field(..., min_length=3, max_length=60)
    full_name: str = Field(..., min_length=1, max_length=120)
    email: Optional[str] = Field(None, max_length=200)
    password: str = Field(..., min_length=1, max_length=200)


@admin.post("/orgs/{org_id}/users")
def create_client_user(org_id: int, p: ClientUserIn, request: Request, db: Session = Depends(get_db), a: m.User = Depends(require_role("admin"))):
    if not db.query(m.ClientOrg).get(org_id):
        raise HTTPException(status_code=404, detail="Client not found")
    if db.query(m.User).filter(m.User.username == p.username).first():
        raise HTTPException(status_code=400, detail="That username is already taken.")
    weak = validate_password_strength(p.password)
    if weak:
        raise HTTPException(status_code=400, detail=weak)
    u = m.User(username=p.username, full_name=p.full_name, email=p.email or None, password_hash=hash_password(p.password), role=CLIENT_ROLE,
               permissions="", client_id=org_id, created_by_user_id=a.id)
    db.add(u)
    db.commit()
    audit(db, request, "user_create", user=a, resource=f"user:{u.id}", detail=f"created {u.username} (role=client, client={org_id})")
    return _user_dict(db, u)


class OverridesIn(BaseModel):
    overrides: dict[str, bool] = {}


@admin.put("/users/{user_id}/modules")
def set_overrides(user_id: int, p: OverridesIn, request: Request, db: Session = Depends(get_db), a: m.User = Depends(require_role("admin"))):
    u = db.query(m.User).get(user_id)
    if not u or u.role != CLIENT_ROLE:
        raise HTTPException(status_code=404, detail="Client user not found")
    bad = [c for c in p.overrides if c not in CLIENT_MODULES]
    if bad:
        raise HTTPException(status_code=400, detail=f"Unknown module: {bad[0]}")
    db.query(m.ClientUserModule).filter(m.ClientUserModule.user_id == user_id).delete()
    db.add_all([m.ClientUserModule(user_id=user_id, module_code=c, granted=g) for c, g in p.overrides.items()])
    db.commit()
    audit(db, request, "client_user_modules", user=a, resource=f"user:{user_id}", detail=str(p.overrides))
    return _user_dict(db, u)


@admin.get("/logs")
def access_logs(response: Response, client_id: Optional[int] = None, user_id: Optional[int] = None, action: Optional[str] = None,
                limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), db: Session = Depends(get_db), _: m.User = Depends(require_role("admin"))):
    q = db.query(m.ClientAccessLog)
    if client_id:
        q = q.filter(m.ClientAccessLog.client_id == client_id)
    if user_id:
        q = q.filter(m.ClientAccessLog.user_id == user_id)
    if action:
        q = q.filter(m.ClientAccessLog.action == action)
    response.headers["X-Total-Count"] = str(q.count())
    names = {u.id: u.username for u in db.query(m.User).filter(m.User.role == CLIENT_ROLE).all()}
    return [{"id": r.id, "at": r.at, "user": names.get(r.user_id, r.user_id), "client_id": r.client_id, "action": r.action,
             "farmer_id": r.farmer_id, "detail": r.detail, "ip": r.ip_address}
            for r in q.order_by(m.ClientAccessLog.id.desc()).offset(offset).limit(limit).all()]

