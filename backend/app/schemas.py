import re
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

    cultivation_cost_inr: float = Field(..., ge=0, le=1_000_000_000)
    yield_raw_qtl: float = Field(..., ge=0, le=1_000_000)

    sale_type: str = Field(..., max_length=50)
    processing_cost_inr: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    marketing_channel: str = Field(..., max_length=STR_MAX)
    rate_inr_per_kg: float = Field(..., ge=0, le=1_000_000)
    sale_month: str = Field(..., max_length=20)

    storage_duration_months: Optional[float] = Field(None, ge=0, le=1200)
    storage_source: Optional[str] = Field(None, max_length=STR_MAX)
    logistics_provider: Optional[str] = Field(None, max_length=STR_MAX)
    logistics_cost_inr_per_qtl: Optional[float] = Field(None, ge=0, le=1_000_000)

    cultivation_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)

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

    credit_linkage: str = Field(..., max_length=10)
    credit_source: Optional[str] = Field(None, max_length=STR_MAX)
    credit_amount_inr: Optional[float] = Field(None, ge=0, le=1_000_000_000)
    credit_interest_rate_pct: Optional[float] = Field(None, ge=0, le=100)
    credit_repayment_months: Optional[int] = Field(None, ge=0, le=1200)

    scheme_availed: str = Field(..., max_length=10)
    scheme_name: Optional[str] = Field(None, max_length=STR_MAX)
    scheme_benefits: Optional[str] = Field(None, max_length=TEXT_MAX)

    irrigation_source: Optional[str] = Field(None, max_length=TEXT_MAX)
    irrigation_challenges: Optional[str] = Field(None, max_length=TEXT_MAX)

    soil_test_done: str = Field(..., max_length=10)
    crop_insurance: str = Field(..., max_length=10)
    crop_insurance_detail: Optional[str] = Field(None, max_length=TEXT_MAX)

    input_source: str = Field(..., max_length=STR_MAX)
    input_distance_km: Optional[float] = Field(None, ge=0, le=100000)
    input_challenges: Optional[str] = Field(None, max_length=STR_MAX)

    tech_adoption: str = Field(..., max_length=10)
    tech_adoption_detail: Optional[str] = Field(None, max_length=TEXT_MAX)

    geo_lat: Optional[float] = Field(None, ge=-90, le=90)
    geo_long: Optional[float] = Field(None, ge=-180, le=180)
    field_photo: Optional[str] = Field(None, max_length=500)
    enumerator_name: Optional[str] = Field(None, max_length=STR_MAX)
    client_uuid: Optional[str] = Field(None, max_length=100)  # set by the app when queued offline, for de-duplication on sync

    @field_validator("mobile_no")
    @classmethod
    def validate_mobile(cls, v: str) -> str:
        if not re.fullmatch(r"\d{10}", v.strip()):
            raise ValueError("mobile_no must be exactly 10 digits")
        return v.strip()

    @field_validator(
        "society_assoc", "credit_linkage", "scheme_availed", "soil_test_done",
        "crop_insurance", "tech_adoption",
    )
    @classmethod
    def validate_yes_no(cls, v: str) -> str:
        if v not in ("Yes", "No"):
            raise ValueError('must be "Yes" or "No"')
        return v

    @field_validator("areca_area_acres")
    @classmethod
    def areca_area_not_negative(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("areca_area_acres must be greater than 0")
        return v

    @model_validator(mode="after")
    def areca_area_within_land(self):
        total_land = (self.land_own_acres or 0) + (self.land_leased_acres or 0)
        if self.areca_area_acres > total_land:
            raise ValueError("areca_area_acres cannot exceed total own + leased land")
        return self


class SurveyOut(SurveyIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    total_income_inr: float
    entry_timestamp: datetime
    created_by_user_id: Optional[int] = None
