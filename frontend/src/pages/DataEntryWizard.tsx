import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Search, CheckCircle2, MapPin, Camera, Check,
  UserSearch, Handshake, LandPlot, Wheat, Coins, Warehouse,
  TriangleAlert, Sprout, Wrench, CreditCard, Landmark, Droplets, FlaskConical,
  Truck, Smartphone, ScanLine, AlertCircle,
} from "lucide-react";
import { api } from "../api";
import { trDistrict, trTaluka, trVillage, tr } from "../i18n";
import { useLang } from "../LangContext";
import { queueSurvey } from "../offlineQueue";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// 17 data-collection modules regrouped into 8 broader tabs so the wizard has
// fewer top-level steps to page through. Every field/module below keeps its
// original name and count — only the tab grouping changed.
const STEPS = [
  { label: "Farmer & Location", hint: "Farmer identity, society link & location", icon: UserSearch },
  { label: "Land & Production", hint: "Land holding, cultivation cost & yield", icon: LandPlot },
  { label: "Sales & Logistics", hint: "Sale, income, storage & transport", icon: Coins },
  { label: "Diversification & Challenges", hint: "Other crops & cultivation challenges", icon: Sprout },
  { label: "Mechanisation & Inputs", hint: "Equipment, input sourcing & technology", icon: Wrench },
  { label: "Finance & Schemes", hint: "Credit access & government schemes", icon: CreditCard },
  { label: "Irrigation & Sustainability", hint: "Water source, soil health & insurance", icon: Droplets },
  { label: "Geo-tag & Review", hint: "GPS, photo & final check", icon: ScanLine },
];

const empty: any = {
  farmer_id: "", farmer_name: "", mobile_no: "", gender: "Male", age: "", guardian_name: "",
  society_assoc: "No", society_name: "", society_since_year: "", society_benefits: [],
  village: "", taluka: "", district: "",
  land_own_acres: "", land_leased_acres: "", areca_area_acres: "", areca_plant_count: "",
  cultivation_cost_inr: "", yield_raw_qtl: "",
  sale_type: "Sold raw areca", processing_cost_inr: "", marketing_channel: "FPO",
  rate_inr_per_kg: "", sale_month: "Jan",
  storage_duration_months: "", storage_source: "", logistics_provider: "", logistics_cost_inr_per_qtl: "",
  cultivation_challenges: [],
  crop2_name: "", crop2_area_acres: "", crop2_yield: "", crop2_rate: "",
  crop3_name: "", crop3_area_acres: "", crop3_yield: "", crop3_rate: "",
  mech_owned: [], mech_rented: [], mech_rental_rate: {},
  credit_linkage: "No", credit_source: "", credit_amount_inr: "", credit_interest_rate_pct: "", credit_repayment_months: "",
  scheme_availed: "No", scheme_name: "", scheme_benefits: "",
  irrigation_source: [], irrigation_challenges: "",
  soil_test_done: "No", crop_insurance: "No", crop_insurance_detail: "",
  input_source: "Society", input_distance_km: "", input_challenges: "",
  tech_adoption: "No", tech_adoption_detail: "",
  geo_lat: "", geo_long: "", field_photo: "", enumerator_name: "",
};

// Maps every validated field to the tab it lives on, so a submit-time error can
// jump the user straight to the right tab instead of just complaining.
const FIELD_STEP: Record<string, number> = {
  farmer_name: 0, mobile_no: 0, gender: 0, age: 0, farmer_id: 0,
  society_name: 0, society_since_year: 0, village: 0, taluka: 0, district: 0,
  land_own_acres: 1, areca_area_acres: 1, areca_plant_count: 1, cultivation_cost_inr: 1, yield_raw_qtl: 1,
  processing_cost_inr: 2, rate_inr_per_kg: 2,
  crop2_area_acres: 3, crop2_yield: 3, crop2_rate: 3, crop3_area_acres: 3, crop3_yield: 3, crop3_rate: 3,
  mech_rental_rate: 4, tech_adoption_detail: 4,
  credit_source: 5, credit_amount_inr: 5, credit_interest_rate_pct: 5, credit_repayment_months: 5,
  scheme_name: 5, scheme_benefits: 5,
  irrigation_source: 6, crop_insurance_detail: 6,
};

function isBlank(v: any) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

/** Full-form validation used both per-tab (on Next) and in full (on Submit).
 * Returns a flat map of field -> user-facing error message. */
function getErrors(form: any): Record<string, string> {
  const e: Record<string, string> = {};

  // --- Farmer & Location ---
  if (isBlank(form.farmer_name)) e.farmer_name = "Farmer name is required.";
  if (isBlank(form.mobile_no)) e.mobile_no = "Mobile number is required.";
  else if (!/^\d{10}$/.test(String(form.mobile_no).trim())) e.mobile_no = "Enter a valid 10-digit mobile number.";
  if (isBlank(form.age)) e.age = "Age is required.";
  else if (Number(form.age) < 18 || Number(form.age) > 80) e.age = "Age must be between 18 and 80.";
  if (isBlank(form.farmer_id)) e.farmer_id = "Farmer unique ID is required.";
  if (form.society_assoc === "Yes") {
    if (isBlank(form.society_name)) e.society_name = "Society / FPC name is required.";
    if (isBlank(form.society_since_year)) e.society_since_year = "Membership year is required.";
    else if (Number(form.society_since_year) > new Date().getFullYear()) e.society_since_year = "Year cannot be in the future.";
  }
  if (isBlank(form.village)) e.village = "Village is required.";
  if (isBlank(form.taluka)) e.taluka = "Taluka could not be determined — reselect the village.";
  if (isBlank(form.district)) e.district = "District could not be determined — reselect the village.";

  // --- Land & Production ---
  if (isBlank(form.land_own_acres)) e.land_own_acres = "Own land holding is required.";
  else if (Number(form.land_own_acres) <= 0) e.land_own_acres = "Must be greater than 0.";
  if (isBlank(form.areca_area_acres)) e.areca_area_acres = "Areca cultivation area is required.";
  else if (Number(form.areca_area_acres) <= 0) e.areca_area_acres = "Must be greater than 0.";
  else if (Number(form.areca_area_acres) > (Number(form.land_own_acres) || 0) + (Number(form.land_leased_acres) || 0)) {
    e.areca_area_acres = "Cannot exceed total own + leased land.";
  }
  if (isBlank(form.areca_plant_count)) e.areca_plant_count = "Total plant count is required.";
  else if (Number(form.areca_plant_count) <= 0) e.areca_plant_count = "Must be a whole number greater than 0.";
  if (isBlank(form.cultivation_cost_inr)) e.cultivation_cost_inr = "Cultivation cost is required.";
  else if (Number(form.cultivation_cost_inr) <= 0) e.cultivation_cost_inr = "Must be greater than 0.";
  if (isBlank(form.yield_raw_qtl)) e.yield_raw_qtl = "Raw yield is required.";

  // --- Sales & Logistics ---
  if (form.sale_type === "Sold processed areca" && isBlank(form.processing_cost_inr)) {
    e.processing_cost_inr = "Processing cost is required for a processed sale.";
  }
  if (isBlank(form.rate_inr_per_kg)) e.rate_inr_per_kg = "Rate realised is required.";
  else if (Number(form.rate_inr_per_kg) <= 0) e.rate_inr_per_kg = "Must be greater than 0.";

  // --- Diversification & Challenges ---
  [2, 3].forEach((n) => {
    if (!isBlank(form[`crop${n}_name`])) {
      if (isBlank(form[`crop${n}_area_acres`])) e[`crop${n}_area_acres`] = "Area is required once a crop name is entered.";
      if (isBlank(form[`crop${n}_yield`])) e[`crop${n}_yield`] = "Yield is required once a crop name is entered.";
      if (isBlank(form[`crop${n}_rate`])) e[`crop${n}_rate`] = "Rate is required once a crop name is entered.";
    }
  });

  // --- Mechanisation & Inputs ---
  if (form.mech_rented?.length) {
    const missingRate = form.mech_rented.some((mc: string) => isBlank(form.mech_rental_rate?.[mc]));
    if (missingRate) e.mech_rental_rate = "Enter an hourly rate for every rented machine.";
  }
  if (form.tech_adoption === "Yes" && isBlank(form.tech_adoption_detail)) {
    e.tech_adoption_detail = "Please describe the technology used.";
  }

  // --- Finance & Schemes ---
  if (form.credit_linkage === "Yes") {
    if (isBlank(form.credit_source)) e.credit_source = "Credit source is required.";
    if (isBlank(form.credit_amount_inr)) e.credit_amount_inr = "Loan amount is required.";
    if (isBlank(form.credit_interest_rate_pct)) e.credit_interest_rate_pct = "Interest rate is required.";
    else if (Number(form.credit_interest_rate_pct) < 0 || Number(form.credit_interest_rate_pct) > 100) e.credit_interest_rate_pct = "Enter a value between 0 and 100.";
    if (isBlank(form.credit_repayment_months)) e.credit_repayment_months = "Repayment period is required.";
  }
  if (form.scheme_availed === "Yes") {
    if (isBlank(form.scheme_name)) e.scheme_name = "Scheme name is required.";
    if (isBlank(form.scheme_benefits)) e.scheme_benefits = "Describe the benefits received.";
  }

  // --- Irrigation & Sustainability ---
  if (isBlank(form.irrigation_source)) e.irrigation_source = "Select at least one irrigation source.";
  if (form.crop_insurance === "Yes" && isBlank(form.crop_insurance_detail)) {
    e.crop_insurance_detail = "Insurance detail is required.";
  }

  return e;
}

function Field({ label, required, error, children }: any) {
  return (
    <div className="mb-4">
      <label className="gt-label">{label} {required && <span className="text-[var(--gt-danger)]">*</span>}</label>
      <div className={error ? "field-error" : ""}>{children}</div>
      {error && (
        <div className="flex items-center gap-1 text-xs text-[var(--gt-danger)] mt-1">
          <AlertCircle size={12} /> {error}
        </div>
      )}
    </div>
  );
}

function YesNo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="gt-toggle-yn">
      <button type="button" className={value === "Yes" ? "active-yes" : ""} onClick={() => onChange("Yes")}>Yes</button>
      <button type="button" className={value === "No" ? "active-no" : ""} onClick={() => onChange("No")}>No</button>
    </div>
  );
}

function MultiChip({ options, value, onToggle }: { options: string[]; value: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <div key={opt} className={`gt-chip ${value.includes(opt) ? "active" : ""}`} onClick={() => onToggle(opt)}>
          {value.includes(opt) && <CheckCircle2 size={14} />} {opt}
        </div>
      ))}
    </div>
  );
}

// Groups a merged sub-module (its own original field-set) inside a broader tab,
// so several of the original 17 modules can share one tab without losing their identity.
function SubSection({ icon: Icon, title, first, children }: { icon: any; title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className={`${first ? "" : "border-t border-[var(--gt-border)] pt-4 mt-4"}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className="text-[var(--gt-purple)]" />
        <span className="text-sm font-semibold text-[var(--gt-purple-dark)]">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function DataEntryWizard() {
  const [params] = useSearchParams();
  const editId = params.get("id");
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<any>(empty);
  const [lookupQ, setLookupQ] = useState("");
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [villagesFlat, setVillagesFlat] = useState<{ village: string; taluka: string; district: string }[]>([]);
  const [societies, setSocieties] = useState<string[]>([]);
  const [crops, setCrops] = useState<string[]>([]);
  const [schemes, setSchemes] = useState<string[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [opts, setOpts] = useState<Record<string, string[]>>({});
  const { lang } = useLang();
  const [villageQuery, setVillageQuery] = useState("");

  useEffect(() => {
    api.villagesFlat().then(setVillagesFlat);
    api.societies().then(setSocieties);
    api.crops().then(setCrops);
    api.schemes().then(setSchemes);
    api.machines().then(setMachines);
    Promise.all(
      ["society_benefits", "cultivation_challenges", "storage_source", "logistics_provider",
        "credit_source", "irrigation_source", "input_source", "input_challenges", "marketing_channel"]
        .map((code) => api.options(code).then((v: string[]) => [code, v]))
    ).then((entries) => setOpts(Object.fromEntries(entries)));
  }, []);

  useEffect(() => {
    if (editId) {
      api.getSurvey(Number(editId)).then((s: any) => {
        setForm({
          ...s,
          society_benefits: s.society_benefits ? s.society_benefits.split(",") : [],
          cultivation_challenges: s.cultivation_challenges ? s.cultivation_challenges.split(",") : [],
          mech_owned: s.mech_owned ? s.mech_owned.split(",") : [],
          mech_rented: s.mech_rented ? s.mech_rented.split(",") : [],
          mech_rental_rate: s.mech_rental_rate_inr_hr ? JSON.parse(s.mech_rental_rate_inr_hr) : {},
          irrigation_source: s.irrigation_source ? s.irrigation_source.split(",") : [],
        });
      });
    }
  }, [editId]);

  const clearError = (k: string) =>
    setErrors((prev) => {
      if (!(k in prev)) return prev;
      const { [k]: _, ...rest } = prev;
      return rest;
    });

  const set = (k: string, v: any) => {
    setForm((f: any) => ({ ...f, [k]: v }));
    clearError(k);
  };
  const toggleMulti = (k: string, v: string) => {
    setForm((f: any) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x: string) => x !== v) : [...f[k], v] }));
    clearError(k);
  };

  const computedIncome = useMemo(() => {
    const y = parseFloat(form.yield_raw_qtl) || 0;
    const r = parseFloat(form.rate_inr_per_kg) || 0;
    const c = parseFloat(form.cultivation_cost_inr) || 0;
    const p = form.sale_type === "Sold processed areca" ? (parseFloat(form.processing_cost_inr) || 0) : 0;
    return Math.round(y * r * 100 - c - p);
  }, [form.yield_raw_qtl, form.rate_inr_per_kg, form.cultivation_cost_inr, form.processing_cost_inr, form.sale_type]);

  const doLookup = async () => {
    setLookupMsg(null);
    try {
      const res = await api.lookupFarmer(lookupQ);
      setForm((f: any) => ({
        ...f,
        farmer_id: res.farmer_id, farmer_name: res.farmer_name, mobile_no: res.mobile_no,
        gender: res.gender, age: res.age, guardian_name: res.guardian_name || "",
        district: res.district || f.district, taluka: res.taluka || f.taluka, village: res.village || f.village,
      }));
      setLookupMsg("Farmer found and details auto-filled from Registration Portal.");
    } catch (e: any) {
      setLookupMsg(e.message || "Farmer not found.");
    }
  };

  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "done" | "error">("idle");

  const captureGeo = () => {
    if (!navigator.geolocation) {
      setGeoStatus("error");
      return;
    }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set("geo_lat", pos.coords.latitude.toFixed(6));
        set("geo_long", pos.coords.longitude.toFixed(6));
        setGeoStatus("done");
      },
      () => setGeoStatus("error"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Auto-capture device GPS as soon as the survey form is opened, so every
  // entry (and any photo taken later) is geo-tagged automatically without
  // the enumerator having to remember a manual step.
  useEffect(() => {
    captureGeo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attachPhoto = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    set("field_photo", `/photos/${form.farmer_id || "capture"}_${stamp}.jpg`);
    // Photo is stamped with whatever GPS fix we already have; if none yet, try again now.
    if (!form.geo_lat) captureGeo();
  };

  const jumpToFirstError = (errs: Record<string, string>) => {
    const steps = Object.keys(errs).map((f) => FIELD_STEP[f] ?? step);
    if (steps.length) setStep(Math.min(...steps));
  };

  const submit = async () => {
    setSubmitError(null);
    const validationErrors = getErrors(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      jumpToFirstError(validationErrors);
      setSubmitError(`Please fix ${Object.keys(validationErrors).length} error(s) before submitting.`);
      return;
    }

    setSubmitting(true);
    const payload = {
      ...form,
      age: parseInt(form.age) || 0,
      society_since_year: form.society_since_year ? parseInt(form.society_since_year) : null,
      society_benefits: form.society_benefits.join(","),
      land_own_acres: parseFloat(form.land_own_acres) || 0,
      land_leased_acres: parseFloat(form.land_leased_acres) || 0,
      areca_area_acres: parseFloat(form.areca_area_acres) || 0,
      areca_plant_count: parseInt(form.areca_plant_count) || 0,
      cultivation_cost_inr: parseFloat(form.cultivation_cost_inr) || 0,
      yield_raw_qtl: parseFloat(form.yield_raw_qtl) || 0,
      processing_cost_inr: form.processing_cost_inr ? parseFloat(form.processing_cost_inr) : null,
      rate_inr_per_kg: parseFloat(form.rate_inr_per_kg) || 0,
      storage_duration_months: form.storage_duration_months ? parseFloat(form.storage_duration_months) : null,
      logistics_cost_inr_per_qtl: form.logistics_cost_inr_per_qtl ? parseFloat(form.logistics_cost_inr_per_qtl) : null,
      cultivation_challenges: form.cultivation_challenges.join(","),
      crop2_area_acres: form.crop2_area_acres ? parseFloat(form.crop2_area_acres) : null,
      crop2_yield: form.crop2_yield ? parseFloat(form.crop2_yield) : null,
      crop2_rate: form.crop2_rate ? parseFloat(form.crop2_rate) : null,
      crop3_area_acres: form.crop3_area_acres ? parseFloat(form.crop3_area_acres) : null,
      crop3_yield: form.crop3_yield ? parseFloat(form.crop3_yield) : null,
      crop3_rate: form.crop3_rate ? parseFloat(form.crop3_rate) : null,
      mech_owned: form.mech_owned.join(","),
      mech_rented: form.mech_rented.join(","),
      mech_rental_rate_inr_hr: JSON.stringify(form.mech_rental_rate || {}),
      credit_amount_inr: form.credit_amount_inr ? parseFloat(form.credit_amount_inr) : null,
      credit_interest_rate_pct: form.credit_interest_rate_pct ? parseFloat(form.credit_interest_rate_pct) : null,
      credit_repayment_months: form.credit_repayment_months ? parseInt(form.credit_repayment_months) : null,
      irrigation_source: form.irrigation_source.join(","),
      input_distance_km: form.input_distance_km ? parseFloat(form.input_distance_km) : null,
      geo_lat: form.geo_lat ? parseFloat(form.geo_lat) : null,
      geo_long: form.geo_long ? parseFloat(form.geo_long) : null,
    };
    delete payload.id;
    delete payload.entry_timestamp;
    delete payload.total_income_inr;

    // Offline-first: if there's no connectivity (or the request itself fails to
    // reach the server), queue the survey locally instead of losing the data —
    // it syncs automatically the next time the device comes back online.
    if (!navigator.onLine) {
      await queueSurvey(payload, !!editId, editId ? Number(editId) : undefined);
      setSubmitting(false);
      navigate("/farmers?queued=1");
      return;
    }
    try {
      const saved = editId ? await api.updateSurvey(Number(editId), payload) : await api.createSurvey(payload);
      navigate(`/farmers/${saved.id}?justSaved=1`);
    } catch (e) {
      await queueSurvey(payload, !!editId, editId ? Number(editId) : undefined);
      setSubmitting(false);
      navigate("/farmers?queued=1");
    }
  };

  const next = () => {
    const stepErrors = getErrors(form);
    // Only block on errors that belong to the tab the user is currently on —
    // later tabs get validated too, but only once the user actually reaches them
    // or hits Submit, so a first pass through the wizard doesn't feel like a wall.
    const blockingErrors = Object.fromEntries(Object.entries(stepErrors).filter(([f]) => (FIELD_STEP[f] ?? 0) === step));
    setErrors((prev) => ({ ...prev, ...stepErrors }));
    if (Object.keys(blockingErrors).length > 0) {
      setSubmitError(`Please fix ${Object.keys(blockingErrors).length} error(s) on this tab before continuing.`);
      return;
    }
    setSubmitError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const CurrentIcon = STEPS[step].icon;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">{editId ? "Edit Farmer Survey" : "New Farmer Survey"}</h1>
        <span className="text-xs font-medium text-[var(--gt-text-muted)] bg-[#F1EBF7] px-2.5 py-1 rounded-full whitespace-nowrap">
          {step + 1} of {STEPS.length}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl gt-gradient text-white flex items-center justify-center shrink-0">
          <CurrentIcon size={22} />
        </div>
        <div>
          <div className="text-base font-semibold text-[var(--gt-purple-dark)] leading-tight">{STEPS[step].label}</div>
          <p className="text-sm text-[var(--gt-text-muted)] leading-tight">{STEPS[step].hint}</p>
        </div>
      </div>

      <div className="w-full h-1.5 bg-[var(--gt-border)] rounded-full overflow-hidden">
        <div className="h-full gt-gradient transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isDone = i < step;
          const isActive = i === step;
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setStep(i)}
              title={s.label}
              className={`shrink-0 flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-full border whitespace-nowrap transition-colors ${
                isActive
                  ? "gt-gradient text-white border-transparent shadow-sm"
                  : isDone
                  ? "bg-[#F1EBF7] text-[var(--gt-purple-dark)] border-[var(--gt-purple-light)]"
                  : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
              }`}
            >
              {isDone ? <Check size={14} /> : <Icon size={14} />}
              {s.label}
            </button>
          );
        })}
      </div>

      {submitError && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
          <AlertCircle size={16} /> {submitError}
        </div>
      )}

      <div className="gt-card p-4 md:p-6">
        {step === 0 && (
          <>
            <SubSection icon={UserSearch} title="Farmer Link" first>
              <Field label="Search Farmer (Aadhaar / Mobile / Farmer ID)">
                <div className="flex gap-2">
                  <input className="gt-input" placeholder="e.g. 9876543210 or NCCF/KA/0007" value={lookupQ} onChange={(e) => setLookupQ(e.target.value)} />
                  <button className="gt-btn-primary flex items-center gap-1.5 px-4" onClick={doLookup}><Search size={16} /> Fetch</button>
                </div>
                {lookupMsg && <div className="text-xs mt-2 text-[var(--gt-purple-dark)]">{lookupMsg}</div>}
              </Field>
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Farmer Name" required error={errors.farmer_name}><input className="gt-input" value={form.farmer_name} onChange={(e) => set("farmer_name", e.target.value)} /></Field>
                <Field label="Mobile Number" required error={errors.mobile_no}><input className="gt-input" value={form.mobile_no} onChange={(e) => set("mobile_no", e.target.value)} /></Field>
                <Field label="Gender" required>
                  <select className="gt-input" value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                    <option>Male</option><option>Female</option>
                  </select>
                </Field>
                <Field label="Age" required error={errors.age}><input type="number" className="gt-input" value={form.age} onChange={(e) => set("age", e.target.value)} /></Field>
                <Field label="Father / Husband Name"><input className="gt-input" value={form.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} /></Field>
                <Field label="Farmer Unique ID" required error={errors.farmer_id}><input className="gt-input" value={form.farmer_id} onChange={(e) => set("farmer_id", e.target.value)} /></Field>
              </div>
            </SubSection>

            <SubSection icon={Handshake} title="Society / FPC Linkage">
              <Field label="Associated with any Society or FPC" required><YesNo value={form.society_assoc} onChange={(v) => set("society_assoc", v)} /></Field>
              {form.society_assoc === "Yes" && (
                <div className="grid md:grid-cols-2 gap-x-4">
                  <Field label="Society / FPC Name" required error={errors.society_name}>
                    <input className="gt-input" list="society-list" value={form.society_name} onChange={(e) => set("society_name", e.target.value)} />
                    <datalist id="society-list">{societies.map((s) => <option key={s} value={s} />)}</datalist>
                  </Field>
                  <Field label="Associated Since (Year)" required error={errors.society_since_year}><input type="number" className="gt-input" value={form.society_since_year} onChange={(e) => set("society_since_year", e.target.value)} /></Field>
                  <Field label="Benefits Received till Date">
                    <MultiChip options={opts.society_benefits || []} value={form.society_benefits} onToggle={(v) => toggleMulti("society_benefits", v)} />
                  </Field>
                </div>
              )}
            </SubSection>

            <SubSection icon={MapPin} title="Location Details">
              <div className="text-sm text-[var(--gt-text-muted)] mb-4">Type or pick a village — taluka, district & state fill in automatically.</div>

              <Field label={tr("quickSearch", lang)} required error={errors.village}>
                <input
                  className="gt-input"
                  list="village-flat-list"
                  placeholder={lang === "kn" ? "ಗ್ರಾಮದ ಹೆಸರು ಟೈಪ್ ಮಾಡಿ…" : "Start typing a village name…"}
                  value={villageQuery || trVillage(form.village, lang)}
                  onChange={(e) => {
                    const typed = e.target.value;
                    setVillageQuery(typed);
                    const match = villagesFlat.find(
                      (v) => v.village === typed || trVillage(v.village, lang) === typed
                    );
                    if (match) {
                      set("village", match.village);
                      set("taluka", match.taluka);
                      set("district", match.district);
                      setVillageQuery("");
                    }
                  }}
                />
                <datalist id="village-flat-list">
                  {villagesFlat.map((v) => (
                    <option key={v.village} value={lang === "kn" ? trVillage(v.village, lang) : v.village}>
                      {lang === "kn"
                        ? `${trTaluka(v.taluka, lang)}, ${trDistrict(v.district, lang)}`
                        : `${v.taluka}, ${v.district}`}
                    </option>
                  ))}
                </datalist>
              </Field>

              <div className="grid md:grid-cols-3 gap-x-4">
                <Field label={tr("village", lang)} required error={errors.village}>
                  <select
                    className="gt-input"
                    value={form.village}
                    onChange={(e) => {
                      set("village", e.target.value);
                      const match = villagesFlat.find((v) => v.village === e.target.value);
                      if (match) { set("taluka", match.taluka); set("district", match.district); }
                    }}
                  >
                    <option value="">{tr("select", lang)}</option>
                    {villagesFlat.map((v) => (
                      <option key={v.village} value={v.village}>{trVillage(v.village, lang)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={`${tr("taluka", lang)} (auto-filled)`}>
                  <input className="gt-input bg-[#F6F4F9]" readOnly value={trTaluka(form.taluka, lang) || "—"} />
                </Field>
                <Field label={`${tr("district", lang)} (auto-filled)`}>
                  <input className="gt-input bg-[#F6F4F9]" readOnly value={trDistrict(form.district, lang) || "—"} />
                </Field>
                <Field label={tr("state", lang)}>
                  <input className="gt-input bg-[#F6F4F9]" readOnly value={tr("karnataka", lang)} />
                </Field>
              </div>
            </SubSection>
          </>
        )}

        {step === 1 && (
          <>
            <SubSection icon={LandPlot} title="Land Holding" first>
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Total Own Land Holding (Acres)" required error={errors.land_own_acres}><input type="number" className="gt-input" value={form.land_own_acres} onChange={(e) => set("land_own_acres", e.target.value)} /></Field>
                <Field label="Total Leased Land (Acres)"><input type="number" className="gt-input" value={form.land_leased_acres} onChange={(e) => set("land_leased_acres", e.target.value)} /></Field>
                <Field label="Total Area under Areca Cultivation (Acres)" required error={errors.areca_area_acres}>
                  <input type="number" className="gt-input" value={form.areca_area_acres} onChange={(e) => set("areca_area_acres", e.target.value)} />
                </Field>
                <Field label="Total No. of Areca Plants" required error={errors.areca_plant_count}><input type="number" className="gt-input" value={form.areca_plant_count} onChange={(e) => set("areca_plant_count", e.target.value)} /></Field>
              </div>
            </SubSection>

            <SubSection icon={Wheat} title="Cultivation Cost & Yield">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Total Annual Cost of Cultivation (INR)" required error={errors.cultivation_cost_inr}><input type="number" className="gt-input" value={form.cultivation_cost_inr} onChange={(e) => set("cultivation_cost_inr", e.target.value)} /></Field>
                <Field label="Yield (Raw Areca) (Qtl)" required error={errors.yield_raw_qtl}><input type="number" className="gt-input" value={form.yield_raw_qtl} onChange={(e) => set("yield_raw_qtl", e.target.value)} /></Field>
              </div>
            </SubSection>
          </>
        )}

        {step === 2 && (
          <>
            <SubSection icon={Coins} title="Sales, Marketing & Income" first>
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Sale Type" required>
                  <select className="gt-input" value={form.sale_type} onChange={(e) => set("sale_type", e.target.value)}>
                    <option>Sold raw areca</option><option>Sold processed areca</option>
                  </select>
                </Field>
                {form.sale_type === "Sold processed areca" && (
                  <Field label="Total Processing Cost (INR)" required error={errors.processing_cost_inr}><input type="number" className="gt-input" value={form.processing_cost_inr} onChange={(e) => set("processing_cost_inr", e.target.value)} /></Field>
                )}
                <Field label="Marketing Channel" required>
                  <select className="gt-input" value={form.marketing_channel} onChange={(e) => set("marketing_channel", e.target.value)}>
                    {(opts.marketing_channel || []).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Rate Realised (INR/kg)" required error={errors.rate_inr_per_kg}><input type="number" className="gt-input" value={form.rate_inr_per_kg} onChange={(e) => set("rate_inr_per_kg", e.target.value)} /></Field>
                <Field label="Month of Sale" required>
                  <select className="gt-input" value={form.sale_month} onChange={(e) => set("sale_month", e.target.value)}>
                    {MONTHS.map((mo) => <option key={mo}>{mo}</option>)}
                  </select>
                </Field>
                <div className="md:col-span-2 gt-card p-3 bg-[#F1EBF7] border-none">
                  <div className="text-xs text-[var(--gt-text-muted)]">Auto-calculated Total Income from Areca</div>
                  <div className="text-xl font-bold text-[var(--gt-purple-dark)]">₹ {computedIncome.toLocaleString("en-IN")}</div>
                </div>
              </div>
            </SubSection>

            <SubSection icon={Warehouse} title="Storage & Logistics">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Areca Stored - Duration (Months)"><input type="number" className="gt-input" value={form.storage_duration_months} onChange={(e) => set("storage_duration_months", e.target.value)} /></Field>
                <Field label="Storage Source">
                  <select className="gt-input" value={form.storage_source} onChange={(e) => set("storage_source", e.target.value)}>
                    <option value="">Select</option>
                    {(opts.storage_source || []).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Logistics Provider">
                  <select className="gt-input" value={form.logistics_provider} onChange={(e) => set("logistics_provider", e.target.value)}>
                    <option value="">Select</option>
                    {(opts.logistics_provider || []).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                {form.logistics_provider && (
                  <Field label="Provider-wise Cost (INR/Qtl)"><input type="number" className="gt-input" value={form.logistics_cost_inr_per_qtl} onChange={(e) => set("logistics_cost_inr_per_qtl", e.target.value)} /></Field>
                )}
              </div>
            </SubSection>
          </>
        )}

        {step === 3 && (
          <>
            <SubSection icon={TriangleAlert} title="Cultivation Challenges" first>
              <Field label="Challenges in Areca Cultivation">
                <MultiChip options={opts.cultivation_challenges || []} value={form.cultivation_challenges} onToggle={(v) => toggleMulti("cultivation_challenges", v)} />
              </Field>
            </SubSection>

            <SubSection icon={Sprout} title="Other Crops (Diversification)">
              <div className="grid md:grid-cols-2 gap-x-4">
                {[2, 3].map((n) => (
                  <div key={n} className="md:col-span-2 border-t border-[var(--gt-border)] pt-3 mt-1 first:border-none first:pt-0 first:mt-0">
                    <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">Crop {n}</div>
                    <div className="grid md:grid-cols-2 gap-x-4">
                      <Field label="Crop Name">
                        <input className="gt-input" list="crop-list" value={form[`crop${n}_name`]} onChange={(e) => set(`crop${n}_name`, e.target.value)} />
                      </Field>
                      <Field label="Area under Cultivation (Acres)" error={errors[`crop${n}_area_acres`]}><input type="number" className="gt-input" value={form[`crop${n}_area_acres`]} onChange={(e) => set(`crop${n}_area_acres`, e.target.value)} /></Field>
                      <Field label="Yield" error={errors[`crop${n}_yield`]}><input type="number" className="gt-input" value={form[`crop${n}_yield`]} onChange={(e) => set(`crop${n}_yield`, e.target.value)} /></Field>
                      <Field label="Rate (INR)" error={errors[`crop${n}_rate`]}><input type="number" className="gt-input" value={form[`crop${n}_rate`]} onChange={(e) => set(`crop${n}_rate`, e.target.value)} /></Field>
                    </div>
                  </div>
                ))}
                <datalist id="crop-list">{crops.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </SubSection>
          </>
        )}

        {step === 4 && (
          <>
            <SubSection icon={Wrench} title="Farm Mechanisation" first>
              <Field label="Farm Mechanisation - Own Machines"><MultiChip options={machines} value={form.mech_owned} onToggle={(v) => toggleMulti("mech_owned", v)} /></Field>
              <Field label="Farm Mechanisation - Rented"><MultiChip options={machines.filter((m) => !form.mech_owned.includes(m))} value={form.mech_rented} onToggle={(v) => toggleMulti("mech_rented", v)} /></Field>
              {form.mech_rented.length > 0 && (
                <Field label="Hourly Rental Rate per Machine (INR)" error={errors.mech_rental_rate}>
                  <div className="flex flex-col gap-2">
                    {form.mech_rented.map((mc: string) => (
                      <div key={mc} className="flex items-center gap-2">
                        <span className="text-sm flex-1">{mc}</span>
                        <input
                          type="number"
                          className="gt-input w-32"
                          value={form.mech_rental_rate[mc] || ""}
                          onChange={(e) => set("mech_rental_rate", { ...form.mech_rental_rate, [mc]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </Field>
              )}
            </SubSection>

            <SubSection icon={Truck} title="Input Supply Chain">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Source of Input Purchase" required>
                  <select className="gt-input" value={form.input_source} onChange={(e) => set("input_source", e.target.value)}>
                    {(opts.input_source || []).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Distance of Input Source (Km)"><input type="number" className="gt-input" value={form.input_distance_km} onChange={(e) => set("input_distance_km", e.target.value)} /></Field>
                <Field label="Challenges in Input Purchase">
                  <select className="gt-input" value={form.input_challenges} onChange={(e) => set("input_challenges", e.target.value)}>
                    <option value="">Select</option>
                    {(opts.input_challenges || []).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              </div>
            </SubSection>

            <SubSection icon={Smartphone} title="Technology Adoption">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Associated with any Technology Solution" required><YesNo value={form.tech_adoption} onChange={(v) => set("tech_adoption", v)} /></Field>
                {form.tech_adoption === "Yes" && (
                  <Field label="Details" required error={errors.tech_adoption_detail}><input className="gt-input" value={form.tech_adoption_detail} onChange={(e) => set("tech_adoption_detail", e.target.value)} /></Field>
                )}
              </div>
            </SubSection>
          </>
        )}

        {step === 5 && (
          <>
            <SubSection icon={CreditCard} title="Credit & Finance" first>
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Credit Linkage" required><YesNo value={form.credit_linkage} onChange={(v) => set("credit_linkage", v)} /></Field>
                {form.credit_linkage === "Yes" && (
                  <>
                    <Field label="Source" required error={errors.credit_source}>
                      <select className="gt-input" value={form.credit_source} onChange={(e) => set("credit_source", e.target.value)}>
                        <option value="">Select</option>
                        {(opts.credit_source || []).map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                    <Field label="Amount (INR)" required error={errors.credit_amount_inr}><input type="number" className="gt-input" value={form.credit_amount_inr} onChange={(e) => set("credit_amount_inr", e.target.value)} /></Field>
                    <Field label="Interest Rate (%)" required error={errors.credit_interest_rate_pct}><input type="number" className="gt-input" value={form.credit_interest_rate_pct} onChange={(e) => set("credit_interest_rate_pct", e.target.value)} /></Field>
                    <Field label="Repayment Period (Months)" required error={errors.credit_repayment_months}><input type="number" className="gt-input" value={form.credit_repayment_months} onChange={(e) => set("credit_repayment_months", e.target.value)} /></Field>
                  </>
                )}
              </div>
            </SubSection>

            <SubSection icon={Landmark} title="Government Schemes">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Availed any Government Scheme (Last 2 Years)" required><YesNo value={form.scheme_availed} onChange={(v) => set("scheme_availed", v)} /></Field>
                {form.scheme_availed === "Yes" && (
                  <>
                    <Field label="Name of Scheme" required error={errors.scheme_name}>
                      <input className="gt-input" list="scheme-list" value={form.scheme_name} onChange={(e) => set("scheme_name", e.target.value)} />
                      <datalist id="scheme-list">{schemes.map((s) => <option key={s} value={s} />)}</datalist>
                    </Field>
                    <Field label="Scheme Benefits" required error={errors.scheme_benefits}>
                      <textarea className="gt-input" rows={3} value={form.scheme_benefits} onChange={(e) => set("scheme_benefits", e.target.value)} />
                    </Field>
                  </>
                )}
              </div>
            </SubSection>
          </>
        )}

        {step === 6 && (
          <>
            <SubSection icon={Droplets} title="Irrigation" first>
              <Field label="Source of Irrigation" required error={errors.irrigation_source}><MultiChip options={opts.irrigation_source || []} value={form.irrigation_source} onToggle={(v) => toggleMulti("irrigation_source", v)} /></Field>
              <Field label="Challenges in Irrigation"><input className="gt-input" value={form.irrigation_challenges} onChange={(e) => set("irrigation_challenges", e.target.value)} /></Field>
            </SubSection>

            <SubSection icon={FlaskConical} title="Soil Health & Crop Insurance">
              <div className="grid md:grid-cols-2 gap-x-4">
                <Field label="Soil Test Conducted" required><YesNo value={form.soil_test_done} onChange={(v) => set("soil_test_done", v)} /></Field>
                <Field label="Crop Insurance" required><YesNo value={form.crop_insurance} onChange={(v) => set("crop_insurance", v)} /></Field>
                {form.crop_insurance === "Yes" && (
                  <Field label="Insurance Detail" required error={errors.crop_insurance_detail}><input className="gt-input" value={form.crop_insurance_detail} onChange={(e) => set("crop_insurance_detail", e.target.value)} /></Field>
                )}
              </div>
            </SubSection>
          </>
        )}

        {step === 7 && (
          <>
            <div className="grid md:grid-cols-2 gap-x-4 mb-2">
              <Field label="Geo-location (auto-captured)">
                {geoStatus === "locating" && (
                  <div className="text-xs flex items-center gap-1.5 text-[var(--gt-text-muted)]"><MapPin size={14} className="animate-pulse" /> Fetching device GPS…</div>
                )}
                {geoStatus === "done" && form.geo_lat && (
                  <div className="text-xs flex items-center gap-1.5 text-[var(--gt-success)] font-medium">
                    <CheckCircle2 size={14} /> Lat {form.geo_lat}, Long {form.geo_long}
                  </div>
                )}
                {geoStatus === "error" && (
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-[var(--gt-danger)]">Could not access device GPS. Enable location and retry.</div>
                    <button type="button" className="gt-btn-secondary flex items-center gap-1.5 w-fit" onClick={captureGeo}><MapPin size={16} /> Retry GPS</button>
                  </div>
                )}
                {geoStatus === "done" && (
                  <button type="button" className="text-xs text-[var(--gt-purple)] underline mt-1.5" onClick={captureGeo}>Refresh location</button>
                )}
              </Field>
              <Field label="Field Photo (auto geo-tagged)">
                <button type="button" className="gt-btn-secondary flex items-center gap-1.5" onClick={attachPhoto}>
                  <Camera size={16} /> Attach Photo
                </button>
                {form.field_photo && (
                  <div className="text-xs mt-2 text-[var(--gt-text-muted)]">
                    {form.field_photo}
                    {form.geo_lat && <div className="text-[var(--gt-success)]">Tagged with Lat {form.geo_lat}, Long {form.geo_long}</div>}
                  </div>
                )}
              </Field>
              <Field label="Enumerator Name"><input className="gt-input" value={form.enumerator_name} onChange={(e) => set("enumerator_name", e.target.value)} /></Field>
            </div>

            <div className="gt-card p-4 bg-[#F1EBF7] border-none">
              <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">Review Summary</div>
              <div className="grid md:grid-cols-2 gap-1 text-sm">
                <div>Farmer: <b>{form.farmer_name}</b> ({form.farmer_id})</div>
                <div>Location: <b>{form.village}, {form.taluka}, {form.district}</b></div>
                <div>Areca Area: <b>{form.areca_area_acres} acres</b>, {form.areca_plant_count} plants</div>
                <div>Yield: <b>{form.yield_raw_qtl} Qtl</b></div>
                <div>Sale: <b>{form.sale_type}</b> via {form.marketing_channel}</div>
                <div>Net Income: <b className="text-[var(--gt-purple-dark)]">₹{computedIncome.toLocaleString("en-IN")}</b></div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-between gap-3">
        <button className="gt-btn-secondary flex items-center gap-1" onClick={back} disabled={step === 0}>
          <ChevronLeft size={16} /> Back
        </button>
        {step < STEPS.length - 1 ? (
          <button className="gt-btn-primary flex items-center gap-1" onClick={next}>
            Next <ChevronRight size={16} />
          </button>
        ) : (
          <button className="gt-btn-primary flex items-center gap-1.5" onClick={submit} disabled={submitting}>
            <CheckCircle2 size={16} /> {submitting ? "Submitting…" : "Submit Survey"}
          </button>
        )}
      </div>
    </div>
  );
}
