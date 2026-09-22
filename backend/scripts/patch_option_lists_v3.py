"""
One-off data patch for the client's "List of Formulas and Validations" feedback
round (v3). Updates master dropdown/multi-select option lists (m_option),
machine list (m_machine), and adds new option-list codes the wizard now uses.

Run against local SQLite (default) or production Neon (set DATABASE_URL first):
    python scripts/patch_option_lists_v3.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import SessionLocal, engine, Base
import app.models as m

# Existing list_codes get their rows replaced entirely (old free-text answers
# already saved on surveys are untouched — they're just strings on the row).
OPTION_LISTS = {
    "society_benefits": [
        "Commodity Finance", "Credit Support", "Market Linkage", "Storage",
        "Advisory Support", "Government Scheme Convergence", "Agri Input",
        "Personal Health Insurance", "Any Other",
    ],
    "marketing_channel": [
        "FPC/FPO", "Cooperative Society", "APMC", "Commission Agent", "Local Trader", "Any Other",
    ],
    "storage_source": [
        "Own Home/Godown", "APMC Warehouse", "Society Warehouse", "Pledge (Godown)", "FPC/FPO", "Commission Agent",
    ],
    "credit_source": [
        "Bank", "NBFCs", "SHGs", "Cooperative Society", "Trader/Commission Agent",
        "Relatives", "Local Money Lender", "Other",
    ],
    "cultivation_challenges": [
        "Pest & Disease Management", "Irrigation", "Input Availability", "Labour Shortage",
        "Availability of Farm Machinery", "Other",
    ],
    "input_source": [
        "Cooperative Society", "FPC/FPO", "Local Input Shop", "Wholesalers/Distributors", "Other",
    ],
    # New list codes introduced by this round of changes.
    "non_farm_income_source": [
        "Dairy/Livestock", "Wage Labour", "Business/Shop", "Salaried Employment",
        "Remittances", "Pension", "Other", "None",
    ],
    "intercrop_crops": ["Coffee", "Pepper", "Cocoa", "Any Other"],
    "loan_rejection_reason": [
        "Insufficient Collateral", "Documentation Issues", "Land Ownership Issues",
        "Low Repayment Capacity", "Existing Debt Obligations", "Poor Credit History", "Other",
    ],
}

MACHINES = [
    "Harvesting Pole", "Sprayer Machine", "Weed Cutter Machine",
    "Arecanut Dehusking Machine", "Arecanut Polishing Machine", "Any Other",
]


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for code, labels in OPTION_LISTS.items():
            db.query(m.OptionMaster).filter(m.OptionMaster.list_code == code).delete()
            db.bulk_insert_mappings(m.OptionMaster, [
                {"list_code": code, "label": label, "sort_order": i}
                for i, label in enumerate(labels)
            ])
            print(f"  {code}: {len(labels)} options")

        db.query(m.MachineMaster).delete()
        db.bulk_insert_mappings(m.MachineMaster, [{"name": mc} for mc in MACHINES])
        print(f"  machines: {len(MACHINES)} options")

        db.commit()
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
