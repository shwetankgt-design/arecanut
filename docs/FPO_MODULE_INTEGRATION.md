# FPO Consultation module — integration contract and change tracker

Shared by two sessions: the **core session** (main checkout, branch `shwetank-25-Oct-onwards`) and the **FPO sub-session** (its own worktree/branch). Read this file first; update the Change Log below with every change. The user (shwetank) wants all rules built for the farmer-survey module applied to FPO.

## 1. Goal and decisions (from the user)
Rebuild the FPO Consultation module (already in the app: `backend/app/fpo_consultation.py`, model `FPOConsultation`, `FPOConsultationIn/Out/ListItem` in `schemas.py`, `frontend/src/pages/FPOConsultationWizard.tsx` (config-driven `STEPS`), `FPOConsultationsList.tsx`) so that:
1. **All master data comes from Master Data Management** (admin screen `/masters`, backend `master_data.py` generic CRUD; option lists in `OptionMaster` read through `GET /api/masters/options?list_code=`; districts/talukas/villages/societies/crops/schemes/machines via `/api/masters/*`). Every FPO dropdown option list now hard-coded in the wizard becomes an OptionMaster list (new `list_code`s prefixed `fpo_`, seeded from today's values; seed via `backend/app/seed.py` + `data/master_data_seed.json` and an idempotent startup/seed step so existing databases get them). District, taluka, society/FPO name, crops (primary/secondary) become master-data pick-lists instead of free text. Store the chosen **label text** (as today) so editing a master list never changes old consultations.
2. FPO **follows every rule built for the farmer-survey module** (see section 2).
3. FPO remains part of the core app: same login, same permission module `fpo_consultation`, same database (additive schema changes only; new columns are auto-added by `sync_missing_columns`, remember old rows are NULL → response models must tolerate None and add a backfill in `db.migrate_roles_and_permissions` if a default matters).

## 2. Rules FPO must follow (copy the farmer-survey behaviour)
Reference implementation: `backend/app/main.py` (`owned_by`, `_own_condition`, `get_owned_survey`, `assert_editable`, `stamp_modified`, `resolve_device_id`, freeze endpoints, `serialize_survey`) and `frontend/src/pages/{FarmerList,SurveyView}.tsx`. Specifically:
* **Owner-only access:** a field user sees/edits only consultations they created or that admin assigned (`assigned_to_user_id`); legacy rows with no creator are admin-only (there is no enumerator_name on FPO — decide the legacy fallback, document it here). Non-owned id → 404. Admin sees all. Data-verifier users see own + mapped users' records (same mapping as surveys). Admin assigns from a dropdown on the record page; bulk assign API.
* **Audit trail fields** set server-side: `device_id`, `last_modified_by_user_id`, `last_modified_at`, `last_modified_device_id` (`X-Device-Id` header); created-by/at already exist.
* **Filters:** date range (all users), admin multi-user filter, frozen filter, status; export (Excel) with the same filters if the survey list has it.
* **Data Verifier + freeze/unfreeze:** single + bulk, web only (android device id → 403), needs `data_verifier` or admin, drafts can't be frozen, every transition logged (separate freeze-log table for FPO or a generalised one — keep survey behaviour unchanged) + `audit_log`; frozen ⇒ HTTP 423 for everyone incl. admin on any edit until unfrozen; Edit button red+disabled when frozen, green otherwise; history panel on the record page.
* **Submitted records:** farmer-survey submitted records stay editable (only freezing locks them). Apply the same: replace today's "submitted = no more edits (400)" with the freeze mechanism; delete stays admin-only.
* **Pagination:** server-side `limit/offset` + `X-Total-Count`, shared `components/Pagination.tsx`, URL-synced `page/page_size`.
* **Validation:** fix the gaps in the FPO review (`docs`-less; see memory note `project-arecanut-fpo-review-2026-10-27`): required fields enforced at submit, whole-number fields reject decimals on screen (don't advance the wizard on a save error), non-negative numbers, 0–100 percentages, GPS ranges, date pickers, 10-digit mobile, dropdown values validated against the master list, text length limits.
* **Offline / language / MIS (optional, ask the core session before doing):** offline queue like surveys; Kannada via the i18n map; FPO reports registered in the MIS catalog (`backend/app/mis.py` `@report`).

## 3. Integration contract with the core module (do not break)
* Permission module `fpo_consultation` (`auth.MODULE_DEFS`); roles via `auth.ROLE_DEFS`. New permission checks use `require_permission(...)`; `mis_user` role is refused there automatically.
* Master data: only read through the existing endpoints; adding a list = rows in `OptionMaster` (see `OptionMaster` model and `master_data.py`); admin edits them in `/masters`.
* Shared UI: `components/{Pagination,MultiSelect,CatalogPicker}.tsx`, `lib/paging.ts`, `api.ts` (`reqPaged`, `Paged`). Reuse, don't fork.
* Startup hooks in `main.py`: `create_all`, `sync_missing_columns`, `sync_nullable_columns`, `migrate_roles_and_permissions`, `mis.sync_catalog`.
* Login rate limit 15/min, API default 120/min per IP; local backend 8300 / frontend 3701 belong to the CORE session — the FPO session must use **8301 / 3702** (Vite proxy in `vite.config.ts` targets 8300; change it only in the FPO worktree, never merge that change) and its own copy of `backend/arecanut.db`.
* Restart uvicorn after backend edits; the frontend falls back to built-in lists if an endpoint is missing, but never rely on that for FPO master data in production.

## 4. File ownership (to avoid merge conflicts)
| Owned by FPO session | Shared — small, listed edits only (note them in the Change Log) |
|---|---|
| `backend/app/fpo_consultation.py`, FPO parts of `models.py`/`schemas.py`, `frontend/src/pages/FPOConsultation*.tsx`, new FPO components, FPO seed/option lists | `main.py`, `master_data.py`, `seed.py`, `data/master_data_seed.json`, `api.ts`, `App.tsx`, `Layout.tsx`, `UserManagement.tsx`, `mis.py` |
The core session will not touch the FPO-owned files while the sub-session runs; it will tell the sub-session (via this file's "Messages") about any change to shared code.

## 5. Hand-back
Work on the worktree branch; commit there when a piece is done and tested (`tsc -b`, `vitest run`, API scenario checks, browser check). Do NOT push, deploy, or touch `main`. When finished: update the Change Log, list every shared file touched, then the core session merges the branch into `shwetank-25-Oct-onwards`.

## 6. Messages between sessions (newest first)
* (core → FPO, 2026-10-29) Brief written. Base = commit `89c4db8` (includes MIS role, pagination, MultiSelect, Plots Map). Decisions in section 1 are final.

## 7. Change Log (add a row per change)
| Date | Session | Files | What changed | Effect on core |
|---|---|---|---|---|
| 2026-10-29 | core | docs/FPO_MODULE_INTEGRATION.md | Created this contract | none |

## 8. Status / open questions
* Status: not started.
* Open: legacy-row ownership rule for FPO; whether FPO gets its own freeze-log table or a generalised one; whether to add Excel export/offline/Kannada/MIS reports for FPO.
