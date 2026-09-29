"""
FPO Consultation module — a large (72-question, 6-section) screening
questionnaire administered by the same field team that does farmer surveys,
gated by its own grantable permission (`fpo_consultation`) so an admin can
assign it independently of `survey_entry`/`farmer_records`/`plots_map`.

Draft-first by design, unlike the farmer survey wizard: every field on
FPOConsultationIn is optional, and PUT accepts a partial payload — the
frontend wizard saves after every step so a field agent's progress up to
whatever step they reached is never lost, even if they close the app or
lose connectivity mid-form. There is no server-side "all fields required"
gate; `status` ("draft" -> "submitted") is set by the client when the user
finishes the last step, purely advisory bookkeeping, not a validation gate.
"""
import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from . import models as m
from .db import get_db
from .auth import get_current_user, require_permission, require_role, audit
from .schemas import FPOConsultationIn, FPOConsultationOut, FPOConsultationListItem

router = APIRouter(prefix="/api/fpo-consultations", tags=["fpo-consultation"])


@router.get("", response_model=list[FPOConsultationListItem])
def list_fpo_consultations(
    status: str | None = None,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("fpo_consultation")),
):
    q = db.query(m.FPOConsultation)
    if status:
        q = q.filter(m.FPOConsultation.status == status)
    return q.order_by(m.FPOConsultation.updated_at.desc()).all()


@router.get("/{consultation_id}", response_model=FPOConsultationOut)
def get_fpo_consultation(
    consultation_id: int,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("fpo_consultation")),
):
    row = db.query(m.FPOConsultation).get(consultation_id)
    if not row:
        raise HTTPException(status_code=404, detail="FPO consultation not found")
    return row


@router.post("", response_model=FPOConsultationOut)
def create_fpo_consultation(
    payload: FPOConsultationIn,
    request: Request,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("fpo_consultation")),
):
    data = payload.model_dump(exclude_unset=True)
    row = m.FPOConsultation(**data, status="draft", created_by_user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    audit(db, request, "fpo_consultation_create", user=user, resource=f"fpo_consultation:{row.id}")
    return row


@router.put("/{consultation_id}", response_model=FPOConsultationOut)
def update_fpo_consultation(
    consultation_id: int,
    payload: FPOConsultationIn,
    request: Request,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("fpo_consultation")),
):
    row = db.query(m.FPOConsultation).get(consultation_id)
    if not row:
        raise HTTPException(status_code=404, detail="FPO consultation not found")
    if row.status == "submitted":
        raise HTTPException(status_code=400, detail="This consultation has already been submitted and can no longer be edited.")
    # Only the fields actually present in this step's payload are touched —
    # this is what makes step-wise partial saves safe: a PUT from step 3
    # never wipes data already saved from steps 1-2.
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    audit(db, request, "fpo_consultation_update", user=user, resource=f"fpo_consultation:{row.id}")
    return row


@router.post("/{consultation_id}/submit", response_model=FPOConsultationOut)
def submit_fpo_consultation(
    consultation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: m.User = Depends(require_permission("fpo_consultation")),
):
    row = db.query(m.FPOConsultation).get(consultation_id)
    if not row:
        raise HTTPException(status_code=404, detail="FPO consultation not found")
    row.status = "submitted"
    row.submitted_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(row)
    audit(db, request, "fpo_consultation_submit", user=user, resource=f"fpo_consultation:{row.id}")
    return row


@router.delete("/{consultation_id}")
def delete_fpo_consultation(
    consultation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: m.User = Depends(require_role("admin")),
):
    row = db.query(m.FPOConsultation).get(consultation_id)
    if not row:
        raise HTTPException(status_code=404, detail="FPO consultation not found")
    db.delete(row)
    db.commit()
    audit(db, request, "fpo_consultation_delete", user=admin, resource=f"fpo_consultation:{consultation_id}")
    return {"ok": True}
