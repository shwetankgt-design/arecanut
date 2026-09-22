"""
Imports the client's real FPC-Taluka mapping (Arecanut_ValueChain_DigitalPlatform
Sheet2 / FPC_Taluka) into the Society master table, creating any Taluka rows
that don't exist yet under the correct District. Replaces the placeholder
dummy societies entirely.

Run against local SQLite (default) or production Neon (set DATABASE_URL first):
    python scripts/import_fpc_taluka.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import SessionLocal, engine, Base
import app.models as m

# (District, Taluk, FPO name) — from the client's FPC_Taluka sheet.
FPC_ROWS = [
    ("Chikkamagaluru", "Ajjampura", "Shree Gurusiddarameshwara HFPCL"),
    ("Chikkamagaluru", "Chikkamagaluru", "Aldur HFPCL"),
    ("Chikkamagaluru", "Kadur", "Kalparuksha Kayakalpa HFPCL"),
    ("Chikkamagaluru", "Kadur", "Maanikya HFPCL"),
    ("Chikkamagaluru", "Tarikere", "Veeranjanaya HFPCL"),
    ("Chikkamagaluru", "Ajjampura", "Antharaghattamma FPCL"),
    ("Chikkamagaluru", "Chikkamagaluru", "Shree Vedavathi FPC"),
    ("Chikkamagaluru", "Kadur", "Bhumivadaya FPCL"),
    ("Chikkamagaluru", "Koppa", "Hirehadlu FPCL"),
    ("Chikkamagaluru", "Tarikere", "Dhanyasiri Millet FPC"),
    ("Chikkamagaluru", "Tarikere", "Jeevanadi FPCL"),
    ("Chikkamagaluru", "Ajjampura", "Ajjampura FPC"),
    ("Chikkamagaluru", "Ajjampura", "Black Earth FPC"),
    ("Chikkamagaluru", "Chikkamagaluru", "Kalahasti FPC"),
    ("Chikkamagaluru", "Kadur", "Janasiri FPC"),
    ("Chikkamagaluru", "Kadur", "Kadur Pragathi FPC"),
    ("Chikkamagaluru", "Kadur", "Vgrosell FPC"),
    ("Chikkamagaluru", "Kadur", "Yagatti FPC"),
    ("Chikkamagaluru", "Kadur", "Singatagere Punyakoti FPC"),
    ("Chikkamagaluru", "Kalasa", "Horanadu FPC"),
    ("Shivamogga", "Bhadravathi", "Holehonnur HFPCL"),
    ("Shivamogga", "Sagar", "Malnad HFPCL"),
    ("Shivamogga", "Shikaripura", "Sharavathi HFPCL"),
    ("Shivamogga", "Shikaripura", "Togarsi Sri Mallikarjuna Swamy HFPCL"),
    ("Shivamogga", "Shivamogga", "Raitamitra Hollauru HFPCL"),
    ("Shivamogga", "Shivamogga", "Thungeyasiri HFPCL"),
    ("Shivamogga", "Thirthahalli", "Kuppalli Kuvempu HFPCL"),
    ("Shivamogga", "Thirthahalli", "Mandagade FPCL"),
    ("Shivamogga", "Thirthahalli", "Thirthahalli HFPCL"),
    ("Shivamogga", "Bhadravathi", "Bhadrahasiru FPCL"),
    ("Shivamogga", "Hosanagara", "Hosanagara FPCL"),
    ("Shivamogga", "Hosanagara", "Ripponpet FPCL"),
    ("Shivamogga", "Shikaripura", "Attibylu FPCL"),
    ("Shivamogga", "Shikaripura", "Chowdanayakanakoppa FPCL"),
    ("Shivamogga", "Shikaripura", "Dindadahalli FPCL"),
    ("Shivamogga", "Shikaripura", "Harogoppa FPCL"),
    ("Shivamogga", "Shivamogga", "Doddamathali FPCL"),
    ("Shivamogga", "Shivamogga", "Sanjeevini Matturu FPCL"),
    ("Shivamogga", "Thirthahalli", "Dhatri FPCL"),
    ("Shivamogga", "Thirthahalli", "Kallukoppa FPCL"),
    ("Shivamogga", "Shikaripura", "Bandalike FPC"),
    ("Shivamogga", "Shikaripura", "KrushikaKannadiga FPC"),
    ("Shivamogga", "Shikaripura", "Punyabhoomiamruth FPC"),
    ("Shivamogga", "Shikaripura", "Shivamogga Banjara FPC"),
    ("Shivamogga", "Shikaripura", "Udutadi FPC"),
    ("Shivamogga", "Shivamogga", "Malnad Siri FPC"),
    ("Shivamogga", "Shivamogga", "Raita Shakti FPC"),
    ("Shivamogga", "Soraba", "Hanchi Bharangi FPC"),
    ("Shivamogga", "Soraba", "Malnadu Ulavi Shigga FPC"),
    ("Shivamogga", "Soraba", "Surabhipura FPC"),
    ("Shivamogga", "Bhadravathi", "Malendadu Nuts & Spices FPC"),
    ("Shivamogga", "Shikaripura", "Maravalli FPC"),
    ("Shivamogga", "Shikaripura", "Bhoomiadeya FPCL"),
    ("Shivamogga", "Shikaripura", "Sahaja Krushi FPCL"),
    ("Shivamogga", "Shikaripura", "Golden Spice FPCL"),
    ("Shivamogga", "Shivamogga", "Kuskuru Bhogi FPCL"),
    ("Shivamogga", "Shivamogga", "Kuvempu Horticulture FPCL"),
    ("Shivamogga", "Shivamogga", "Sihimogge FPCL"),
    ("Shivamogga", "Bhadravathi", "Bhadravati Farmer Producer Souhadra Cooperative Society"),
    ("Shivamogga", "Sagar", "Sagara Raitha Utpadakahara Souhadra Sahakari Sangha Niyamita"),
    ("Shivamogga", "Shikaripura", "Sri Sangameshwara Raitha Utpadakahara  Sahakara Sangha"),
    ("Shivamogga", "Shivamogga", "Sri Ramanjaneya Souhadra Raitha Utpadakahara Sahakara Sangha"),
    ("Shivamogga", "Thirthahalli", "Abhyudaya Farmer Producer Cooperative Society"),
    ("Shivamogga", "Soraba", "Sri Marikamba Souhadra Raitha Utpadakahara Sahakara Sangha"),
]

# Excel spellings ("Sagara", "Hosanagar", "Kaduru") normalized to this app's
# existing taluka names ("Sagar", "Hosanagara", "Kadur") where they refer to
# the same place, so we reuse the taluka (and its villages) rather than forking it.
TALUKA_ALIAS = {"Sagara": "Sagar", "Hosanagar": "Hosanagara", "Kaduru": "Kadur"}


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        taluka_cache = {}

        def get_or_create_taluka(district_name: str, taluka_name: str) -> int:
            taluka_name = TALUKA_ALIAS.get(taluka_name, taluka_name)
            key = (district_name, taluka_name)
            if key in taluka_cache:
                return taluka_cache[key]
            district = db.query(m.District).filter(m.District.name == district_name).first()
            if not district:
                district = m.District(name=district_name)
                db.add(district)
                db.flush()
            taluka = (
                db.query(m.Taluka)
                .filter(m.Taluka.district_id == district.id, m.Taluka.name == taluka_name)
                .first()
            )
            if not taluka:
                taluka = m.Taluka(name=taluka_name, district_id=district.id)
                db.add(taluka)
                db.flush()
            taluka_cache[key] = taluka.id
            return taluka.id

        # Replace the placeholder dummy societies entirely with the authoritative list.
        db.query(m.Society).delete()
        db.flush()

        seen_names = set()
        rows_to_insert = []
        for district_name, taluka_name, fpo_name in FPC_ROWS:
            taluka_id = get_or_create_taluka(district_name, taluka_name)
            district = db.query(m.District).filter(m.District.name == district_name).first()
            # A few FPO names repeat verbatim across rows in the source sheet
            # (different "Promoted Department" but same org) — keep first only.
            name = fpo_name if fpo_name not in seen_names else f"{fpo_name} ({taluka_name})"
            seen_names.add(name)
            rows_to_insert.append({
                "name": name,
                "district_id": district.id,
                "taluka_id": taluka_id,
                "is_state_level": False,
            })
        db.bulk_insert_mappings(m.Society, rows_to_insert)
        db.commit()
        print(f"Imported {len(rows_to_insert)} FPCs across {len(taluka_cache)} talukas.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
