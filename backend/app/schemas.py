import re
import json
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

STR_MAX = 200        # generic short-text ceiling — blocks oversized-payload abuse
TEXT_MAX = 2000       # for free-text detail/benefits fields


class LoginIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    username: str
    full_name: str


class RefreshIn(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=500)


class LogoutIn(BaseModel):
    refresh_token: str = Field(..., min_length=1, max_length=500)


class UserOut(BaseModel):
    username: str
    full_name: str
    role: str


class ForgotPasswordIn(BaseModel):
    # Accepts either the username or the registered email — kept as one loosely
    # typed field so the response can stay identical either way (see main.py;
    # this avoids leaking which identifier format is/isn't registered).
    identifier: str = Field(..., min_length=1, max_length=200)


class ResetPasswordIn(BaseModel):
    token: str = Field(..., min_length=1, max_length=200)
    new_password: str = Field(..., min_length=1, max_length=200)


class FarmerLookup(BaseModel):
    farmer_id: str
    farmer_name: str
    mobile_no: str
    gender: str
    age: int
    guardian_name: Optional[str] = None
    village: Optional[str] = None
    taluka: Optional[str] = None
    district: Optional[str] = None


class SurveyIn(BaseModel):
    farmer_id: str = Field(..., min_length=1, max_length=STR_MAX)
    farmer_name: str = Field(..., min_length=1, max_length=STR_MAX)
    mobile_no: str
    gender: str = Field(..., max_length=20)
    age: int = Field(..., ge=18, le=80)
    guardian_name: Optional[str] = Field(None, max_length=STR_MAX)

    society_assoc: str = Field(..., max_length=10)
    society_name: Optional[str] = Field(None, max_length=STR_MAX)
    society_since_year: Optional[int] = Field(None, ge=1900, le=2100)
    society_benefits: Optional[str] = Field(None, max_length=TEXT_MAX)

    village: str = Field(..., min_length=1, max_length=STR_MAX)
    taluka: str = Field(..., min_length=1, max_length=STR_MAX)
    district: str = Field(..., min_length=1, max_length=STR_MAX)

    land_own_acres: float = Field(..., ge=0, le=100000)
    land_leased_acres: Optional[float] = Field(0, ge=0, le=100000)
    areca_area_acres: float = Field(..., ge=0, le=100000)
    areca_plant_count: int = Field(..., ge=0, le=10_000_000)
    organic_farming: Optional[str] = Field(None, max_length=10)
    organic_certified: Optional[str] = Field(None, max_length=10)
    organic_cert_applied: Optional[str] = Field(None, max_length=10)
    organic_cert_aware: Optional[str] = Field(None, max_length=10)
    intercropping: Optional[str] = Field(None, max_length=10)
    intercrop_crops: Optional[str] = Field(None, max_length=TEXT_MAX)
    intercrop_area_acres: Optional[float] = Field(None, ge=0, le=100000)

    cultivation_cost_inr: float = Field(..., ge=0, le=1_000_000_000)
    yield_raw_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)  # required only when sale_type is "Sold raw areca"
    yield_processed_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)

    sale_type: str = Field(..., max_length=50)
    processing_cost_inr: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    marketing_channel: str = Field(..., max_length=STR_MAX)
    marketing_channel_detail: Optional[str] = Field(None, max_length=STR_MAX)
    rate_inr_per_kg: float = Field(..., ge=0, le=1_000_000)
    sale_month: str = Field(..., max_length=20)

    storage_duration_months: Optional[float] = Field(None, ge=0, le=1200)
    storage_source: Optional[str] = Field(None, max_length=STR_MAX)
    storage_loan_availed: Optional[str] = Field(None, max_length=10)
    storage_loan_amount_inr: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    storage_loan_interest_pct: Optional[float] = Field(None, ge=0, le=100)
    storage_loan_repayment_months: Optional[int] = Field(None, ge=0, le=1200)
    storage_warehouse_receipt: Optional[str] = Field(None, max_length=10)
    logistics_provider: Optional[str] = Field(None, max_length=STR_MAX)
    logistics_provider_other: Optional[str] = Field(None, max_length=STR_MAX)
    logistics_cost_inr_per_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)

    cultivation_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)
    machinery_waiting_days: Optional[int] = Field(None, ge=0, le=3650)

    crop2_name: Optional[str] = Field(None, max_length=STR_MAX)
    crop2_area_acres: Optional[float] = Field(None, ge=0, le=100000)
    crop2_yield: Optional[float] = Field(None, ge=0, le=1_000_000)
    crop2_rate: Optional[float] = Field(None, ge=0, le=1_000_000)
    crop3_name: Optional[str] = Field(None, max_length=STR_MAX)
    crop3_area_acres: Optional[float] = Field(None, ge=0, le=100000)
    crop3_yield: Optional[float] = Field(None, ge=0, le=1_000_000)
    crop3_rate: Optional[float] = Field(None, ge=0, le=1_000_000)

    mech_owned: Optional[str] = Field(None, max_length=TEXT_MAX)
    mech_rented: Optional[str] = Field(None, max_length=TEXT_MAX)
    mech_rental_rate_inr_hr: Optional[str] = Field(None, max_length=TEXT_MAX)
    mech_financed: Optional[str] = Field(None, max_length=10)
    mech_loan_amount_inr_lakh: Optional[float] = Field(None, ge=0, le=1_000_000)
    mech_loan_interest_pct: Optional[float] = Field(None, ge=0, le=100)

    total_household_income_inr_lakh: Optional[float] = Field(None, ge=0, le=1_000_000)
    non_farm_income_source: Optional[str] = Field(None, max_length=TEXT_MAX)
    bank_account: Optional[str] = Field(None, max_length=10)
    overdraft_facility: Optional[str] = Field(None, max_length=10)
    overdraft_limit_inr_lakh: Optional[float] = Field(None, ge=0, le=1_000_000)

    credit_linkage: str = Field(..., max_length=10)
    credit_source: Optional[str] = Field(None, max_length=STR_MAX)
    credit_amount_inr: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    credit_interest_rate_pct: Optional[float] = Field(None, ge=0, le=100)
    credit_repayment_months: Optional[int] = Field(None, ge=0, le=1200)
    credit_outstanding_inr_lakh: Optional[float] = Field(None, ge=0, le=1_000_000)
    loan_application_outcome: Optional[str] = Field(None, max_length=STR_MAX)
    loan_rejection_reason: Optional[str] = Field(None, max_length=STR_MAX)
    credit_gap_inr_lakh: Optional[float] = Field(None, ge=0, le=1_000_000)

    scheme_availed: str = Field(..., max_length=10)
    scheme_name: Optional[str] = Field(None, max_length=STR_MAX)
    scheme_benefits: Optional[str] = Field(None, max_length=TEXT_MAX)

    irrigation_source: Optional[str] = Field(None, max_length=TEXT_MAX)
    irrigation_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)

    soil_test_done: str = Field(..., max_length=10)
    crop_insurance: str = Field(..., max_length=10)
    crop_insurance_detail: Optional[str] = Field(None, max_length=TEXT_MAX)
    natural_calamity_5yr: Optional[str] = Field(None, max_length=10)

    input_source: str = Field(..., max_length=STR_MAX)
    input_distance_km: Optional[float] = Field(None, ge=0, le=100000)
    input_challenges: Optional[str] = Field(None, max_length=STR_MAX)
    input_challenges_other: Optional[str] = Field(None, max_length=STR_MAX)
    input_purchase_delay_days: Optional[int] = Field(None, ge=0, le=3650)

    tech_adoption: str = Field(..., max_length=10)
    tech_adoption_detail: Optional[str] = Field(None, max_length=TEXT_MAX)

    kcc_account: Optional[str] = Field(None, max_length=10)
    kcc_limit_inr_lakh: Optional[float] = Field(None, ge=0, le=1_000_000)

    mobile_verified: Optional[bool] = False

    geo_lat: Optional[float] = Field(None, ge=-90, le=90)
    geo_long: Optional[float] = Field(None, ge=-180, le=180)
    field_photo: Optional[str] = Field(None, max_length=6_000_000)  # base64 data URL, client-compressed
    client_uuid: Optional[str] = Field(None, max_length=100)  # set by the app when queued offline, for de-duplication on sync

    plot_boundary: Optional[str] = Field(None, max_length=TEXT_MAX)
    plot_boundary_area_acres: Optional[float] = Field(None, ge=0, le=1_000_000)
    plot_boundary_method: Optional[str] = Field(None, max_length=20)

    @field_validator("mobile_no")
    @classmethod
    def validate_mobile(cls, v: str) -> str:
        if not re.fullmatch(r"\d{10}", v.strip()):
            raise ValueError("mobile_no must be exactly 10 digits")
        return v.strip()

    @field_validator(
        "society_assoc", "credit_linkage", "scheme_availed", "soil_test_done",
        "crop_insurance", "tech_adoption",
        "organic_farming", "organic_certified", "organic_cert_applied", "organic_cert_aware",
        "intercropping", "storage_loan_availed", "storage_warehouse_receipt", "mech_financed",
        "bank_account", "overdraft_facility", "natural_calamity_5yr", "kcc_account",
    )
    @classmethod
    def validate_yes_no(cls, v):
        if v is not None and v not in ("Yes", "No"):
            raise ValueError('must be "Yes" or "No"')
        return v

    @field_validator("areca_area_acres")
    @classmethod
    def areca_area_not_negative(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("areca_area_acres must be greater than 0")
        return v

    @field_validator("land_own_acres", "land_leased_acres", "intercrop_area_acres")
    @classmethod
    def max_two_decimals(cls, v):
        if v is not None and round(v, 2) != v:
            raise ValueError("must have at most 2 decimal places")
        return v

    @field_validator("cultivation_cost_inr")
    @classmethod
    def whole_number_cost(cls, v: float) -> float:
        if v != int(v):
            raise ValueError("must be a whole number (no decimals)")
        return v

    @field_validator("yield_raw_qtl", "yield_processed_qtl")
    @classmethod
    def yield_positive_two_decimals(cls, v):
        if v is None:
            return v
        if v <= 0:
            raise ValueError("must be a positive value")
        if round(v, 2) != v:
            raise ValueError("must have at most 2 decimal places")
        return v

    @model_validator(mode="after")
    def yield_matches_sale_type(self):
        if self.sale_type == "Sold raw areca" and self.yield_raw_qtl is None:
            raise ValueError("yield_raw_qtl is required for a raw areca sale")
        if self.sale_type == "Sold processed areca" and self.yield_processed_qtl is None:
            raise ValueError("yield_processed_qtl is required for a processed areca sale")
        return self

    @model_validator(mode="after")
    def areca_area_within_land(self):
        total_land = (self.land_own_acres or 0) + (self.land_leased_acres or 0)
        if self.areca_area_acres > total_land:
            raise ValueError("areca_area_acres cannot exceed total own + leased land")
        return self

    @model_validator(mode="after")
    def plot_boundary_required(self):
        try:
            points = json.loads(self.plot_boundary) if self.plot_boundary else []
        except (ValueError, TypeError):
            points = []
        if not isinstance(points, list) or len(points) < 3:
            raise ValueError("plot_boundary is mandatory — capture at least 3 points via Draw on Map, Excel upload, or GPS walk")
        return self


class SurveyOut(SurveyIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    total_income_inr: float
    entry_timestamp: datetime
    created_by_user_id: Optional[int] = None
    plot_boundary: Optional[str] = None
    plot_boundary_area_acres: Optional[float] = None
    plot_boundary_method: Optional[str] = None
    plot_boundary_captured_at: Optional[datetime] = None

    # These two rules are intentionally input-only (create/update): they enforce
    # requirements for new/edited data, but records saved before a requirement
    # existed must still be readable — otherwise GET /api/surveys throws on any
    # pre-existing row and the whole list disappears. Redefining the same
    # validator name here overrides (neutralizes) the parent SurveyIn validator
    # for this output-only subclass.
    @model_validator(mode="after")
    def plot_boundary_required(self):
        return self

    @model_validator(mode="after")
    def yield_matches_sale_type(self):
        return self


# ---------------- Plot Boundary Capture (v2) ----------------

class LatLngPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class PlotBoundaryIn(BaseModel):
    points: list[LatLngPoint] = Field(..., min_length=3, max_length=2000)
    area_acres: float = Field(..., ge=0, le=100000)
    method: str = Field(..., pattern="^(draw|excel|gps)$")


class PlotBoundaryOut(BaseModel):
    survey_id: int
    points: list[LatLngPoint]
    area_acres: float
    method: str
    captured_at: Optional[datetime] = None


class PlotSummaryOut(BaseModel):
    survey_id: int = Field(..., alias="id")
    farmer_name: str
    village: str
    taluka: str
    district: str
    areca_area_acres: float
    plot_boundary: Optional[str] = None
    plot_boundary_area_acres: Optional[float] = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
