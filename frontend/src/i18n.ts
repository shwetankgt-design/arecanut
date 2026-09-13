// Lightweight EN <-> Kannada display map for the Location step.
// Canonical values stored in the DB/API are always English; Kannada is display-only.

export const DISTRICT_KN: Record<string, string> = {
  "Shivamogga": "ಶಿವಮೊಗ್ಗ",
  "Chikkamagaluru": "ಚಿಕ್ಕಮಗಳೂರು",
  "Davanagere": "ದಾವಣಗೆರೆ",
  "Tumakuru": "ತುಮಕೂರು",
  "Udupi": "ಉಡುಪಿ",
  "Dakshina Kannada": "ದಕ್ಷಿಣ ಕನ್ನಡ",
};

export const TALUKA_KN: Record<string, string> = {
  "Sagar": "ಸಾಗರ",
  "Thirthahalli": "ತೀರ್ಥಹಳ್ಳಿ",
  "Hosanagara": "ಹೊಸನಗರ",
  "Koppa": "ಕೊಪ್ಪ",
  "Sringeri": "ಶೃಂಗೇರಿ",
  "N.R.Pura": "ಎನ್.ಆರ್.ಪುರ",
  "Channagiri": "ಚನ್ನಗಿರಿ",
  "Honnali": "ಹೊನ್ನಾಳಿ",
  "Tiptur": "ತಿಪಟೂರು",
  "Turuvekere": "ತುರುವೇಕೆರೆ",
  "Karkala": "ಕಾರ್ಕಳ",
  "Kundapura": "ಕುಂದಾಪುರ",
  "Puttur": "ಪುತ್ತೂರು",
  "Sullia": "ಸುಳ್ಯ",
};

export const VILLAGE_KN: Record<string, string> = {
  "Anandapuram": "ಆನಂದಪುರಂ",
  "Talaguppa": "ತಳಗುಪ್ಪ",
  "Ambaragodlu": "ಅಂಬಾರಗೋಡ್ಲು",
  "Kogar": "ಕೋಗಾರ್",
  "Agumbe": "ಆಗುಂಬೆ",
  "Muppane": "ಮುಪ್ಪಾಣೆ",
  "Hurulikoppa": "ಹುರುಳಿಕೊಪ್ಪ",
  "Nagara": "ನಗರ",
  "Ripponpet": "ರಿಪ್ಪನ್‌ಪೇಟೆ",
  "Kelagote": "ಕೆಳಗೋಟೆ",
  "Balehonnur": "ಬಾಳೆಹೊನ್ನೂರು",
  "Kesave": "ಕೆಸವೆ",
  "Hariharapura": "ಹರಿಹರಪುರ",
  "Kigga": "ಕಿಗ್ಗ",
  "Mennasandra": "ಮೆನ್ನಸಂದ್ರ",
  "Kalasa": "ಕಳಸ",
  "Bhadra": "ಭದ್ರಾ",
  "Santhebennur": "ಸಂತೆಬೆನ್ನೂರು",
  "Basavapatna": "ಬಸವಾಪಟ್ಟಣ",
  "Nyamathi": "ನ್ಯಾಮತಿ",
  "Ulchagatta": "ಉಳ್ಚಗಟ್ಟ",
  "Nonavinakere": "ನೋಣವಿನಕೆರೆ",
  "Kibbanahalli": "ಕಿಬ್ಬನಹಳ್ಳಿ",
  "Amruthur": "ಅಮೃತೂರು",
  "Handanakere": "ಹಂದನಕೆರೆ",
  "Miyar": "ಮಿಯಾರ್",
  "Mala": "ಮಾಳ",
  "Nitte": "ನಿಟ್ಟೆ",
  "Amasebailu": "ಅಮಾಸೆಬೈಲು",
  "Basrur": "ಬಸ್ರೂರು",
  "Uppinangady": "ಉಪ್ಪಿನಂಗಡಿ",
  "Ariyadka": "ಅರಿಯಡ್ಕ",
  "Aranthodu": "ಅರಂತೋಡು",
  "Kalmadka": "ಕಲ್ಮಡ್ಕ",
};

export type Lang = "en" | "kn";

export function trDistrict(name: string, lang: Lang) {
  return lang === "kn" ? DISTRICT_KN[name] || name : name;
}
export function trTaluka(name: string, lang: Lang) {
  return lang === "kn" ? TALUKA_KN[name] || name : name;
}
export function trVillage(name: string, lang: Lang) {
  return lang === "kn" ? VILLAGE_KN[name] || name : name;
}

export const LABELS: Record<string, { en: string; kn: string }> = {
  village: { en: "Village", kn: "ಗ್ರಾಮ" },
  taluka: { en: "Taluka", kn: "ತಾಲೂಕು" },
  district: { en: "District", kn: "ಜಿಲ್ಲೆ" },
  state: { en: "State", kn: "ರಾಜ್ಯ" },
  quickSearch: { en: "Search Village (auto-fills Taluka, District & State)", kn: "ಗ್ರಾಮ ಹುಡುಕಿ (ತಾಲೂಕು, ಜಿಲ್ಲೆ ಮತ್ತು ರಾಜ್ಯ ತಾನಾಗಿ ಭರ್ತಿಯಾಗುತ್ತದೆ)" },
  select: { en: "Select", kn: "ಆಯ್ಕೆಮಾಡಿ" },
  karnataka: { en: "Karnataka", kn: "ಕರ್ನಾಟಕ" },

  // App shell / nav
  appTitle: { en: "Arecanut Farmer Survey", kn: "ಅಡಿಕೆ ರೈತ ಸಮೀಕ್ಷೆ" },
  appSubtitle: { en: "Karnataka · NCCF Data Collection", kn: "ಕರ್ನಾಟಕ · NCCF ಮಾಹಿತಿ ಸಂಗ್ರಹ" },
  navDashboard: { en: "Dashboard", kn: "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್" },
  navNewEntry: { en: "New Entry", kn: "ಹೊಸ ನಮೂದು" },
  navNewSurveyEntry: { en: "New Survey Entry", kn: "ಹೊಸ ಸಮೀಕ್ಷೆ ನಮೂದು" },
  navFarmers: { en: "Farmers", kn: "ರೈತರು" },
  navFarmerRecords: { en: "Farmer Records", kn: "ರೈತರ ದಾಖಲೆಗಳು" },
  navMasterData: { en: "Master Data", kn: "ಮಾಸ್ಟರ್ ಡೇಟಾ" },

  // Dashboard
  dashboardTitle: { en: "Programme Dashboard", kn: "ಕಾರ್ಯಕ್ರಮ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್" },
  dashboardSubtitle: { en: "Arecanut farmer survey — Karnataka. Click any chart or card to drill into the underlying farmer records.", kn: "ಅಡಿಕೆ ರೈತ ಸಮೀಕ್ಷೆ — ಕರ್ನಾಟಕ. ವಿವರವಾದ ರೈತರ ದಾಖಲೆಗಳನ್ನು ನೋಡಲು ಯಾವುದೇ ಚಾರ್ಟ್ ಅಥವಾ ಕಾರ್ಡ್ ಕ್ಲಿಕ್ ಮಾಡಿ." },
  drillHint: { en: "Click to view farmers", kn: "ರೈತರನ್ನು ನೋಡಲು ಕ್ಲಿಕ್ ಮಾಡಿ" },

  // Farmer list
  farmerListTitle: { en: "Farmer Survey Records", kn: "ರೈತರ ಸಮೀಕ್ಷೆ ದಾಖಲೆಗಳು" },
  records: { en: "records", kn: "ದಾಖಲೆಗಳು" },
  search: { en: "Search", kn: "ಹುಡುಕಿ" },
  searchPlaceholder: { en: "Search by name, farmer ID or mobile", kn: "ಹೆಸರು, ರೈತ ID ಅಥವಾ ಮೊಬೈಲ್‌ ಮೂಲಕ ಹುಡುಕಿ" },
  clearFilters: { en: "Clear filters", kn: "ಫಿಲ್ಟರ್‌ಗಳನ್ನು ತೆರವುಗೊಳಿಸಿ" },
  filteredBy: { en: "Filtered by", kn: "ಫಿಲ್ಟರ್ ಮಾಡಲಾಗಿದೆ" },
  edit: { en: "Edit", kn: "ಸಂಪಾದಿಸಿ" },
  noRecords: { en: "No records found.", kn: "ಯಾವುದೇ ದಾಖಲೆಗಳು ಕಂಡುಬಂದಿಲ್ಲ." },

  // Yield estimation
  yieldEstTitle: { en: "Yield Estimation", kn: "ಇಳುವರಿ ಅಂದಾಜು" },
  yieldEstSubtitle: {
    en: "Estimate an upcoming season's yield & income from historical survey benchmarks, before the harvest is in.",
    kn: "ಕೊಯ್ಲಿಗೆ ಮೊದಲೇ, ಹಿಂದಿನ ಸಮೀಕ್ಷೆಯ ಮಾನದಂಡಗಳ ಆಧಾರದ ಮೇಲೆ ಮುಂಬರುವ ಋತುವಿನ ಇಳುವರಿ ಮತ್ತು ಆದಾಯವನ್ನು ಅಂದಾಜಿಸಿ." },
  estimateBasis: { en: "Estimate basis", kn: "ಅಂದಾಜು ಆಧಾರ" },
  wholeState: { en: "Whole State (Karnataka)", kn: "ಇಡೀ ರಾಜ್ಯ (ಕರ್ನಾಟಕ)" },
  arecaAreaInput: { en: "Areca Area (Acres)", kn: "ಅಡಿಕೆ ವಿಸ್ತೀರ್ಣ (ಎಕರೆ)" },
  expectedRate: { en: "Expected Rate (INR/kg)", kn: "ನಿರೀಕ್ಷಿತ ದರ (₹/ಕೆಜಿ)" },
  useBenchmarkRate: { en: "using benchmark avg.", kn: "ಮಾನದಂಡ ಸರಾಸರಿ ಬಳಸಿ" },
  estYield: { en: "Estimated Yield", kn: "ಅಂದಾಜು ಇಳುವರಿ" },
  estPlants: { en: "Estimated Plant Count", kn: "ಅಂದಾಜು ಗಿಡಗಳ ಸಂಖ್ಯೆ" },
  estGrossIncome: { en: "Estimated Gross Income", kn: "ಅಂದಾಜು ಒಟ್ಟು ಆದಾಯ" },
  estCost: { en: "Estimated Cultivation Cost", kn: "ಅಂದಾಜು ಬೇಸಾಯ ವೆಚ್ಚ" },
  estNetIncome: { en: "Estimated Net Income", kn: "ಅಂದಾಜು ನಿವ್ವಳ ಆದಾಯ" },
  basedOnSamples: { en: "samples", kn: "ಮಾದರಿಗಳು" },
  perAcre: { en: "Qtl / acre benchmark", kn: "ಕ್ವಿಂ. / ಎಕರೆ ಮಾನದಂಡ" },
};

export function tr(key: keyof typeof LABELS, lang: Lang) {
  return LABELS[key][lang];
}
