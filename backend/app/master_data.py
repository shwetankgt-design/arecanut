"""
Generic, registry-driven CRUD for master/reference tables.

The admin's "manage all master data" requirement covers eight existing
tables today (District/Taluka/Village/Society/CropMaster/SchemeMaster/
MachineMaster/OptionMaster) and explicitly "going to be created in the
future" ones too. Rather than hand-writing GET/POST/PUT/DELETE for each
table (and again for every future one), each table is described once in
MASTER_TABLES below — name, its SQLAlchemy model, and its editable fields
— and four generic routes below do the actual DB work against whichever
table the URL names. Adding a future master table means adding one entry
here, not new endpoint code.
"""
from dataclasses import dataclass, field
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from . import models as m
from .db import get_db
from .auth import require_role, audit


@dataclass
class FieldSpec:
    name: str
    label: str
    type: str = "string"  # "string" | "int" | "bool" | "fk"
    required: bool = True
    unique: bool = False
    fk_table: Optional[str] = None  # registry key this fk points at, when type == "fk"


@dataclass
class TableSpec:
    label: str
    model: Any
    fields: list = field(default_factory=list)


# Order matters for the frontend's tab list, not for behavior.
MASTER_TABLES: dict = {
    "district": TableSpec("Districts", m.District, [
        FieldSpec("name", "District Name", unique=True),
    ]),
    "taluka": TableSpec("Talukas", m.Taluka, [
        FieldSpec("name", "Taluka Name"),
        FieldSpec("district_id", "District", type="fk", fk_table="district"),
    ]),
    "village": TableSpec("Villages", m.Village, [
        FieldSpec("name", "Village Name"),
        FieldSpec("taluka_id", "Taluka", type="fk", fk_table="taluka"),
    ]),
    "society": TableSpec("Societies / FPCs", m.Society, [
        FieldSpec("name", "Society / FPC Name", unique=True),
        FieldSpec("district_id", "District", type="fk", fk_table="district", required=False),
        FieldSpec("taluka_id", "Taluka", type="fk", fk_table="taluka", required=False),
        FieldSpec("is_state_level", "State-level (no taluka)", type="bool", required=False),
    ]),
    "crop": TableSpec("Other Crops", m.CropMaster, [
        FieldSpec("name", "Crop Name", unique=True),
    ]),
    "scheme": TableSpec("Government Schemes", m.SchemeMaster, [
        FieldSpec("name", "Scheme Name", unique=True),
    ]),
    "machine": TableSpec("Mechanisation Equipment", m.MachineMaster, [
        FieldSpec("name", "Machine Name", unique=True),
        FieldSpec("sort_order", "Sort Order", type="int", required=False),
    ]),
    "option": TableSpec("Dropdown Option Lists", m.OptionMaster, [
        FieldSpec("list_code", "List Code"),
        FieldSpec("label", "Option Label"),
        FieldSpec("sort_order", "Sort Order", type="int", required=False),
    ]),
}


def _spec(table: str) -> TableSpec:
    spec = MASTER_TABLES.get(table)
    if not spec:
        raise HTTPException(status_code=404, detail=f"Unknown master table: {table}")
    return spec


def _coerce(field_spec: FieldSpec, value: Any) -> Any:
    if value is None:
        return None
    if field_spec.type == "int" or field_spec.type == "fk":
        return int(value)
    if field_spec.type == "bool":
        return bool(value)
    return str(value)


def _validate_and_prepare(db: Session, spec: TableSpec, payload: dict, editing_id: Optional[int] = None) -> dict:
    values = {}
    for f in spec.fields:
        raw = payload.get(f.name)
        if raw is None or raw == "":
            if f.required:
                raise HTTPException(status_code=400, detail=f"{f.label} is required")
            values[f.name] = None
            continue
        val = _coerce(f, raw)

        if f.type == "fk":
            fk_spec = _spec(f.fk_table)
            if not db.query(fk_spec.model).get(val):
                raise HTTPException(status_code=400, detail=f"{f.label}: no such record (id={val})")

        if f.unique:
            existing = db.query(spec.model).filter(getattr(spec.model, f.name) == val).first()
            if existing and existing.id != editing_id:
                raise HTTPException(status_code=400, detail=f"{f.label} '{val}' already exists")

        values[f.name] = val
    return values


router = APIRouter(prefix="/api/admin/master-data", tags=["master-data"])


@router.get("/tables")
def list_master_tables(admin: m.User = Depends(require_role("admin"))):
    return [
        {
            "key": key,
            "label": spec.label,
            "fields": [
                {"name": f.name, "label": f.label, "type": f.type, "required": f.required, "fk_table": f.fk_table}
                for f in spec.fields
            ],
        }
        for key, spec in MASTER_TABLES.items()
    ]


@router.get("/{table}")
def list_master_rows(table: str, db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin"))):
    spec = _spec(table)
    rows = db.query(spec.model).order_by(spec.model.id).all()

    # Resolve fk display names in bulk (one query per fk column, not per row).
    fk_lookups: dict = {}
    for f in spec.fields:
        if f.type == "fk":
            fk_spec = _spec(f.fk_table)
            fk_lookups[f.name] = {r.id: getattr(r, "name", str(r.id)) for r in db.query(fk_spec.model).all()}

    out = []
    for row in rows:
        item = {"id": row.id}
        for f in spec.fields:
            val = getattr(row, f.name)
            item[f.name] = val
            if f.type == "fk":
                item[f"{f.name}_display"] = fk_lookups[f.name].get(val) if val is not None else None
        out.append(item)
    return out


@router.post("/{table}")
def create_master_row(
    table: str, payload: dict, request: Request,
    db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin")),
):
    spec = _spec(table)
    values = _validate_and_prepare(db, spec, payload)
    row = spec.model(**values)
    db.add(row)
    db.commit()
    db.refresh(row)
    audit(db, request, "master_data_create", user=admin, resource=f"{table}:{row.id}", detail=str(values))
    return {"id": row.id, **values}


@router.put("/{table}/{row_id}")
def update_master_row(
    table: str, row_id: int, payload: dict, request: Request,
    db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin")),
):
    spec = _spec(table)
    row = db.query(spec.model).get(row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")
    values = _validate_and_prepare(db, spec, payload, editing_id=row_id)
    for k, v in values.items():
        setattr(row, k, v)
    db.commit()
    audit(db, request, "master_data_update", user=admin, resource=f"{table}:{row_id}", detail=str(values))
    return {"id": row_id, **values}


def _dependents(db: Session, table: str, row_id: int) -> Optional[str]:
    """
    Checked at the application level (not left to the DB's own FK enforcement)
    because SQLite — used in local dev — does not enforce foreign keys by
    default, which would silently let a dev delete something Postgres
    production would reject. This also gives a clearer message naming which
    table blocked the delete, on both engines identically.
    """
    for other_key, other_spec in MASTER_TABLES.items():
        for f in other_spec.fields:
            if f.type == "fk" and f.fk_table == table:
                if db.query(other_spec.model).filter(getattr(other_spec.model, f.name) == row_id).first():
                    return other_spec.label
    return None


@router.delete("/{table}/{row_id}")
def delete_master_row(
    table: str, row_id: int, request: Request,
    db: Session = Depends(get_db), admin: m.User = Depends(require_role("admin")),
):
    spec = _spec(table)
    row = db.query(spec.model).get(row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")

    blocker = _dependents(db, table, row_id)
    if blocker:
        raise HTTPException(status_code=400, detail=f"Cannot delete — still referenced by existing {blocker} records.")

    db.delete(row)
    db.commit()
    audit(db, request, "master_data_delete", user=admin, resource=f"{table}:{row_id}")
    return {"deleted": True}
