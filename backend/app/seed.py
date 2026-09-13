import random
import json
import datetime
from .db import Base, engine, SessionLocal
from . import models as m
from .auth import hash_password

random.seed(42)

# ---------------- Karnataka Arecanut belt master geography ----------------
GEO = {
    "Shivamogga": {
        "Sagar": ["Anandapuram", "Talaguppa", "Ambaragodlu", "Kogar"],
        "Thirthahalli": ["Agumbe", "Muppane", "Hurulikoppa"],
        "Hosanagara": ["Nagara", "Ripponpet", "Kelagote"],
    },
    "Chikkamagaluru": {
        "Koppa": ["Balehonnur", "Kesave", "Hariharapura"],
        "Sringeri": ["Kigga", "Mennasandra"],
        "N.R.Pura": ["Kalasa", "Bhadra"],
    },
    "Davanagere": {
        "Channagiri": ["Santhebennur", "Basavapatna"],
        "Honnali": ["Nyamathi", "Ulchagatta"],
    },
    "Tumakuru": {
        "Tiptur": ["Nonavinakere", "Kibbanahalli"],
        "Turuvekere": ["Amruthur", "Handanakere"],
    },
    "Udupi": {
        "Karkala": ["Miyar", "Mala", "Nitte"],
        "Kundapura": ["Amasebailu", "Basrur"],
    },
    "Dakshina Kannada": {
        "Puttur": ["Uppinangady", "Ariyadka"],
        "Sullia": ["Aranthodu", "Kalmadka"],
    },
}

SOCIETIES = [
    "Malnad Arecanut Growers Cooperative Society",
    "Sagar Taluk FPC Ltd",
    "Shree Kshetra Arecanut Producer Company",
    "CAMPCO - Central Areca Nut & Cocoa Marketing Coop",
    "Koppa Areca Growers Society",
    "Tumkur Areca FPC",
    "Karkala Areca Producers Society",
]

CROPS_OTHER = ["Coconut", "Black Pepper", "Cocoa", "Banana", "Coffee", "Paddy", "Cardamom", "Nutmeg"]

SCHEMES = [
    "PM-KISAN", "PMFBY (Crop Insurance)", "Krishi Bhagya Scheme",
    "Areca Nut Development Scheme (Karnataka)", "Soil Health Card Scheme",
    "Kisan Credit Card", "NABARD Farm Mechanisation Subsidy",
]

MACHINES = [
    "Arecanut Harvesting Pole", "Arecanut Sprayer (Power)", "Arecanut Sprayer (Manual)",
    "Arecanut Dehusking Machine", "Areca Leaf Plate Making Machine", "Power Tiller",
    "Water Pump Set", "Drone Sprayer",
]

OPTION_LISTS = {
    "society_benefits": ["Credit Support", "Storage Support", "Market linkage", "Advisory Support", "Government Scheme convergence"],
    "cultivation_challenges": ["Pest & Disease attacks", "Credit", "Market", "Advisory", "Labour shortage"],
    "storage_source": ["Own Godown", "Society Warehouse", "Cold Storage", "Trader Facility"],
    "logistics_provider": ["Farmer (Own)", "Aggregator", "Trader"],
    "credit_source": ["Bank", "NBFC", "SHG", "Society", "Trader", "Relative"],
    "irrigation_source": ["Borewell", "Pond", "Well", "Canal", "River", "Rainfed"],
    "input_source": ["Society", "FPC", "Local Input Shop"],
    "input_challenges": ["High Rate", "Quality Issues", "Availability"],
    "marketing_channel": ["FPO", "Society", "Mandi", "Direct Trader"],
}

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

FIRST_NAMES_M = ["Ramesh", "Suresh", "Ganesh", "Prakash", "Manjunath", "Nagaraj", "Shivappa", "Krishna",
                  "Vittal", "Ravindra", "Mahabaleshwar", "Subraya", "Dinesh", "Harish", "Sadashiva",
                  "Umesh", "Vasanth", "Chandrashekar", "Gopal", "Narayan"]
FIRST_NAMES_F = ["Lakshmi", "Sharada", "Sunanda", "Vimala", "Girija", "Radha", "Yashoda", "Kamala",
                  "Bhagya", "Savitri", "Padma", "Shanta", "Rukmini", "Sarojini", "Vasanthi"]
LAST_NAMES = ["Hegde", "Shetty", "Bhat", "Gowda", "Poojary", "Rai", "Naik", "Achar", "Shanbhag", "Rao"]


def rand_name():
    if random.random() < 0.85:
        gender = "Male"
        fn = random.choice(FIRST_NAMES_M)
    else:
        gender = "Female"
        fn = random.choice(FIRST_NAMES_F)
    return f"{fn} {random.choice(LAST_NAMES)}", gender


def build_geo_flat():
    flat = []
    for district, talukas in GEO.items():
        for taluka, villages in talukas.items():
            for village in villages:
                flat.append((district, taluka, village))
    return flat


def seed():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # --- Default login accounts (change passwords before real deployment) ---
    db.add(m.User(username="admin", email="admin@arecanut-survey.local", full_name="Programme Admin", password_hash=hash_password("Admin@2024Gt"), role="admin"))
    db.add(m.User(username="enumerator1", email="enumerator1@arecanut-survey.local", full_name="Enum. K. Prasad", password_hash=hash_password("Field@2024Gt"), role="enumerator"))
    db.add(m.User(username="enumerator2", email="enumerator2@arecanut-survey.local", full_name="Enum. S. Nayak", password_hash=hash_password("Field@2024Gt"), role="enumerator"))
    db.commit()

    # --- Masters: geography ---
    district_objs = {}
    taluka_objs = {}
    village_objs = {}
    for district, talukas in GEO.items():
        d = m.District(name=district)
        db.add(d)
        db.flush()
        district_objs[district] = d
        for taluka, villages in talukas.items():
            t = m.Taluka(name=taluka, district_id=d.id)
            db.add(t)
            db.flush()
            taluka_objs[(district, taluka)] = t
            for village in villages:
                v = m.Village(name=village, taluka_id=t.id)
                db.add(v)
                db.flush()
                village_objs[(district, taluka, village)] = v

    for s in SOCIETIES:
        db.add(m.Society(name=s))
    for c in CROPS_OTHER:
        db.add(m.CropMaster(name=c))
    for s in SCHEMES:
        db.add(m.SchemeMaster(name=s))
    for mc in MACHINES:
        db.add(m.MachineMaster(name=mc))

    for list_code, options in OPTION_LISTS.items():
        for i, opt in enumerate(options):
            db.add(m.OptionMaster(list_code=list_code, label=opt, sort_order=i))

    db.commit()

    geo_flat = build_geo_flat()

    # --- Farmer master (registration portal) + Survey records ---
    for i in range(1, 101):
        name, gender = rand_name()
        district, taluka, village = random.choice(geo_flat)
        age = random.randint(24, 72)
        farmer_id = f"NCCF/KA/{i:04d}"
        mobile = f"9{random.randint(100000000, 999999999)}"
        aadhaar = f"{random.randint(1000,9999)} {random.randint(1000,9999)} {random.randint(1000,9999)}"
        guardian = f"{random.choice(FIRST_NAMES_M)} {random.choice(LAST_NAMES)}"

        v = village_objs[(district, taluka, village)]
        fm = m.FarmerMaster(
            farmer_id=farmer_id, farmer_name=name, mobile_no=mobile, aadhaar_no=aadhaar,
            gender=gender, age=age, guardian_name=guardian, village_id=v.id,
            bank_account_no=str(random.randint(10**10, 10**11 - 1)),
            bank_ifsc=f"SBIN0{random.randint(100000,999999)}",
        )
        db.add(fm)

        # Module 1: Society linkage
        society_assoc = random.random() < 0.62
        society_name = random.choice(SOCIETIES) if society_assoc else "NA"
        society_since_year = random.randint(2005, 2023) if society_assoc else None
        society_benefits = ",".join(random.sample(OPTION_LISTS["society_benefits"], k=random.randint(1, 3))) if society_assoc else None

        # Module 3: Land Holding
        land_own = round(random.uniform(0.5, 8.0), 2)
        land_leased = round(random.uniform(0, 3.0), 2) if random.random() < 0.3 else 0.0
        total_land = land_own + land_leased
        areca_area = round(min(total_land, random.uniform(0.4, total_land)), 2)
        plant_density_per_acre = random.randint(180, 260)
        areca_plant_count = int(areca_area * plant_density_per_acre)

        # Module 4: Cultivation cost & yield
        cultivation_cost = round(areca_area * random.uniform(35000, 65000), 0)
        yield_per_acre_qtl = random.uniform(6, 14)
        yield_raw_qtl = round(areca_area * yield_per_acre_qtl, 2)

        # Module 5: Sales
        sale_type = "Sold processed areca" if random.random() < 0.35 else "Sold raw areca"
        rate_per_kg = round(random.uniform(280, 480), 2)
        processing_cost = round(yield_raw_qtl * random.uniform(15, 35) * 100 / 100 * 10, 0) if sale_type == "Sold processed areca" else None
        # total_income = (yield_qtl * rate_per_kg * 100) - cultivation_cost [- processing_cost]
        gross = yield_raw_qtl * rate_per_kg * 100
        total_income = gross - cultivation_cost - (processing_cost or 0)
        total_income = round(total_income, 0)
        marketing_channel = random.choice(OPTION_LISTS["marketing_channel"])
        sale_month = random.choice(MONTHS)

        # Module 6: Storage & logistics
        storage_duration = random.choice([0, 0, 1, 2, 3, 4, 6, 8]) if random.random() < 0.7 else None
        storage_source = random.choice(OPTION_LISTS["storage_source"]) if storage_duration else None
        logistics_provider = random.choice(OPTION_LISTS["logistics_provider"])
        logistics_cost = round(random.uniform(40, 150), 0)

        # Module 7: Challenges
        cultivation_challenges = ",".join(random.sample(OPTION_LISTS["cultivation_challenges"], k=random.randint(1, 3)))

        # Module 8: Other crops
        has_crop2 = random.random() < 0.55
        crop2_name = random.choice(CROPS_OTHER) if has_crop2 else None
        crop2_area = round(random.uniform(0.2, 2.0), 2) if has_crop2 else None
        crop2_yield = round(random.uniform(2, 20), 2) if has_crop2 else None
        crop2_rate = round(random.uniform(15, 200), 2) if has_crop2 else None
        has_crop3 = has_crop2 and random.random() < 0.3
        crop3_name = random.choice([c for c in CROPS_OTHER if c != crop2_name]) if has_crop3 else None
        crop3_area = round(random.uniform(0.1, 1.0), 2) if has_crop3 else None
        crop3_yield = round(random.uniform(1, 10), 2) if has_crop3 else None
        crop3_rate = round(random.uniform(15, 200), 2) if has_crop3 else None

        # Module 9: Mechanisation
        owned = random.sample(MACHINES, k=random.randint(0, 3))
        remaining = [x for x in MACHINES if x not in owned]
        rented = random.sample(remaining, k=random.randint(0, 2)) if remaining else []
        rental_rate_map = {mc: round(random.uniform(80, 400), 0) for mc in rented}

        # Module 10: Credit
        credit_linkage = random.random() < 0.58
        credit_source = random.choice(OPTION_LISTS["credit_source"]) if credit_linkage else None
        credit_amount = round(random.uniform(20000, 500000), 0) if credit_linkage else None
        credit_interest = round(random.uniform(4, 14), 2) if credit_linkage else None
        credit_repay_months = random.choice([12, 24, 36, 48, 60]) if credit_linkage else None

        # Module 11: Schemes
        scheme_availed = random.random() < 0.5
        scheme_name = random.choice(SCHEMES) if scheme_availed else None
        scheme_benefits = f"Received financial/input support under {scheme_name}" if scheme_availed else None

        # Module 12: Irrigation
        irrigation_source = ",".join(random.sample(OPTION_LISTS["irrigation_source"], k=random.randint(1, 2)))
        irrigation_challenges = random.choice(["Erratic power supply", "Borewell water depletion", "Low pond storage", "-"])

        # Module 13: Soil & Insurance
        soil_test_done = random.random() < 0.45
        crop_insurance = random.random() < 0.4
        crop_insurance_detail = "PMFBY - Areca nut coverage" if crop_insurance else None

        # Module 14: Input supply chain
        input_source = random.choice(OPTION_LISTS["input_source"])
        input_distance = round(random.uniform(1, 25), 1)
        input_challenges = random.choice(OPTION_LISTS["input_challenges"])

        # Module 15: Tech adoption
        tech_adoption = random.random() < 0.3
        tech_adoption_detail = random.choice(["Weather advisory app", "Krishi WhatsApp group", "Farm management app", "Drone-based spraying service"]) if tech_adoption else None

        # Module 16: Metadata
        days_ago = random.randint(0, 90)
        ts = datetime.datetime.utcnow() - datetime.timedelta(days=days_ago, hours=random.randint(0, 23))
        base_lat, base_long = {
            "Shivamogga": (13.9299, 75.5681), "Chikkamagaluru": (13.3161, 75.7720),
            "Davanagere": (14.4644, 75.9218), "Tumakuru": (13.3392, 77.1010),
            "Udupi": (13.3409, 74.7421), "Dakshina Kannada": (12.9141, 74.8560),
        }[district]
        geo_lat = round(base_lat + random.uniform(-0.15, 0.15), 6)
        geo_long = round(base_long + random.uniform(-0.15, 0.15), 6)
        has_photo = random.random() < 0.7

        survey = m.FarmerSurvey(
            farmer_id=farmer_id, farmer_name=name, mobile_no=mobile, gender=gender, age=age,
            guardian_name=guardian,
            society_assoc="Yes" if society_assoc else "No", society_name=society_name,
            society_since_year=society_since_year, society_benefits=society_benefits,
            village=village, taluka=taluka, district=district,
            land_own_acres=land_own, land_leased_acres=land_leased,
            areca_area_acres=areca_area, areca_plant_count=areca_plant_count,
            cultivation_cost_inr=cultivation_cost, yield_raw_qtl=yield_raw_qtl,
            sale_type=sale_type, processing_cost_inr=processing_cost,
            marketing_channel=marketing_channel, rate_inr_per_kg=rate_per_kg,
            total_income_inr=total_income, sale_month=sale_month,
            storage_duration_months=storage_duration, storage_source=storage_source,
            logistics_provider=logistics_provider, logistics_cost_inr_per_qtl=logistics_cost,
            cultivation_challenges=cultivation_challenges,
            crop2_name=crop2_name, crop2_area_acres=crop2_area, crop2_yield=crop2_yield, crop2_rate=crop2_rate,
            crop3_name=crop3_name, crop3_area_acres=crop3_area, crop3_yield=crop3_yield, crop3_rate=crop3_rate,
            mech_owned=",".join(owned) if owned else None,
            mech_rented=",".join(rented) if rented else None,
            mech_rental_rate_inr_hr=json.dumps(rental_rate_map) if rental_rate_map else None,
            credit_linkage="Yes" if credit_linkage else "No", credit_source=credit_source,
            credit_amount_inr=credit_amount, credit_interest_rate_pct=credit_interest,
            credit_repayment_months=credit_repay_months,
            scheme_availed="Yes" if scheme_availed else "No", scheme_name=scheme_name, scheme_benefits=scheme_benefits,
            irrigation_source=irrigation_source, irrigation_challenges=irrigation_challenges,
            soil_test_done="Yes" if soil_test_done else "No",
            crop_insurance="Yes" if crop_insurance else "No", crop_insurance_detail=crop_insurance_detail,
            input_source=input_source, input_distance_km=input_distance, input_challenges=input_challenges,
            tech_adoption="Yes" if tech_adoption else "No", tech_adoption_detail=tech_adoption_detail,
            entry_timestamp=ts, geo_lat=geo_lat, geo_long=geo_long,
            field_photo=f"/photos/{farmer_id.replace('/','_')}.jpg" if has_photo else None,
            enumerator_name=random.choice(["Enum. K. Prasad", "Enum. S. Nayak", "Enum. R. Bhat", "Enum. M. Devi"]),
        )
        db.add(survey)

    db.commit()
    db.close()
    print("Seed complete: 100 farmer master + survey records, full master data loaded.")


if __name__ == "__main__":
    seed()
