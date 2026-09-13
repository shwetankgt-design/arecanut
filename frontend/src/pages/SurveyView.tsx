import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CheckCircle2, Pencil, ArrowLeft, UserSearch, Handshake, MapPin, LandPlot, Wheat,
  Coins, Warehouse, TriangleAlert, Sprout, Wrench, Truck, Smartphone, CreditCard,
  Landmark, Droplets, FlaskConical, ScanLine,
} from "lucide-react";
import { api } from "../api";
import { useLang } from "../LangContext";
import { trDistrict, trTaluka, trVillage } from "../i18n";

function Row({ label, value }: { label: string; value: any }) {
  const isEmpty = value === null || value === undefined || value === "" || value === "-";
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-[var(--gt-border)] last:border-none text-sm">
      <span className="text-[var(--gt-text-muted)]">{label}</span>
      <span className={`font-medium text-right ${isEmpty ? "text-[var(--gt-text-muted)]" : ""}`}>{isEmpty ? "—" : String(value)}</span>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="gt-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-[var(--gt-purple)]" />
        <span className="text-sm font-semibold text-[var(--gt-purple-dark)]">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function SurveyView() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const justSaved = params.get("justSaved") === "1";
  const navigate = useNavigate();
  const { lang } = useLang();
  const [s, setS] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSurvey(Number(id)).then(setS).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="text-center py-20 text-[var(--gt-danger)]">{error}</div>;
  if (!s) return <div className="text-center py-20 text-[var(--gt-text-muted)]">Loading survey…</div>;

  return (
    <div className="flex flex-col gap-4">
      {justSaved && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-3 py-2.5">
          <CheckCircle2 size={16} /> Survey saved successfully.
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">{s.farmer_name}</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">{s.farmer_id} &middot; {s.mobile_no}</p>
        </div>
        <div className="flex gap-2">
          <button className="gt-btn-secondary flex items-center gap-1.5" onClick={() => navigate("/farmers")}>
            <ArrowLeft size={15} /> Back to List
          </button>
          <button className="gt-btn-primary flex items-center gap-1.5" onClick={() => navigate(`/entry?id=${s.id}`)}>
            <Pencil size={15} /> Edit
          </button>
        </div>
      </div>

      <div className="gt-card p-4 bg-[#F1EBF7] border-none">
        <div className="text-xs text-[var(--gt-text-muted)]">Total Income from Areca (auto-calculated)</div>
        <div className="text-2xl font-bold text-[var(--gt-purple-dark)]">₹{s.total_income_inr.toLocaleString("en-IN")}</div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Section icon={UserSearch} title="Farmer Link">
          <Row label="Farmer Name" value={s.farmer_name} />
          <Row label="Mobile Number" value={s.mobile_no} />
          <Row label="Gender" value={s.gender} />
          <Row label="Age" value={s.age} />
          <Row label="Father / Husband Name" value={s.guardian_name} />
          <Row label="Farmer Unique ID" value={s.farmer_id} />
        </Section>

        <Section icon={Handshake} title="Society / FPC Linkage">
          <Row label="Associated" value={s.society_assoc} />
          {s.society_assoc === "Yes" && (
            <>
              <Row label="Society / FPC Name" value={s.society_name} />
              <Row label="Since (Year)" value={s.society_since_year} />
              <Row label="Benefits" value={s.society_benefits?.split(",").join(", ")} />
            </>
          )}
        </Section>

        <Section icon={MapPin} title="Location">
          <Row label="Village" value={trVillage(s.village, lang)} />
          <Row label="Taluka" value={trTaluka(s.taluka, lang)} />
          <Row label="District" value={trDistrict(s.district, lang)} />
        </Section>

        <Section icon={LandPlot} title="Land Holding">
          <Row label="Own Land (Acres)" value={s.land_own_acres} />
          <Row label="Leased Land (Acres)" value={s.land_leased_acres} />
          <Row label="Areca Area (Acres)" value={s.areca_area_acres} />
          <Row label="Plant Count" value={s.areca_plant_count} />
        </Section>

        <Section icon={Wheat} title="Cultivation Cost & Yield">
          <Row label="Annual Cost (INR)" value={s.cultivation_cost_inr?.toLocaleString("en-IN")} />
          <Row label="Raw Yield (Qtl)" value={s.yield_raw_qtl} />
        </Section>

        <Section icon={Coins} title="Sales, Marketing & Income">
          <Row label="Sale Type" value={s.sale_type} />
          {s.sale_type === "Sold processed areca" && <Row label="Processing Cost (INR)" value={s.processing_cost_inr} />}
          <Row label="Marketing Channel" value={s.marketing_channel} />
          <Row label="Rate (INR/kg)" value={s.rate_inr_per_kg} />
          <Row label="Month of Sale" value={s.sale_month} />
        </Section>

        <Section icon={Warehouse} title="Storage & Logistics">
          <Row label="Storage Duration (Months)" value={s.storage_duration_months} />
          <Row label="Storage Source" value={s.storage_source} />
          <Row label="Logistics Provider" value={s.logistics_provider} />
          <Row label="Logistics Cost (INR/Qtl)" value={s.logistics_cost_inr_per_qtl} />
        </Section>

        <Section icon={TriangleAlert} title="Cultivation Challenges">
          <Row label="Challenges" value={s.cultivation_challenges?.split(",").join(", ")} />
        </Section>

        <Section icon={Sprout} title="Other Crops (Diversification)">
          <Row label="Crop 2" value={s.crop2_name} />
          {s.crop2_name && (
            <>
              <Row label="Crop 2 Area (Acres)" value={s.crop2_area_acres} />
              <Row label="Crop 2 Yield" value={s.crop2_yield} />
              <Row label="Crop 2 Rate" value={s.crop2_rate} />
            </>
          )}
          <Row label="Crop 3" value={s.crop3_name} />
          {s.crop3_name && (
            <>
              <Row label="Crop 3 Area (Acres)" value={s.crop3_area_acres} />
              <Row label="Crop 3 Yield" value={s.crop3_yield} />
              <Row label="Crop 3 Rate" value={s.crop3_rate} />
            </>
          )}
        </Section>

        <Section icon={Wrench} title="Farm Mechanisation">
          <Row label="Owned Machines" value={s.mech_owned?.split(",").join(", ")} />
          <Row label="Rented Machines" value={s.mech_rented?.split(",").join(", ")} />
        </Section>

        <Section icon={Truck} title="Input Supply Chain">
          <Row label="Source" value={s.input_source} />
          <Row label="Distance (Km)" value={s.input_distance_km} />
          <Row label="Challenges" value={s.input_challenges} />
        </Section>

        <Section icon={Smartphone} title="Technology Adoption">
          <Row label="Adopted" value={s.tech_adoption} />
          {s.tech_adoption === "Yes" && <Row label="Details" value={s.tech_adoption_detail} />}
        </Section>

        <Section icon={CreditCard} title="Credit & Finance">
          <Row label="Credit Linkage" value={s.credit_linkage} />
          {s.credit_linkage === "Yes" && (
            <>
              <Row label="Source" value={s.credit_source} />
              <Row label="Amount (INR)" value={s.credit_amount_inr} />
              <Row label="Interest Rate (%)" value={s.credit_interest_rate_pct} />
              <Row label="Repayment (Months)" value={s.credit_repayment_months} />
            </>
          )}
        </Section>

        <Section icon={Landmark} title="Government Schemes">
          <Row label="Availed" value={s.scheme_availed} />
          {s.scheme_availed === "Yes" && (
            <>
              <Row label="Scheme Name" value={s.scheme_name} />
              <Row label="Benefits" value={s.scheme_benefits} />
            </>
          )}
        </Section>

        <Section icon={Droplets} title="Irrigation">
          <Row label="Sources" value={s.irrigation_source?.split(",").join(", ")} />
          <Row label="Challenges" value={s.irrigation_challenges} />
        </Section>

        <Section icon={FlaskConical} title="Soil Health & Crop Insurance">
          <Row label="Soil Test Done" value={s.soil_test_done} />
          <Row label="Crop Insurance" value={s.crop_insurance} />
          {s.crop_insurance === "Yes" && <Row label="Insurance Detail" value={s.crop_insurance_detail} />}
        </Section>

        <Section icon={ScanLine} title="Geo-tag & Metadata">
          <Row label="Geo Location" value={s.geo_lat ? `${s.geo_lat}, ${s.geo_long}` : null} />
          <Row label="Field Photo" value={s.field_photo} />
          <Row label="Enumerator" value={s.enumerator_name} />
          <Row label="Entry Timestamp" value={s.entry_timestamp ? new Date(s.entry_timestamp).toLocaleString() : null} />
        </Section>
      </div>
    </div>
  );
}
