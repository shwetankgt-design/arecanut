# Arecanut Farmer Survey — Project State & Change Log

**Read this file first in any new session.** It is the single source of truth for
what has been built, what is deployed where, what is intentionally skipped, and
what is still open. Update it at the end of every work session — before ending a
session, append a new entry under "Session Log" and update "Current Status" and
"Open Items" so a future session (or a different machine) can resume without
re-deriving context.

---

## 1. Architecture Overview

- **Backend**: FastAPI (Python), deployed as a Vercel serverless function.
  - Repo path: `backend/`
  - Vercel project: `arecanut-backend` (org `shwetankgt-6475s-projects`, project id `prj_qvzGni83U8yz2VphYd8mIXI7dsnE`)
  - Live URL: `https://arecanut-backend.vercel.app`
  - Database: Neon Postgres (serverless), connected via `DATABASE_URL` env var on Vercel.
  - Auth: JWT access + rotating hashed refresh tokens, bcrypt password hashing, account lockout, audit log.
- **Frontend**: React 19 + Vite + Tailwind v4, PWA-enabled (offline queue via IndexedDB).
  - Repo path: `frontend/`
  - Vercel project: `arecanut-frontend` (project id `prj_iEZARjJW3nuBseUeg4wbuWdGCz5j`)
  - Live URL: `https://arecanut-frontend.vercel.app`
  - Local dev proxy: `vite.config.ts` proxies `/api` → `http://127.0.0.1:8300` (see "Known Environment Quirks" below).
- **Mobile**: Same web bundle wrapped via Capacitor → native Android APK (not on Play Store; sideloaded).
  - Repo path: `frontend/android/`
  - Package: `com.gtbharat.arecanutsurvey`
  - Signing keystore: `keystore/arecanut-release.jks` (already existed before this file was created; keep `frontend/android/keystore.properties` in sync).
  - **Every APK build must**: (1) bump `versionCode`/`versionName` in `frontend/android/app/build.gradle`, (2) rebuild the web bundle with production env vars, (3) `npx cap sync android`, (4) `./gradlew.bat assembleRelease` with JDK 21, (5) verify with `apksigner verify`.
- **Git**: `D:\CLAUD\arecanut-app` is a git repo, remote `https://github.com/shwetankgt-design/arecanut.git`, branch `main`. Auto-deploy from GitHub is configured on Vercel, but **most work this session was deployed directly via `vercel --prod` from the local working tree**, not via git push — so local working tree state may be ahead of the last git commit. Check `git status` / `git log` before assuming git reflects reality.

### Deploying to production (both projects)
```bash
# Backend
cd D:\CLAUD\arecanut-app
VERCEL_ORG_ID=team_KGHELcz7BAh5sHUPab02EX6P VERCEL_PROJECT_ID=prj_qvzGni83U8yz2VphYd8mIXI7dsnE vercel --prod --yes

# Frontend (rebuild first if env vars matter for the build)
cd D:\CLAUD\arecanut-app
VERCEL_ORG_ID=team_KGHELcz7BAh5sHUPab02EX6P VERCEL_PROJECT_ID=prj_iEZARjJW3nuBseUeg4wbuWdGCz5j vercel --prod --yes
```
Both commands must be run from the **repo root** (`D:\CLAUD\arecanut-app`), not from `backend/` or `frontend/` — each Vercel project has "Root Directory" set to its subfolder, and running from inside that subfolder makes the CLI look for a nested copy of itself and fail.

### Known environment quirks (read before debugging "it's not working")
- **Port 8300 has a history of being occupied by an unkillable zombie process** in this dev environment (not visible to `Get-Process`/`taskkill`/`wmic` from this session, for reasons never fully diagnosed — likely started in a terminal outside this agent's process tree). If local backend testing against `:8300` behaves inconsistently or serves stale code, do not assume the code is wrong — try binding a fresh port (e.g. `:8301`, `:8303`) and temporarily edit `vite.config.ts`'s proxy target to match, then **revert vite.config.ts back to `:8300` when done** (that's the documented/expected dev port).
- Any one-off Python script that touches the DB **must `import app.main` first** (not just `from app.db import ...`), because SQLAlchemy models only register onto `Base.metadata` as an import side-effect of `app/models.py`, which `app/main.py` imports. A script that skips this will silently no-op against an empty metadata set (produces a false "nothing to do" result).
- `Base.metadata.create_all()` never alters existing tables — it only creates missing tables. New columns added to a model need `sync_missing_columns()` (in `app/db.py`, called on every `app.main` startup) to actually appear in an existing live database. This is why it's safe to add new nullable columns to `FarmerSurvey`/etc. without a real migration tool — but it means schema changes are additive/nullable-only unless a real migration is written.
- **Postgres sequence desync**: the original seed script bulk-inserted `District`/`Taluka`/`Village`/`Society` rows with explicit Python-assigned ids, which never advances Postgres's own auto-increment sequence. Any future ordinary `INSERT` (not `bulk_insert_mappings` with explicit ids) into these tables in production will collide on `id` unless the sequence is first resynced: `SELECT setval(pg_get_serial_sequence('<table>', 'id'), COALESCE((SELECT MAX(id) FROM <table>), 1))`.
- **Vercel CLI transient failures**: `vercel --prod` occasionally fails with `fetch failed` or `ENOENT ...db-journal` mid-upload — these are transient; just retry the exact same command.
- **Pydantic validator inheritance trap**: `SurveyOut(SurveyIn)` inherits ALL of `SurveyIn`'s `@model_validator`s, including ones that should only apply to *input* (e.g. "plot boundary is mandatory"). If a new mandatory-field validator is added to `SurveyIn`, it will also run when serializing existing DB rows for `GET` responses — and any pre-existing row that doesn't satisfy the new rule will make the *entire list endpoint 500*. This exact bug shipped once (see Session Log, "Farmer Records not visible" root cause) and was fixed by redefining the same-named validator as a no-op inside `SurveyOut` to override it. **Any new mandatory `model_validator` added to `SurveyIn` going forward must be checked against this trap** — either make it genuinely safe for old rows, or explicitly neutralize it in `SurveyOut`.
- **One-off production data migrations** (e.g. importing the real FPC-Taluka mapping) were done by temporarily adding an admin-only POST endpoint to `main.py`, calling it once via curl with an admin JWT, then **removing the endpoint and redeploying clean**. Never leave such an endpoint in production. If you find one in the code, either it's mid-migration (finish it) or it was missed during cleanup (remove it).
- **Recharts `<Pie>` gotchas** (found while fixing the dashboard pie-chart bug): (1) a `label` prop given as a function MUST return a positioned SVG element (Recharts' own documented pattern: use `cx`/`cy`/`midAngle`/`innerRadius`/`outerRadius` from the callback's props to compute `x`/`y`, wrap in `<text>`) — returning a bare string renders **nothing at all**, not just a missing label, the whole Pie's sectors disappear too. (2) Recharts' Pie entrance animation can get stuck and never complete in constrained/headless browser environments, which independently also blocks all rendering — `isAnimationActive={false}` on the `<Pie>` fixes it and is a reasonable permanent choice for a data dashboard (no need for entrance animation on load). Both issues stack; a Pie chart that renders nothing could be either or both — check with browser DevTools/DOM inspection (`svg.querySelectorAll('path').length`) rather than assuming it's a data problem.

---

## 2. Data Model Snapshot

`FarmerSurvey` (backend/app/models.py) is the single large table backing every survey record. It has grown additively across rounds — see Session Log for what was added when. Key structural facts:
- `plot_boundary`, `plot_boundary_area_acres`, `plot_boundary_method`, `plot_boundary_captured_at` — polygon capture, mandatory on new submissions (enforced in `SurveyIn`, neutralized in `SurveyOut` — see trap above).
- `field_photo` — `Text` column, stores a base64 data URL (client-compressed JPEG, ~1280px, quality 70), NOT a file path. There is no object storage configured; this is a known scale limitation (see `PROJECT_STATE.md` infra notes / chat history — flagged to the user as needing S3/R2/Blob storage before high photo volume).
- `mobile_verified` — Boolean; OTP verification is currently **simulated client-side** (no real SMS gateway wired up). Do not treat `mobile_verified=true` as evidence a real OTP was sent.
- `Society` table has `taluka_id` + `is_state_level` — real data imported from the client's FPC_Taluka Excel sheet (64 FPOs, 13 talukas across Chikkamagaluru/Shivamogga). Talukas newly created for this import (Ajjampura, Kadur, Tarikere, Kalasa, Bhadravathi, Shikaripura, Soraba, and the "Chikkamagaluru"/"Shivamogga" town talukas) have **no village data** — this is a known open gap (client's Excel didn't include villages for them; client's social team needs to supply it — see Open Items).
- `MachineMaster` has a `sort_order` column (added in the v4 round) — the `/api/masters/machines` endpoint orders by this, not by name, specifically so "Any Other" sorts last instead of alphabetically-first. Any future machine added to this table needs an explicit `sort_order` set, or it will default to 0 and jump to the front.
- **Many `<multi-select>` fields now have a matching `_other` free-text column** for their "Other"/"Any Other" option, added across the v4 round: `society_benefits_other`, `intercrop_crops_other`, `cultivation_challenges_other`, `mech_owned_other`, `mech_rented_other`, `non_farm_income_source_other`, `credit_source_other`, `loan_rejection_reason_other`, `input_source_other` (plus `logistics_provider_other` and `input_challenges_other` from the v3 round). If a new option list gains an "Other" choice in the future, follow this same pattern rather than inventing a new one.
- `total_household_income_bracket` (string enum: `<10000` / `10000-1L` / `1L-10L` / `>10L`) supersedes `total_household_income_inr_lakh` (kept in the schema/DB but no longer written by the wizard) — the client asked for a bracket dropdown instead of free numeric entry (OBS-048).
- `sale_type` now has a third valid value, `"Sold both raw and processed areca"`, alongside the original two — both `yield_raw_qtl` and `yield_processed_qtl` are populated when this is selected, and both `compute_income()` (backend) and `computedIncome` (frontend) sum both components (OBS-050).
- Monetary field bounds tightened in the v4 round: absolute-INR amount fields capped at ₹10 crore (100,000,000), INR-Lakh fields capped at 1000 (=₹10 crore), all "Interest Rate (%)" fields capped at 20 and relabeled "per annum". **Before tightening any numeric `Field(le=...)` bound in the future, check it against live production data first** (`SurveyOut.model_validate()` against all current records) — a `Field` bound is inherited by `SurveyOut` just like a `model_validator` is, so tightening it can break `GET` responses for existing out-of-range rows exactly the same way as the validator-inheritance trap in section 1.

## 3. Current Status (update this section every session)

**Last updated**: 2026-09-27, end of v4 fix round (client retest file `Arecanut_ValueChain_DigitalPlatform_220926_TV2.xlsx`, 51 observations).

**Latest APK delivered**: v4.0 (versionCode 4) — built from the production web bundle with all v4 fixes below, signed, verified (`apksigner verify`), delivered to the user, and the version bump committed/pushed.

**Backend and frontend are both deployed to production with all v4 fixes** (see Session Log below for the full list and verification notes). All 104 production survey records were re-validated against the new schema before and after deploy — zero regressions.

## 4. Explicit "skip for now" items (do NOT implement without new instruction)

These were explicitly deferred by the client in the v4 retest file — do not build them speculatively:
- **OBS-010**: OTP-based farmer *registration* workflow (distinct from in-wizard mobile-verify OTP). Client: "skip this functionality for now, we will integrate this with actual APIs."
- **OBS-016**: Showing village/taluka/district name alongside raw GPS coordinates during capture. Client: "this function is not required."
- **OBS-028**: Android hardware back-button interception (currently exits the app). Client: "Skip this functionality for now."

## 5. Open items genuinely blocked on external input (not code work)

- **OBS-011**: Village master data is incomplete, especially for newly-added talukas. Client's own retest note says "Social Team may help with the data requirement" — this needs a real village list from the client, not fabricated data.
- **OBS-013**: Mobile dropdown spacing/population issue — needs verification on an actual device/viewport; can implement a best-guess fix (see Session Log) but should be confirmed on real hardware.
- **OBS-034**: Full Kannada translation audit — large scope, not attempted holistically yet.
- **OBS-046/048**: Client noted "FS team may provide inputs on upper limits" / "Social & FS Team may provide inputs" for exact numeric caps — implemented with the specific numbers the client DID give in the "Expected Outcome" column (20% interest cap, ₹10 crore absolute cap, household income brackets), but these are provisional pending the named teams' sign-off.

## 6. Session Log

### Session — 2026-09-27 (v4 retest fixes — COMPLETE, deployed to production)
Source: client-provided `Arecanut_ValueChain_DigitalPlatform_220926_TV2.xlsx`, 51 OBS items with a new "Expected Outcome" column.

Status key: ✅ done and deployed · ⏭️ skipped per explicit client instruction · 🚫 blocked on external data/input

- OBS-003 ✅ — Cultivation Challenges "Other" now shows a free-text field (`cultivation_challenges_other`, new column).
- OBS-006 ✅ — Location Details (District→Taluka→Village) now comes before Society/FPC Linkage in the wizard, so the taluka-scoped FPC list is populated before the farmer has to pick one.
- OBS-011 🚫 — Village master data for newly-added talukas (Ajjampura, Kadur, Tarikere, etc.) still missing; client's own note says their Social Team will supply it. No code fix possible without that data.
- OBS-013 ✅ — Scheme Name field: replaced the native `<datalist>` (unreliable on Android Chrome) with a plain text input plus tappable suggestion chips below it — works consistently on all devices. **Not verified on an actual Android device this session** — verify before considering fully closed.
- OBS-024 ✅ — Machines list ordering was alphabetical (`ORDER BY name`), which put "Any Other" first; added `MachineMaster.sort_order`, endpoint now orders by it, "Any Other" sorts last. Also: a machine can now be BOTH owned and rented (already fixed in v3, reconfirmed), and both `mech_owned`/`mech_rented` now have their own "Any Other" free-text fields.
- OBS-030/045 ✅ — Added `setNonNeg()` helper that strips a leading "-" at keystroke time (not just on submit) — applied to every numeric field across the wizard (~30 fields), so negative values are now structurally impossible to enter, not just flagged after the fact.
- OBS-031 ✅ — Marketing Channel "FPC/FPO" now shows the same taluka-scoped FPC dropdown as Society/FPC Linkage (reuses the `societies` state); "Any Other" now has free text too (`marketing_channel_detail` repurposed conditionally for all three: FPC picker / Cooperative-Society-or-APMC name / Any-Other text).
- OBS-032/039 ✅ — Added explicit upper bounds per the client's stated numbers: **₹10 crore** on absolute INR amount fields (cultivation cost, processing cost, storage loan amount, credit amount) and on INR-Lakh fields expressed as **1000 lakh** (mech loan, credit outstanding, credit gap, KCC limit, overdraft limit); **20% cap** on all "Interest Rate" fields, relabeled "(% per annum)" per the client's period-clarity request. Enforced in both frontend (`max` attr + `getErrors`) and backend (`Field(le=...)`). **Verified against all 104 production records first — none violated the new caps** (see the Pydantic-validator-inheritance trap in section 1; the same class of risk applies to tightened `Field(le=...)` bounds, not just `model_validator`s, and was checked before deploy).
- OBS-033/040 ✅ — Confirmed already live from a prior round (Logistics Provider and Input Source "Other" fields).
- OBS-038 ✅ — Non-Farm Income Source "Other" now has a free-text field.
- OBS-047 ✅ — Technology Solution Details now requires real text (regex: at least 2 letters), rejecting junk like "-999". Applied both client- and server-side; the server-side field_validator is neutralized in `SurveyOut` (same override pattern as the model_validator trap) so it can never break reads of old rows.
- OBS-048 ✅ — Total Household Income changed from free numeric entry to the exact bracket dropdown the client specified (<₹10,000 / ₹10,000–1L / ₹1L–10L / >₹10L). New column `total_household_income_bracket`; old `total_household_income_inr_lakh` column kept but no longer written (legacy).
- OBS-049 ✅ — Overdraft Facility question now only shows when Bank Account = Yes (and auto-clears if the user flips Bank Account back to No).
- OBS-050 ✅ — Sale Type gained a third option "Sold both raw and processed areca" — shows both yield fields, sums both into the income formula (frontend `computedIncome` and backend `compute_income()` both updated), validator updated to require both yields when "Both" is selected.
- OBS-051 ✅ — This turned out to be a **bigger bug than reported**: the two dashboard pie charts (Marketing Channel Share, Raw vs Processed Sale Share) were not just mis-summing percentages — a Pie `label` function returning a bare string (instead of a positioned `<text>` element, per Recharts' own required pattern) silently renders NOTHING at all, not even the pie sectors. Root cause was actually **two stacked issues**: (1) the label-as-string mistake, and (2) Recharts' Pie entrance animation never completes in this browser environment (a known class of headless/constrained-browser issue), which independently also blocks all rendering. Fixed both: proper positioned-`<text>` label using the largest-remainder rounding method (guarantees labels sum to exactly 100%), plus `isAnimationActive={false}` on both Pies. Verified via DOM inspection (not a visual screenshot) that both pies now render with correct labels summing to 100.

All other OBS items in the file were marked "Closed" by the client (already verified fixed in a prior round) and were not re-touched.

**Deploy sequence used**: backend deployed first (critical — includes the schema/model changes), verified all 104 production records still readable, then a temporary admin endpoint was used to backfill `MachineMaster.sort_order` in production (added, run once, removed, redeployed clean — same pattern as the FPC-Taluka import in the prior round), then frontend deployed. The Dashboard pie-chart bug was found only after the first frontend deploy (during post-deploy verification) and required a second frontend deploy to actually fix — so the very first `vercel --prod` frontend deploy of this round is NOT fully correct; only the final one is.

**Follow-up (later same day)**: v4.0 APK (versionCode 4) was built, signed, verified, and delivered. Version bump committed and pushed separately (`cba4d8d`).
