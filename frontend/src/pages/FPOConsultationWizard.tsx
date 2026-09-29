import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, CheckCircle2, Building2, Users, ShieldCheck,
  TrendingUp, Wheat, Warehouse, CreditCard, Handshake, AlertCircle, Save,
} from "lucide-react";
import { api } from "../api";

// ---------------------------------------------------------------------------
// Generic, config-driven wizard for the FPO Screening Questionnaire (72
// questions, 6 sections in the source form, regrouped into 8 wizard steps
// mirroring the farmer-survey wizard's UX). Config-driven rather than one
// <Field> per question by hand — at ~180 columns that would be an unreviewable
// wall of near-identical JSX; a FieldSpec array plus one renderer keeps the
// mapping from question -> form field auditable at a glance and makes adding
// a future question a one-line change instead of a new block of markup.
//
// Draft-safe by construction: every field is optional (matches the backend
// model), and the wizard PUTs to the server after every "Next"/"Back"/"Save
// Draft" click with only the fields touched so far — closing the tab mid-form
// loses nothing beyond the current step's unsaved keystrokes.
// ---------------------------------------------------------------------------

type FieldSpec =
  | { kind: "text" | "number" | "textarea"; name: string; label: string; required?: boolean; when?: (f: any) => boolean }
  | { kind: "select"; name: string; label: string; options: string[]; required?: boolean; when?: (f: any) => boolean }
  | { kind: "yesno"; name: string; label: string; when?: (f: any) => boolean }
  | { kind: "multichip"; name: string; label: string; options: string[]; when?: (f: any) => boolean };

type TableColumn = { key: string; label: string; type: "text" | "number" | "select"; options?: string[] };
type TableSpec =
  | { kind: "fixed"; name: string; title: string; rowLabelHeader?: string; rows: string[]; columns: TableColumn[] }
  | { kind: "dynamic"; name: string; title: string; columns: TableColumn[]; addLabel: string };

interface StepSpec {
  key: string;
  label: string;
  hint: string;
  icon: any;
  fields: FieldSpec[];
  tables?: TableSpec[];
}

const YES_NO = ["Yes", "No"];

const STEPS: StepSpec[] = [
  {
    key: "profile", label: "FPO Profile", hint: "Identification, interview details & headline figures", icon: Building2,
    fields: [
      { kind: "text", name: "interview_date", label: "Date of Interview" },
      { kind: "text", name: "respondent_name", label: "Respondent Name", required: true },
      { kind: "text", name: "respondent_designation", label: "Designation" },
      { kind: "text", name: "respondent_mobile", label: "Respondent Mobile Number" },
      { kind: "text", name: "others_present", label: "Others Present (name, role)" },
      { kind: "text", name: "interview_location", label: "Interview Location" },
      { kind: "number", name: "geo_lat", label: "GPS Latitude" },
      { kind: "number", name: "geo_long", label: "GPS Longitude" },
      { kind: "text", name: "fpo_name", label: "FPO Name", required: true },
      { kind: "text", name: "cin", label: "CIN" },
      { kind: "text", name: "incorporation_date", label: "Date of Incorporation" },
      { kind: "number", name: "fpo_age_years", label: "FPO Age (Years)" },
      { kind: "select", name: "legal_form", label: "Legal Form", options: ["FPC", "Co-op", "Society"] },
      { kind: "text", name: "district", label: "District" },
      { kind: "text", name: "taluk", label: "Taluk" },
      { kind: "number", name: "villages_covered", label: "Villages Covered (number)" },
      { kind: "text", name: "implementing_agency", label: "Implementing Agency (IA)" },
      { kind: "text", name: "cbbo_name", label: "CBBO Name" },
      { kind: "multichip", name: "promoting_agency", label: "Promoting Agency", options: ["SFAC", "NABARD", "NCDC", "NAFED", "Horticulture Department", "Watershed Department", "NGO", "Other"] },
      { kind: "text", name: "promoting_agency_other", label: "Specify Other Promoting Agency", when: (f) => (f.promoting_agency || "").includes("Other") },
      { kind: "text", name: "primary_crop", label: "Primary Crop" },
      { kind: "text", name: "secondary_crop", label: "Secondary Crop" },
      { kind: "number", name: "women_members", label: "Women Members" },
      { kind: "number", name: "women_on_board", label: "Women on Board" },
      { kind: "number", name: "turnover_fy24", label: "Turnover FY24 (INR lakh)" },
      { kind: "number", name: "turnover_fy25", label: "Turnover FY25 (INR lakh)" },
      { kind: "number", name: "turnover_fy26", label: "Turnover FY26 (INR lakh)" },
      { kind: "number", name: "profit_fy24", label: "Profit FY24 (INR lakh)" },
      { kind: "number", name: "profit_fy25", label: "Profit FY25 (INR lakh)" },
      { kind: "number", name: "profit_fy26", label: "Profit FY26 (INR lakh)" },
    ],
  },
  {
    key: "governance", label: "Governance & Management", hint: "Board, CEO, accountant, staffing & BDS providers", icon: Users,
    fields: [
      { kind: "select", name: "q1_board_size", label: "Q1. Board of Directors size", options: ["Less than 5", "5 to 8", "8 to 10", "More than 10"] },
      { kind: "number", name: "q1_board_women_count", label: "Of which women" },
      { kind: "select", name: "q2_board_experience", label: "Q2. Board business/entrepreneurship experience", options: ["None, farming only", "1 to 3 years, one or two members", "3 to 5 years, several members", "5 years or more, majority of board"] },
      { kind: "number", name: "q2_board_members_running_business", label: "Number of Board members running a business" },
      { kind: "multichip", name: "q2_business_nature", label: "Nature of the enterprise", options: ["Trading", "Input dealership", "Processing", "Transport", "Other"] },
      { kind: "text", name: "q2_business_nature_other", label: "Specify Other Enterprise", when: (f) => (f.q2_business_nature || "").includes("Other") },
      { kind: "select", name: "q3_minutes_records", label: "Q3. Board minutes & records", options: ["Not maintained", "Maintained, improper form", "Detailed, not reported to MCA", "Detailed, fully compliant"] },
      { kind: "number", name: "q3_meetings_per_year", label: "Board meetings per year" },
      { kind: "select", name: "q3_meeting_frequency", label: "Meeting Frequency", options: ["Monthly", "Quarterly", "Half-yearly", "Annual"] },
      { kind: "text", name: "last_agm_date", label: "Last AGM held on" },
      { kind: "number", name: "shareholder_attendance_pct", label: "Shareholder Attendance (%)" },
      { kind: "select", name: "q4_has_ceo", label: "Q4. Does the FPO have a CEO?", options: ["Yes", "No", "Position vacant"] },
      { kind: "select", name: "q4a_ceo_experience", label: "4a. CEO Experience & Qualification", options: ["No experience or education", "1 to 3 years, education only", "3 to 5 years experience and education", "5 years or more, experience and education"], when: (f) => f.q4_has_ceo === "Yes" },
      { kind: "number", name: "q4b_ceo_years", label: "4b. Years Associated with FPC", when: (f) => f.q4_has_ceo === "Yes" },
      { kind: "select", name: "q4b_ceo_engagement", label: "CEO Engagement", options: ["Full time", "Part time", "On contract"], when: (f) => f.q4_has_ceo === "Yes" },
      { kind: "textarea", name: "q4c_ceo_trade_or_admin", label: "4c. Does the CEO personally trade, or only administer schemes?", when: (f) => f.q4_has_ceo === "Yes" },
      { kind: "select", name: "q5_has_accountant", label: "Q5. Does the FPO have an accountant?", options: ["Yes, on rolls", "Yes, outsourced", "No"] },
      { kind: "select", name: "q5a_accountant_experience", label: "5a. Accountant Experience & Qualification", options: ["No formal qualification", "Commerce graduate, no experience", "1 to 3 years experience", "3 years or more, with qualification"], when: (f) => (f.q5_has_accountant || "").startsWith("Yes") },
      { kind: "number", name: "q5b_accountant_years", label: "5b. Years Associated with FPC", when: (f) => (f.q5_has_accountant || "").startsWith("Yes") },
      { kind: "select", name: "q5b_accountant_engagement", label: "Accountant Engagement", options: ["Full time", "Part time", "On contract"], when: (f) => (f.q5_has_accountant || "").startsWith("Yes") },
      { kind: "select", name: "q5c_software_used", label: "5c. Software Used", options: ["Manual", "Excel", "Tally", "Other"], when: (f) => (f.q5_has_accountant || "").startsWith("Yes") },
      { kind: "text", name: "q5c_software_other", label: "Specify Other Software", when: (f) => f.q5c_software_used === "Other" },
      { kind: "select", name: "q6_second_line_mgmt", label: "Q6. Second line of management beyond the CEO", options: ["None, CEO plus accounts team", "Accounts team as second line", "One divisional manager", "Well defined, leadership ready"] },
      { kind: "number", name: "q6_total_staff", label: "Total Staff on Rolls" },
      { kind: "number", name: "q6_field_staff", label: "Field Staff" },
      { kind: "select", name: "q7_registered_members", label: "Q7. Registered Members", options: ["Below 300", "300 to 500", "500 to 1,000", "Above 1,000"] },
      { kind: "select", name: "q7_actively_transacting", label: "Actively Transacting Share", options: ["Below 30%", "30 to 50%", "50 to 75%", "Above 75%"] },
      { kind: "select", name: "q8_promoting_agency_role", label: "Q8. Role of the promoting agency", options: ["No promoting agency", "Agency, no active role", "Agency supports capacity and credit", "Self-sufficient, agency on paid basis"] },
    ],
    tables: [
      {
        kind: "fixed", name: "bds_providers", title: "Q9. Business Development Service (BDS) Providers", rowLabelHeader: "BDS type",
        rows: ["Input BDS", "Credit BDS", "Technology BDS", "Training BDS", "Market linkage BDS", "Farm mechanisation BDS", "Other (specify)"],
        columns: [
          { key: "engaged", label: "Engaged", type: "select", options: ["Yes", "No"] },
          { key: "name", label: "Name of BDS Provider", type: "text" },
          { key: "services", label: "Services Taken", type: "text" },
          { key: "paid_free", label: "Paid or Free", type: "select", options: ["Paid", "Free"] },
        ],
      },
    ],
  },
  {
    key: "compliance", label: "Compliance & Licences", hint: "Government scheme convergence & statutory filings", icon: ShieldCheck,
    fields: [
      { kind: "select", name: "q10_govt_scheme_converged", label: "Q10. Has the FPO converged with any government scheme?", options: YES_NO },
    ],
    tables: [
      {
        kind: "dynamic", name: "govt_schemes", title: "Government Schemes Availed", addLabel: "Add scheme",
        columns: [
          { key: "scheme_name", label: "Scheme Name", type: "text" },
          { key: "department", label: "Department / Agency", type: "text" },
          { key: "year", label: "Year", type: "text" },
          { key: "benefit_type", label: "Type of Benefit", type: "text" },
          { key: "amount", label: "Amount (INR lakh)", type: "number" },
        ],
      },
      {
        kind: "fixed", name: "licences", title: "Licences & Statutory Filings", rowLabelHeader: "Licence / filing",
        rows: [
          "Seed licence", "Fertiliser licence", "Pesticide licence", "FSSAI licence", "GST registration",
          "MSP procurement licence", "APMC trading licence", "Annual RoC or MCA filing", "GST returns",
          "Income tax return", "Statutory audit", "Director KYC", "Share certificates issued to all members",
        ],
        columns: [
          { key: "status", label: "Status (Yes/No or Current/Delayed)", type: "text" },
          { key: "detail", label: "Number, Validity, or Last Filed/Audited", type: "text" },
          { key: "doc_sighted", label: "Document Sighted", type: "select", options: YES_NO },
        ],
      },
    ],
  },
  {
    key: "business", label: "Business & Financial Performance", hint: "Systems, revenue, margins & working capital", icon: TrendingUp,
    fields: [
      { kind: "select", name: "q11_deals_in", label: "Q11. What does the FPO deal in?", options: ["Inputs only", "Output linkage only", "Both inputs and output", "Inputs and output plus processing"] },
      { kind: "select", name: "q12_price_risk", label: "Q12. How is price risk managed?", options: ["Volatile, FPO bears risk", "MSP covered, risk on FPO", "Partly hedged or non-volatile", "Hedged via NCDEX or not applicable"] },
      { kind: "select", name: "q13_external_lending", label: "Q13. External lending relationships", options: ["No external lender", "Lender, not bank or NBFC", "At least one bank or NBFC", "Bank or NBFC, repeat lending"] },
      { kind: "multichip", name: "q14_trading_platforms", label: "Q14. Electronic trading / market platforms", options: ["e-NAM", "NCDEX", "ONDC", "TReDS", "None"] },
      { kind: "select", name: "q15_accounts_mis", label: "Q15. Accounts and MIS", options: ["Manual, no MIS", "Basic MS Office", "Tally, other records manual", "Software based, fully digitised"] },
      { kind: "select", name: "q16_stock_insured", label: "Q16. Stock insured against fire and theft", options: ["No cover", "Below 50% insured", "50% or more, fire and theft", "100% insured"] },
      { kind: "select", name: "q17_credit_repayment_history", label: "Q17. Credit repayment history", options: ["No credit history", "Delays current and past", "Delays or defaults in past", "No delays or defaults"] },
      { kind: "select", name: "q18_books_update_freq", label: "Q18. Books and records update frequency", options: ["Monthly or less often", "Weekly", "2 to 3 day lag", "Current"] },
      { kind: "select", name: "q19_stock_reconciliation_freq", label: "Q19. Stock reconciliation frequency", options: ["Absent or annual", "2 to 4 times a year", "Monthly", "Regular"] },
      { kind: "select", name: "q20_cash_revenue_share", label: "Q20. Share of gross revenue transacted in cash", options: ["Above 70%", "50 to 70%", "20 to 50%", "Below 20%"] },
      { kind: "select", name: "q21_traceability_records", label: "Q21. Lot-level or farmer-level traceability records", options: ["None", "Manual register", "Spreadsheet", "Digital, lot traceable to farmer"] },
      { kind: "select", name: "q22_total_annual_revenue", label: "Q22. Total annual revenue", options: ["Below INR 10 lakh", "INR 10 to 50 lakh", "INR 50 to 100 lakh", "Above INR 100 lakh"] },
      { kind: "select", name: "q23_gross_profit_margin", label: "Q23. Gross profit margin", options: ["Below 1%", "1 to 5%", "5 to 10%", "Above 10%"] },
      { kind: "select", name: "q24_profitability_trend", label: "Q24. Profitability trend", options: ["Loss making", "Profitable last year only", "Profitable last 2 years", "Profitable 2 years or more"] },
      { kind: "number", name: "q25_paid_up_capital", label: "Q25. Paid-up capital (INR lakh)" },
      { kind: "number", name: "q26_revenue_share_arecanut_pct", label: "Q26. Revenue share from arecanut (%)" },
      { kind: "select", name: "q27_audited_statements", label: "Q27. Audited financial statements for last 3 FYs?", options: ["Yes, all 3 years", "Yes, 1–2 years", "No"] },
      { kind: "multichip", name: "q27_documents_available", label: "Documents Available", options: ["Balance Sheet", "Profit & Loss Account", "Cash Flow Statement", "Auditor's Report", "Notes to Accounts", "Other"], when: (f) => f.q27_audited_statements && f.q27_audited_statements !== "No" },
      { kind: "text", name: "q27_documents_other", label: "Specify Other Document", when: (f) => (f.q27_documents_available || "").includes("Other") },
      { kind: "number", name: "q28_avg_procurement_value_per_cycle", label: "Q28. Average procurement value per cycle (₹)" },
      { kind: "number", name: "q29_procurement_cycles_per_season", label: "Q29. Procurement cycles per season" },
      { kind: "number", name: "q30_peak_procurement_value", label: "Q30. Peak procurement value in a single cycle (₹)" },
      { kind: "number", name: "q31_max_value_awaiting_settlement", label: "Q31. Max value of produce awaiting settlement (₹)" },
      { kind: "number", name: "q32_settlement_days", label: "Q32. Typical days between delivery and settlement" },
    ],
  },
  {
    key: "supply", label: "Arecanut Supply & Quality", hint: "Farmers, volumes, channels & quality control", icon: Wheat,
    fields: [
      { kind: "select", name: "q33_active_farmers_band", label: "Q33. Active arecanut farmers supplying the FPO", options: ["Below 100", "100 to 500", "500 to 1,000", "Above 1,000"] },
      { kind: "number", name: "q33_actual_farmers", label: "Actual Number of Farmers" },
      { kind: "number", name: "q33_women_farmers", label: "Of Which Women" },
      { kind: "select", name: "q34_aggregate_last_fy_band", label: "Q34. Arecanut aggregated last financial year", options: ["Below 50 MT", "50 to 100 MT", "100 to 250 MT", "250 to 500 MT", "500 to 1,000 MT", "Above 1,000 MT"] },
      { kind: "number", name: "q34_actual_mt", label: "Actual MT" },
      { kind: "number", name: "q34_value_inr_lakh", label: "Value (INR lakh)" },
      { kind: "textarea", name: "q36a_why_channels", label: "Q36a. Why do farmers choose those other channels?" },
      { kind: "select", name: "q37_additional_supply_band", label: "Q37. Additional arecanut suppliable to a new buyer", options: ["Below 50 MT per year", "50 to 100 MT", "100 to 250 MT", "250 to 500 MT", "500 to 1,000 MT", "Above 1,000 MT"] },
      { kind: "number", name: "q37_actual_mt_per_year", label: "Actual MT per Year" },
      { kind: "select", name: "q37a_volume_source", label: "37a. Is this volume already available?", options: ["Already available", "Need to add farmers", "Both"] },
      { kind: "select", name: "q38_supply_stability", label: "Q38. Supply stability across the year", options: ["Highly seasonal", "Seasonal", "Moderate", "Stable", "Highly stable"] },
      { kind: "text", name: "q38_peak_months", label: "Peak Months" },
      { kind: "text", name: "q38_lean_months", label: "Lean Months" },
      { kind: "select", name: "q39_biggest_constraint", label: "Q39. Biggest constraint to increasing procurement", options: ["Farmer turnout", "Working capital", "Collection infrastructure", "Storage", "Transport", "Quality handling", "Trader competition", "No constraint"] },
      { kind: "textarea", name: "q39_notes", label: "Notes" },
      { kind: "select", name: "q40_quality_check_method", label: "Q40. Quality check method at procurement", options: ["Visual only", "Basic manual check", "Moisture plus visual", "Grade-wise testing", "Comprehensive written SOP"] },
      { kind: "yesno", name: "q40_moisture_meter_available", label: "Moisture Meter Available" },
      { kind: "number", name: "q40_moisture_meter_units", label: "Number of Units", when: (f) => f.q40_moisture_meter_available === "Yes" },
      { kind: "text", name: "q40_moisture_meter_last_calibrated", label: "Last Calibrated", when: (f) => f.q40_moisture_meter_available === "Yes" },
      { kind: "select", name: "q41_rejection_rate_band", label: "Q41. Approximate rejection rate", options: ["Below 2%", "2 to 5%", "5 to 8%", "8 to 10%", "Above 10%", "Not measured"] },
      { kind: "number", name: "q41_actual_pct", label: "Actual Percentage" },
      { kind: "text", name: "q41a_reason1", label: "41a. Most Common Rejection Reason 1" },
      { kind: "text", name: "q41a_reason2", label: "Most Common Rejection Reason 2" },
      { kind: "select", name: "q42a_uncoloured_lots", label: "Q42a. Can the FPO source uncoloured lots on request?", options: ["No", "With difficulty", "Yes, at a premium", "Yes, routinely"] },
      { kind: "select", name: "q43_meet_spec", label: "Q43. Can you consistently meet a buyer's written spec?", options: ["No", "Only with major investment", "Yes, with some improvement", "Yes, already meets it"] },
      { kind: "textarea", name: "q43_what_required", label: "What Would Be Required" },
    ],
    tables: [
      {
        kind: "fixed", name: "volume_split_form", title: "Q35. Volume Split by Form", rowLabelHeader: "Form",
        rows: ["Raw areca (chali)", "Processed areca (kempu gotu)", "Both", "Processing cost (INR per quintal)"],
        columns: [{ key: "value", label: "Share (%) / Value", type: "number" }],
      },
      {
        kind: "fixed", name: "volume_split_grade", title: "Volume Split by Grade", rowLabelHeader: "Grade",
        rows: ["Rashi", "Bette", "Gorabalu", "Api", "Idi", "Other"],
        columns: [{ key: "share_pct", label: "Share (%)", type: "number" }, { key: "note", label: "Note (e.g. Other grade name)", type: "text" }],
      },
      {
        kind: "dynamic", name: "produce_channels", title: "Q36. Where does the remaining produce go?", addLabel: "Add channel",
        columns: [{ key: "channel", label: "Channel (Local trader, APMC, etc.)", type: "text" }, { key: "share_pct", label: "Approx. Share (%)", type: "number" }],
      },
      {
        kind: "fixed", name: "quality_practices", title: "Q42. Prevalence of Quality-Affecting Practices", rowLabelHeader: "Practice",
        rows: ["Artificial colouring", "Grade mixing", "Excess moisture at sale"],
        columns: [
          { key: "prevalence", label: "Estimated Prevalence", type: "select", options: ["Below 25%", "25 to 50%", "50 to 75%", "Above 75%"] },
          { key: "who", label: "Who Applies It (Farmer/Trader/Processor)", type: "text" },
        ],
      },
    ],
  },
  {
    key: "infra", label: "Infrastructure & Logistics", hint: "Facilities, storage, pricing & unit economics", icon: Warehouse,
    fields: [
      { kind: "multichip", name: "q44_infrastructure", label: "Q44. Current infrastructure", options: ["Collection centres", "Weighing equipment", "Weighbridge access", "Moisture meters", "Grading and sorting", "Drying yard", "Warehouse", "Packaging", "Own transport", "Digital records"] },
      { kind: "number", name: "q44_collection_centres_count", label: "Number of Collection Centres" },
      { kind: "textarea", name: "q44_additional_infra_needed", label: "Additional Infrastructure Needed" },
      { kind: "textarea", name: "q46_chc_machines_rates", label: "Q46. If CHC: which machines are on rent, and at what rate?" },
      { kind: "select", name: "q48_delivery_reliability", label: "Q48. Reliability of delivering committed quantity on date", options: ["Below 70%", "70 to 80%", "80 to 90%", "90 to 95%", "Above 95%", "Not measured"] },
      { kind: "text", name: "q48_evidence_sighted", label: "Evidence Sighted" },
      { kind: "select", name: "q49_price_determination", label: "Q49. How is price paid to farmers determined?", options: ["Trader or mandi price", "Mandi plus adjustment", "Buyer price", "FPO decides on quality", "Other"] },
      { kind: "text", name: "q49_price_revision_frequency", label: "Price Revision Frequency" },
      { kind: "text", name: "q49_reference_mandi", label: "Reference Mandi" },
      { kind: "select", name: "q51_payment_speed", label: "Q51. How quickly are farmers paid after delivery?", options: ["Same day", "1 to 3 days", "4 to 7 days", "8 to 15 days", "Above 15 days"] },
      { kind: "select", name: "q51_payment_mode", label: "Payment Mode", options: ["Cash", "Bank transfer", "Both"] },
      { kind: "number", name: "q51_share_paid_digitally_pct", label: "Share Paid Digitally (%)" },
      { kind: "number", name: "q51_paid_upfront_pct", label: "Paid Upfront (%)" },
      { kind: "select", name: "q52_upfront_funds_source", label: "Q52. Source of funds for upfront payment", options: ["Own Working Capital", "Bank Loan", "NBFC Loan", "Buyer Advance", "Informal Borrowing"] },
      { kind: "select", name: "q53_biggest_financial_constraint", label: "Q53. Biggest financial constraint to increasing procurement", options: ["Working capital", "Bank financing", "Buyer payment delays", "Low margin", "Infrastructure investment", "No constraint"] },
      { kind: "number", name: "q54_estimated_loss_value", label: "Q54. Estimated business lost last season (₹)" },
      { kind: "number", name: "q54_estimated_loss_mt", label: "Estimated Volume Lost (MT)" },
    ],
    tables: [
      {
        kind: "fixed", name: "common_facilities", title: "Q45. Common Facilities Operated", rowLabelHeader: "Facility",
        rows: ["Input shop", "CHC (custom hiring)", "CFC (common facility)", "CSC (common service)", "Nursery", "Drone or spray service"],
        columns: [
          { key: "provided", label: "Yes / No", type: "select", options: YES_NO },
          { key: "details", label: "Details and Capacity", type: "text" },
          { key: "annual_revenue", label: "Annual Revenue (INR lakh)", type: "number" },
        ],
      },
      {
        kind: "fixed", name: "storage_logistics", title: "Q47. Storage & Logistics Arrangements", rowLabelHeader: "Parameter",
        rows: ["Storage type (Own/Rented/WDRA/None)", "Storage cost (INR per bag per month)", "Storage capacity (MT)", "Typical holding period (months)",
               "Logistics provider (Own/Aggregator/Trader/Hired)", "Logistics cost (INR per quintal)", "Typical lot size despatched (MT)", "Weight recorded at despatch (Yes/No + method)"],
        columns: [{ key: "value", label: "Response", type: "text" }],
      },
      {
        kind: "fixed", name: "unit_economics", title: "Q50. Indicative Unit Economics (Last Season)", rowLabelHeader: "Parameter",
        rows: ["Average procurement price (INR per kg)", "Average selling price (INR per kg)", "Gross margin (INR per kg or %)", "Handling and grading cost (INR per kg)", "Transport cost (INR per kg)", "Weight loss or shrinkage (%)"],
        columns: [{ key: "value", label: "Value", type: "text" }, { key: "remarks", label: "Basis or Remarks", type: "text" }],
      },
    ],
  },
  {
    key: "finance", label: "Finance & Credit", hint: "Credit facilities, history, collateral & tenure", icon: CreditCard,
    fields: [
      { kind: "yesno", name: "q55b_warehouse_receipt_used", label: "Q55b. Has the FPO used warehouse receipt or pledge finance?" },
      { kind: "select", name: "q55c_loan_rejected", label: "Q55c. Has any loan application ever been rejected?", options: ["Yes", "No", "Never applied"] },
      { kind: "number", name: "q55c_rejection_count", label: "Number of Rejections", when: (f) => f.q55c_loan_rejected === "Yes" },
      { kind: "text", name: "q55c_rejection_lender", label: "Lender", when: (f) => f.q55c_loan_rejected === "Yes" },
      { kind: "text", name: "q55c_rejection_year", label: "Year", when: (f) => f.q55c_loan_rejected === "Yes" },
      { kind: "multichip", name: "q55c_rejection_reason", label: "Reason Given for Rejection", options: ["Collateral requirements not met", "Inadequate documentation", "No or weak credit history", "Low turnover or net worth", "Statutory filings not current", "Promoter or Board credit profile", "Application lapsed or delayed", "Reason not given", "Other"], when: (f) => f.q55c_loan_rejected === "Yes" },
      { kind: "text", name: "q55c_rejection_reason_other", label: "Specify Other Reason", when: (f) => (f.q55c_rejection_reason || "").includes("Other") },
      { kind: "select", name: "q56_lender_limit_indicated", label: "Q56. Has any lender indicated a borrowing ceiling?", options: YES_NO },
      { kind: "multichip", name: "q56_reason", label: "If Yes, Why", options: ["Collateral limitation", "Low turnover/net worth", "Lender exposure/risk limit", "Storage/warehouse constraint", "Lender policy/regulatory constraint", "Other"], when: (f) => f.q56_lender_limit_indicated === "Yes" },
      { kind: "text", name: "q56_reason_other", label: "Specify Other Reason", when: (f) => (f.q56_reason || "").includes("Other") },
      { kind: "number", name: "q57_working_capital_needed", label: "Q57. Working capital needed for additional 500 MT (INR lakh)" },
      { kind: "text", name: "q57_proposed_source", label: "Proposed Source" },
      { kind: "select", name: "q58_buy_or_commission", label: "Q58. Buy on own account, or handle on commission?", options: ["Buy on own account (principal)", "Handle on commission (aggregator)", "Either", "Unclear"] },
      { kind: "number", name: "q58_handling_fee", label: "If Commission, Expected Handling Fee (INR per kg)", when: (f) => f.q58_buy_or_commission === "Handle on commission (aggregator)" },
      { kind: "multichip", name: "q59_collateral_type", label: "Q59. Collateral currently provided", options: ["Pledged Produce", "Warehouse Receipt", "Buyer Receivable", "Escrow Account", "FPO Fixed Assets", "Corporate Guarantee", "Promoter Guarantee", "Joint Liability", "Other"] },
      { kind: "text", name: "q59_collateral_other", label: "Specify Other Collateral", when: (f) => (f.q59_collateral_type || "").includes("Other") },
      { kind: "number", name: "q60_pledged_produce_share_pct", label: "Q60. Proportion of financing secured via pledged produce (%)" },
      { kind: "select", name: "q61_collateral_effort", label: "Q61. Effort involved in storing produce as collateral", options: ["1 Very low effort", "2 Low effort", "3 Moderate effort", "4 High effort", "5 Very high effort"] },
      { kind: "number", name: "q62_max_interest_rate", label: "Q62. Maximum affordable interest rate for working capital (% p.a.)" },
      { kind: "select", name: "q63_loan_tenure", label: "Q63. Loan tenure matching the procurement-to-sale cycle", options: ["<15 Days", "15-30 Days", "30-60 Days", ">60 Days"] },
    ],
    tables: [
      {
        kind: "fixed", name: "credit_facilities", title: "Q55. Credit Facilities Currently Held", rowLabelHeader: "Facility",
        rows: ["Working capital or cash credit", "Term loan", "Commodity or pledge finance", "Equity grant (SFAC or other)", "Other"],
        columns: [
          { key: "lender", label: "Lender", type: "text" },
          { key: "sanctioned", label: "Sanctioned (INR lakh)", type: "number" },
          { key: "utilised", label: "Utilised (INR lakh)", type: "number" },
          { key: "roi", label: "ROI (%)", type: "number" },
        ],
      },
      {
        kind: "dynamic", name: "credit_history", title: "55a. Credit History — Loans Taken and Closed", addLabel: "Add past loan",
        columns: [
          { key: "lender", label: "Lender", type: "text" }, { key: "purpose", label: "Purpose", type: "text" },
          { key: "amount", label: "Amount (INR lakh)", type: "number" }, { key: "roi", label: "ROI (%)", type: "number" },
          { key: "year_sanction", label: "Year of Sanction", type: "text" }, { key: "year_repayment", label: "Year of Repayment", type: "text" },
          { key: "repaid_on_time", label: "Repaid on Time", type: "select", options: YES_NO },
        ],
      },
      {
        kind: "fixed", name: "credit_gap", title: "55d. Gap Between Credit Needed and Credit Availed", rowLabelHeader: "Purpose",
        rows: ["Working capital for procurement", "Infrastructure or equipment", "Input business", "Other"],
        columns: [
          { key: "credit_needed", label: "Credit Needed (INR lakh)", type: "number" },
          { key: "credit_availed", label: "Credit Availed (INR lakh)", type: "number" },
          { key: "gap", label: "Gap (INR lakh)", type: "number" },
        ],
      },
    ],
  },
  {
    key: "farmer_dynamics", label: "Farmer Dynamics & Partnership", hint: "Member services, buyers & trial readiness", icon: Handshake,
    fields: [
      { kind: "multichip", name: "q64_trader_preference_reasons", label: "Q64. Why farmers currently prefer traders (select up to three)", options: ["Better price", "Immediate payment", "Credit or advance", "Long relationship", "Convenience", "Farm-gate collection", "Accepts variable quality", "No deduction for moisture", "Other"] },
      { kind: "text", name: "q64_reasons_other", label: "Specify Other Reason", when: (f) => (f.q64_trader_preference_reasons || "").includes("Other") },
      { kind: "textarea", name: "q65_what_would_shift_farmers", label: "Q65. What would make farmers shift more produce to the FPO?" },
      { kind: "multichip", name: "q67_intercrops", label: "Q67. Main intercrops members undertake", options: ["Coffee", "Pepper", "Cocoa", "Banana", "Other"] },
      { kind: "text", name: "q67_intercrops_other", label: "Specify Other Intercrop", when: (f) => (f.q67_intercrops || "").includes("Other") },
      { kind: "multichip", name: "q67_fpo_support", label: "FPO Support Provided for Intercrops", options: ["Extension", "Inputs", "Market linkage", "None"] },
      { kind: "number", name: "q67_intercropping_share_pct", label: "Approximate Share of Members Intercropping (%)" },
      { kind: "multichip", name: "q68_farmer_challenges", label: "Q68. Main challenges farmers report in arecanut cultivation", options: ["Pest and disease attacks", "Credit", "Market", "Advisory", "Labour shortage", "Other"] },
      { kind: "text", name: "q68_challenges_other", label: "Specify Other Challenge", when: (f) => (f.q68_farmer_challenges || "").includes("Other") },
      { kind: "number", name: "q69_committed_volume_mt", label: "Total Volume Already Committed for Coming Season (MT)" },
      { kind: "number", name: "q69_uncommitted_volume_mt", label: "Uncommitted Volume Available (MT)" },
      { kind: "multichip", name: "q70_buyer_requirements", label: "Q70. If a large buyer became a long-term offtaker, what's needed (top three)", options: ["Assured volume", "Competitive price", "Faster payment", "Working capital", "Quality training", "Collection infrastructure", "Storage support", "Farmer development", "Long contract", "Transparent pricing"] },
      { kind: "text", name: "q70_top_three", label: "Top Three, in Order (comma-separated)" },
      { kind: "select", name: "q71_trial_consignment", label: "Q71. Willing to participate in a small trial consignment?", options: ["No", "Maybe", "Yes", "Yes, immediately"] },
      { kind: "number", name: "q71_trial_volume_mt", label: "Trial Volume Suggested (MT)", when: (f) => f.q71_trial_consignment && f.q71_trial_consignment !== "No" },
      { kind: "text", name: "q71_earliest_month", label: "Earliest Month Available", when: (f) => f.q71_trial_consignment && f.q71_trial_consignment !== "No" },
      { kind: "select", name: "q72_board_resolution", label: "Q72. Would the Board pass a resolution authorising this?", options: ["Yes", "No", "Needs discussion"] },
      { kind: "text", name: "signature", label: "Signature (Name)" },
      { kind: "text", name: "signature_date", label: "Date" },
    ],
    tables: [
      {
        kind: "fixed", name: "services_to_members", title: "Q66. Services Currently Delivered to Members", rowLabelHeader: "Service",
        rows: ["Credit support", "Storage support", "Market linkage", "Advisory support", "Government scheme convergence", "Input supply"],
        columns: [
          { key: "provided", label: "Provided", type: "select", options: YES_NO },
          { key: "members_reached", label: "Members Reached", type: "number" },
          { key: "remarks", label: "Remarks", type: "text" },
        ],
      },
      {
        kind: "fixed", name: "buyers", title: "Q69. Institutional Buyers Currently Supplied", rowLabelHeader: "Buyer Type",
        rows: ["Corporate or processor", "Cooperative federation", "Trader or aggregator", "Other"],
        columns: [
          { key: "volume_mt", label: "Volume (MT/year)", type: "number" },
          { key: "advance_pct", label: "Advance Received (%)", type: "number" },
          { key: "logistics_by", label: "Logistics Borne By", type: "text" },
          { key: "payment_days", label: "Payment Days", type: "number" },
          { key: "exclusive", label: "Exclusive", type: "select", options: YES_NO },
        ],
      },
    ],
  },
];

const NUMBER_FIELD_NAMES = new Set(
  STEPS.flatMap((s) => s.fields.filter((f) => f.kind === "number").map((f) => f.name))
);

function emptyForm() {
  const f: any = {};
  for (const step of STEPS) for (const field of step.fields) f[field.name] = field.kind === "multichip" ? [] : "";
  return f;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="gt-label">{label} {required && <span className="text-[var(--gt-danger)]">*</span>}</label>
      {children}
    </div>
  );
}

function YesNoToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="gt-toggle-yn">
      <button type="button" className={value === "Yes" ? "active-yes" : ""} onClick={() => onChange("Yes")}>Yes</button>
      <button type="button" className={value === "No" ? "active-no" : ""} onClick={() => onChange("No")}>No</button>
    </div>
  );
}

function MultiChipField({ options, value, onToggle }: { options: string[]; value: string[]; onToggle: (v: string) => void }) {
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

function renderField(spec: FieldSpec, form: any, set: (name: string, v: any) => void) {
  if (spec.when && !spec.when(form)) return null;
  const value = form[spec.name] ?? "";

  if (spec.kind === "yesno") {
    return <Field key={spec.name} label={spec.label}><YesNoToggle value={value} onChange={(v) => set(spec.name, v)} /></Field>;
  }
  if (spec.kind === "multichip") {
    const arr: string[] = Array.isArray(value) ? value : (value ? String(value).split(",") : []);
    const toggle = (opt: string) => set(spec.name, arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt]);
    return <Field key={spec.name} label={spec.label}><MultiChipField options={spec.options} value={arr} onToggle={toggle} /></Field>;
  }
  if (spec.kind === "select") {
    return (
      <Field key={spec.name} label={spec.label} required={spec.required}>
        <select className="gt-input" value={value} onChange={(e) => set(spec.name, e.target.value)}>
          <option value="">Select</option>
          {spec.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Field>
    );
  }
  if (spec.kind === "textarea") {
    return (
      <Field key={spec.name} label={spec.label} required={spec.required}>
        <textarea className="gt-input" rows={2} value={value} onChange={(e) => set(spec.name, e.target.value)} />
      </Field>
    );
  }
  return (
    <Field key={spec.name} label={spec.label} required={spec.required}>
      <input
        type={spec.kind === "number" ? "number" : "text"}
        className="gt-input"
        value={value}
        onChange={(e) => set(spec.name, e.target.value)}
      />
    </Field>
  );
}

function FixedTableEditor({ table, form, set }: { table: TableSpec & { kind: "fixed" }; form: any; set: (name: string, v: any) => void }) {
  const data = useMemo(() => {
    try { return form[table.name] ? JSON.parse(form[table.name]) : {}; } catch { return {}; }
  }, [form[table.name]]);

  const updateCell = (row: string, col: string, val: string) => {
    const next = { ...data, [row]: { ...(data[row] || {}), [col]: val } };
    set(table.name, JSON.stringify(next));
  };

  return (
    <div className="mb-4">
      <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">{table.title}</div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-[var(--gt-text-muted)]">
              <th className="px-2 py-1.5 font-medium min-w-[140px]">{table.rowLabelHeader || "Row"}</th>
              {table.columns.map((c) => <th key={c.key} className="px-2 py-1.5 font-medium min-w-[120px]">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row} className="border-t border-[var(--gt-border)]">
                <td className="px-2 py-1.5 font-medium">{row}</td>
                {table.columns.map((c) => (
                  <td key={c.key} className="px-2 py-1.5">
                    {c.type === "select" ? (
                      <select className="gt-input text-xs py-1" value={(data[row] || {})[c.key] || ""} onChange={(e) => updateCell(row, c.key, e.target.value)}>
                        <option value="">—</option>
                        {c.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={c.type === "number" ? "number" : "text"}
                        className="gt-input text-xs py-1"
                        value={(data[row] || {})[c.key] || ""}
                        onChange={(e) => updateCell(row, c.key, e.target.value)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DynamicTableEditor({ table, form, set }: { table: TableSpec & { kind: "dynamic" }; form: any; set: (name: string, v: any) => void }) {
  const rows: any[] = useMemo(() => {
    try { return form[table.name] ? JSON.parse(form[table.name]) : []; } catch { return []; }
  }, [form[table.name]]);

  const updateRows = (next: any[]) => set(table.name, JSON.stringify(next));
  const updateCell = (i: number, col: string, val: string) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [col]: val } : r));
    updateRows(next);
  };
  const addRow = () => updateRows([...rows, {}]);
  const removeRow = (i: number) => updateRows(rows.filter((_, idx) => idx !== i));

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm text-[var(--gt-purple-dark)]">{table.title}</div>
        <button type="button" onClick={addRow} className="text-xs font-medium text-[var(--gt-purple)]">+ {table.addLabel}</button>
      </div>
      {rows.length === 0 && <div className="text-xs text-[var(--gt-text-muted)]">No rows yet.</div>}
      <div className="overflow-x-auto -mx-1">
        {rows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-[var(--gt-text-muted)]">
                {table.columns.map((c) => <th key={c.key} className="px-2 py-1.5 font-medium min-w-[120px]">{c.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[var(--gt-border)]">
                  {table.columns.map((c) => (
                    <td key={c.key} className="px-2 py-1.5">
                      {c.type === "select" ? (
                        <select className="gt-input text-xs py-1" value={r[c.key] || ""} onChange={(e) => updateCell(i, c.key, e.target.value)}>
                          <option value="">—</option>
                          {c.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          type={c.type === "number" ? "number" : "text"}
                          className="gt-input text-xs py-1"
                          value={r[c.key] || ""}
                          onChange={(e) => updateCell(i, c.key, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <button type="button" onClick={() => removeRow(i)} className="text-red-500 text-xs">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function FPOConsultationWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const existingId = searchParams.get("id");

  const [id, setId] = useState<number | null>(existingId ? Number(existingId) : null);
  const [status, setStatus] = useState<string>("draft");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<any>(emptyForm());
  const [loading, setLoading] = useState(!!existingId);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!existingId) return;
    api.getFpoConsultation(Number(existingId)).then((data: any) => {
      const merged = emptyForm();
      for (const key of Object.keys(merged)) {
        if (data[key] == null) continue;
        const spec = STEPS.flatMap((s) => s.fields).find((f) => f.name === key);
        if (spec?.kind === "multichip") merged[key] = String(data[key]).split(",").filter(Boolean);
        else merged[key] = String(data[key]);
      }
      // table fields: copy raw JSON text through untouched
      for (const step of STEPS) for (const t of step.tables || []) merged[t.name] = data[t.name] || "";
      setForm(merged);
      setStatus(data.status);
      setId(data.id);
      setLoading(false);
    }).catch((e) => { setError(e.message); setLoading(false); });
  }, [existingId]);

  const set = (name: string, value: any) => setForm((f: any) => ({ ...f, [name]: value }));

  const buildPayload = () => {
    const payload: any = {};
    for (const [k, v] of Object.entries(form)) {
      if (v === "" || v === undefined) continue;
      if (Array.isArray(v)) { payload[k] = v.join(","); continue; }
      if (NUMBER_FIELD_NAMES.has(k)) { const n = Number(v); if (!Number.isNaN(n)) payload[k] = n; continue; }
      payload[k] = v;
    }
    return payload;
  };

  const saveDraft = async (): Promise<number | null> => {
    setSaving(true);
    setError("");
    try {
      const payload = buildPayload();
      if (id) {
        await api.updateFpoConsultation(id, payload);
      } else {
        const created = await api.createFpoConsultation(payload);
        setId(created.id);
        // Reflect the new id in the URL so a refresh resumes the same draft.
        navigate(`/entry/fpo?id=${created.id}`, { replace: true });
        return created.id;
      }
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 1500);
      return id;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    await saveDraft();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = async () => {
    await saveDraft();
    setStep((s) => Math.max(s - 1, 0));
  };

  const submit = async () => {
    const savedId = await saveDraft();
    if (!savedId) return;
    try {
      await api.submitFpoConsultation(savedId);
      navigate("/fpo-consultations");
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loading) {
    return <div className="text-center text-[var(--gt-text-muted)] py-10">Loading…</div>;
  }

  if (status === "submitted") {
    return (
      <div className="gt-card p-6 text-center flex flex-col items-center gap-2">
        <CheckCircle2 size={32} className="text-[var(--gt-success)]" />
        <div className="font-semibold text-[var(--gt-purple-dark)]">This consultation has already been submitted.</div>
        <p className="text-sm text-[var(--gt-text-muted)]">It can no longer be edited. View it from the FPO Consultations list.</p>
        <button type="button" className="gt-btn-secondary mt-2" onClick={() => navigate("/fpo-consultations")}>Back to List</button>
      </div>
    );
  }

  const current = STEPS[step];
  const CurrentIcon = current.icon;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">FPO Consultation</h1>
        <span className="text-xs font-medium text-[var(--gt-text-muted)] bg-[#F1EBF7] px-2.5 py-1 rounded-full whitespace-nowrap">
          {step + 1} of {STEPS.length}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl gt-gradient text-white flex items-center justify-center shrink-0">
          <CurrentIcon size={22} />
        </div>
        <div>
          <div className="text-base font-semibold text-[var(--gt-purple-dark)] leading-tight">{current.label}</div>
          <p className="text-sm text-[var(--gt-text-muted)] leading-tight">{current.hint}</p>
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
              key={s.key}
              type="button"
              onClick={() => setStep(i)}
              className={`shrink-0 flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-full border whitespace-nowrap transition-colors ${
                isActive ? "gt-gradient text-white border-transparent shadow-sm"
                : isDone ? "bg-[#F1EBF7] text-[var(--gt-purple-dark)] border-[var(--gt-purple-light)]"
                : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
              }`}
            >
              {isDone ? <CheckCircle2 size={14} /> : <Icon size={14} />}
              {s.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="gt-card p-4">
        <div className="grid md:grid-cols-2 gap-x-4">
          {current.fields.map((f) => renderField(f, form, set))}
        </div>
        {(current.tables || []).map((t) =>
          t.kind === "fixed"
            ? <FixedTableEditor key={t.name} table={t} form={form} set={set} />
            : <DynamicTableEditor key={t.name} table={t} form={form} set={set} />
        )}
      </div>

      <div className="flex justify-between items-center gap-3">
        <button className="gt-btn-secondary flex items-center gap-1" onClick={step === 0 ? () => navigate("/entry") : back} disabled={saving}>
          <ChevronLeft size={16} /> {step === 0 ? "Cancel" : "Back"}
        </button>
        <div className="flex items-center gap-3">
          {saveMsg && <span className="text-xs text-[var(--gt-success)] flex items-center gap-1"><Save size={12} /> {saveMsg}</span>}
          <button className="gt-btn-secondary" onClick={saveDraft} disabled={saving}>
            {saving ? "Saving…" : "Save Draft"}
          </button>
          {step < STEPS.length - 1 ? (
            <button className="gt-btn-primary flex items-center gap-1" onClick={next} disabled={saving}>
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button className="gt-btn-primary flex items-center gap-1.5" onClick={submit} disabled={saving}>
              <CheckCircle2 size={16} /> Submit Consultation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
