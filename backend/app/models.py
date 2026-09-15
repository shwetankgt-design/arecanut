from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
import datetime
from .db import Base


# ---------------- AUTH ----------------

class User(Base):
    __tablename__ = "auth_user"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False, index=True)
    email = Column(String, unique=True, nullable=True, index=True)
    full_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="enumerator")  # "admin" | "enumerator"
    is_active = Column(Boolean, default=True)
    failed_login_count = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class PasswordResetToken(Base):
    """
    Like refresh tokens, only the SHA-256 hash of the raw token is stored — the
    raw token exists only in the emailed link and briefly in memory. Single-use
    (marked via used_at) and short-lived (see config.PASSWORD_RESET_EXPIRE_MINUTES).
    """
    __tablename__ = "auth_password_reset_token"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class RefreshToken(Base):
    """
    Refresh tokens are stored only as a SHA-256 hash (never the raw token), so a
    database leak alone can't be used to impersonate a session. Rotation is
    enforced: each /auth/refresh call revokes the token it consumed and issues a
    new one, so a stolen-but-unused-yet refresh token can be detected (reuse of
    a revoked token is treated as a compromise signal).
    """
    __tablename__ = "auth_refresh_token"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, nullable=False, index=True)
    issued_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)


class AuditLog(Base):
    """Append-only trail of security-relevant events for post-incident review."""
    __tablename__ = "audit_log"
    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=True)
    username = Column(String, nullable=True)
    action = Column(String, nullable=False)  # e.g. "login_success", "login_failed", "survey_delete"
    resource = Column(String, nullable=True)  # e.g. "survey:101"
    ip_address = Column(String, nullable=True)
    detail = Column(String, nullable=True)


# ---------------- MASTER DATA TABLES ----------------

class District(Base):
    __tablename__ = "m_district"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    talukas = relationship("Taluka", back_populates="district")


class Taluka(Base):
    __tablename__ = "m_taluka"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    district_id = Column(Integer, ForeignKey("m_district.id"))
    district = relationship("District", back_populates="talukas")
    villages = relationship("Village", back_populates="taluka")


class Village(Base):
    __tablename__ = "m_village"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    taluka_id = Column(Integer, ForeignKey("m_taluka.id"))
    taluka = relationship("Taluka", back_populates="villages")


class Society(Base):
    __tablename__ = "m_society"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    district_id = Column(Integer, ForeignKey("m_district.id"), nullable=True)


class CropMaster(Base):
    __tablename__ = "m_crop"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)


class SchemeMaster(Base):
    __tablename__ = "m_scheme"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)


class MachineMaster(Base):
    __tablename__ = "m_machine"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)


class OptionMaster(Base):
    """Generic master for simple dropdown/multi-select option lists keyed by list_code."""
    __tablename__ = "m_option"
    id = Column(Integer, primary_key=True)
    list_code = Column(String, nullable=False, index=True)
    label = Column(String, nullable=False)
    sort_order = Column(Integer, default=0)


# ---------------- FARMER MASTER (Registration Portal - simulated) ----------------

class FarmerMaster(Base):
    __tablename__ = "farmer_master"
    id = Column(Integer, primary_key=True)
    farmer_id = Column(String, unique=True, nullable=False)   # e.g. NCCF/KA/0001
    farmer_name = Column(String, nullable=False)
    mobile_no = Column(String, nullable=False)
    aadhaar_no = Column(String, nullable=False)
    gender = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    guardian_name = Column(String, nullable=True)
    village_id = Column(Integer, ForeignKey("m_village.id"))
    bank_account_no = Column(String, nullable=True)
    bank_ifsc = Column(String, nullable=True)


# ---------------- SURVEY / DATA ENTRY (62 fields across 17 modules) ----------------

class FarmerSurvey(Base):
    __tablename__ = "farmer_survey"
    id = Column(Integer, primary_key=True)

    # Module 0: Farmer Master Link
    farmer_id = Column(String, nullable=False, index=True)
    farmer_name = Column(String, nullable=False)
    mobile_no = Column(String, nullable=False)
    gender = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    guardian_name = Column(String, nullable=True)

    # Module 1: Society / FPC Linkage
    society_assoc = Column(String, nullable=False)          # Yes/No
    society_name = Column(String, nullable=True)
    society_since_year = Column(Integer, nullable=True)
    society_benefits = Column(String, nullable=True)        # comma-separated

    # Module 2: Location Details
    village = Column(String, nullable=False)
    taluka = Column(String, nullable=False)
    district = Column(String, nullable=False)

    # Module 3: Land Holding
    land_own_acres = Column(Float, nullable=False)
    land_leased_acres = Column(Float, nullable=True, default=0)
    areca_area_acres = Column(Float, nullable=False)
    areca_plant_count = Column(Integer, nullable=False)

    # Module 4: Cultivation Cost & Yield
    cultivation_cost_inr = Column(Float, nullable=False)
    yield_raw_qtl = Column(Float, nullable=False)

    # Module 5: Sales, Marketing & Income
    sale_type = Column(String, nullable=False)
    processing_cost_inr = Column(Float, nullable=True)
    marketing_channel = Column(String, nullable=False)
    rate_inr_per_kg = Column(Float, nullable=False)
    total_income_inr = Column(Float, nullable=False)        # auto-calculated
    sale_month = Column(String, nullable=False)

    # Module 6: Storage & Logistics
    storage_duration_months = Column(Float, nullable=True)
    storage_source = Column(String, nullable=True)
    logistics_provider = Column(String, nullable=True)
    logistics_cost_inr_per_qtl = Column(Float, nullable=True)

    # Module 7: Cultivation Challenges
    cultivation_challenges = Column(String, nullable=True)  # comma-separated

    # Module 8: Other Crops (Diversification)
    crop2_name = Column(String, nullable=True)
    crop2_area_acres = Column(Float, nullable=True)
    crop2_yield = Column(Float, nullable=True)
    crop2_rate = Column(Float, nullable=True)
    crop3_name = Column(String, nullable=True)
    crop3_area_acres = Column(Float, nullable=True)
    crop3_yield = Column(Float, nullable=True)
    crop3_rate = Column(Float, nullable=True)

    # Module 9: Farm Mechanisation
    mech_owned = Column(String, nullable=True)               # comma-separated
    mech_rented = Column(String, nullable=True)               # comma-separated
    mech_rental_rate_inr_hr = Column(String, nullable=True)   # JSON string {machine: rate}

    # Module 10: Credit & Finance
    credit_linkage = Column(String, nullable=False)
    credit_source = Column(String, nullable=True)
    credit_amount_inr = Column(Float, nullable=True)
    credit_interest_rate_pct = Column(Float, nullable=True)
    credit_repayment_months = Column(Integer, nullable=True)

    # Module 11: Government Schemes
    scheme_availed = Column(String, nullable=False)
    scheme_name = Column(String, nullable=True)
    scheme_benefits = Column(Text, nullable=True)

    # Module 12: Irrigation
    irrigation_source = Column(String, nullable=True)        # comma-separated
    irrigation_challenges = Column(String, nullable=True)

    # Module 13: Soil Health & Crop Insurance
    soil_test_done = Column(String, nullable=False)
    crop_insurance = Column(String, nullable=False)
    crop_insurance_detail = Column(String, nullable=True)

    # Module 14: Input Supply Chain
    input_source = Column(String, nullable=False)
    input_distance_km = Column(Float, nullable=True)
    input_challenges = Column(String, nullable=True)

    # Module 15: Technology Adoption
    tech_adoption = Column(String, nullable=False)
    tech_adoption_detail = Column(String, nullable=True)

    # Module 16: Metadata & Geo-tagging
    entry_timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    geo_lat = Column(Float, nullable=True)
    geo_long = Column(Float, nullable=True)
    field_photo = Column(String, nullable=True)
    enumerator_name = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("auth_user.id"), nullable=True)
    client_uuid = Column(String, unique=True, nullable=True, index=True)  # dedupes offline-queued submissions

    # Plot Boundary Capture (v2): ordered polygon vertices as JSON text
    # [{"lat":..,"lng":..}, ...] — captured via draw-on-map, Excel upload, or
    # GPS walk. Kept as one JSON blob rather than a child table since it's
    # always read/written whole, never queried by vertex.
    plot_boundary = Column(Text, nullable=True)
    plot_boundary_area_acres = Column(Float, nullable=True)
    plot_boundary_method = Column(String, nullable=True)  # "draw" | "excel" | "gps"
    plot_boundary_captured_at = Column(DateTime, nullable=True)
