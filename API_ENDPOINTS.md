# API Configuration & Endpoint Reference

This is the single source of truth for how the web app and the mobile app
(Capacitor-wrapped build of the same React codebase) connect to the backend
API, and what every endpoint does and requires.

## How web and mobile connect to the API

Both the web app and the Android app are the **same React/Vite codebase**
(`frontend/`) — there is no separate mobile client. The only difference is
how the API base URL is resolved at build time, controlled by one file:

**`frontend/src/api.ts`** (line 4):
```ts
const BASE = import.meta.env.VITE_API_BASE || "/api";
```

| Build target | How `VITE_API_BASE` is set | Resulting `BASE` |
|---|---|---|
| Web dev server | unset | `/api`, proxied by `frontend/vite.config.ts` → `http://127.0.0.1:8300` |
| Web production (Vercel) | unset | `/api`, same-origin (frontend and backend both on Vercel, backend routed via `vercel.json`) |
| Android app (Capacitor) | set at build time to the deployed backend's absolute HTTPS URL, e.g. `https://arecanut-backend.vercel.app/api` | absolute URL — a packaged app has no dev-server proxy, so it must hit the real backend host directly |

To rebuild the Android app against a different backend, set `VITE_API_BASE`
before `npm run build && npx cap sync android`. `frontend/capacitor.config.ts`
holds the native shell config (`appId: com.gtbharat.arecanutsurvey`,
`webDir: dist`); it does not carry the API URL — that only ever lives in the
Vite env var baked into the JS bundle.

All HTTP calls in the app go through `frontend/src/api.ts`'s `api` object —
no component calls `fetch` directly. Adding a new backend endpoint means
adding one method there; nothing else in the client needs the API base URL.

Auth token handling (also centralized in `api.ts`): access token + refresh
token are stored in `localStorage` (`gt_token`, `gt_refresh_token`); a 401 on
any authenticated call triggers a silent refresh-token exchange, and only if
that also fails does the app force a re-login (`AUTH_EVENT`).

## Authentication & Authorization model

- **Two roles only**: `admin` and `field`.
- **Exactly one `admin` account may ever exist** — enforced server-side in
  `POST /api/users` and `PUT /api/users/{id}` (`backend/app/main.py`), not
  just at seed time.
- **`admin`** implicitly has access to every module; no permission grants are
  stored or checked for an admin account.
- **`field`** users have an explicit, per-user `permissions` list (not a
  fixed bundle tied to the role) — an admin sets exactly which modules each
  field user can use, from the User Management screen (`/users`, admin-only).
- Permission modules (`backend/app/auth.py::PERMISSION_MODULES`, mirrored in
  `frontend/src/pages/UserManagement.tsx::MODULE_LABELS`):
  - `survey_entry` — New Survey Entry
  - `farmer_records` — Farmer Records (view & edit)
  - `plots_map` — Plots & Map
  - `fpo_consultation` — FPO Consultation (see its own section below)
- **Single source of truth**: `PERMISSION_MODULES` lives only in `backend/app/auth.py`.
  `backend/app/schemas.py::PERMISSION_MODULE_VALUES` imports it rather than
  redeclaring it — an earlier duplicate literal list there fell out of sync
  when this module was added and rejected the new permission with a 422.
  Never hardcode the module list a second time anywhere.
- Enforcement: FastAPI dependency `require_permission(module)` on each
  protected route; the frontend mirrors this with `ProtectedRoute require=...`
  and by filtering the nav in `Layout.tsx`, but the **server-side check is
  the actual security boundary** — the frontend gating is UX only.
- `delete_survey` (`DELETE /api/surveys/{id}`) is intentionally admin-only —
  it is not exposed as a grantable field-user permission.

## Audit logging

Every user-management action, survey mutation, and auth event writes an
`AuditLog` row via `backend/app/auth.py::audit()` — standard practice fields:
`user_id`, `username`, `action`, `resource`, `ip_address`, `detail`,
timestamp. Actions currently logged: `user_create`, `user_update`, plus the
pre-existing survey/auth audit points. There is no admin UI for browsing the
audit log yet — it is queryable directly from the `audit_log` table.

## Endpoint reference

All paths are relative to `BASE` (i.e. already include `/api` once mounted).

### Auth (public except `/auth/me`)
| Method & Path | Auth | Notes |
|---|---|---|
| POST `/auth/login` | none | rate-limited, lockout after repeated failures |
| POST `/auth/refresh` | refresh token | rotates the refresh token |
| POST `/auth/logout` | none (takes refresh token in body) | revokes that refresh token |
| GET `/auth/me` | any authenticated user | returns profile incl. `role` + `permissions` |
| POST `/auth/forgot-password` | none | emails a reset link if the identifier matches |
| POST `/auth/reset-password` | reset token | consumes a single-use token |

### User management (admin-only)
| Method & Path | Notes |
|---|---|
| GET `/users` | list all users |
| GET `/users/permission-modules` | the fixed list of grantable module keys |
| POST `/users` | create a user; rejects a 2nd `role=admin` |
| PUT `/users/{id}` | update role/permissions/name/email/active/password; rejects demoting the sole admin, rejects a 2nd admin, force-revokes sessions on password change |

### Master data — read (any authenticated user; used to populate app dropdowns)
| Method & Path |
|---|
| GET `/masters/districts` |
| GET `/masters/talukas` |
| GET `/masters/villages` |
| GET `/masters/villages-flat` |
| GET `/masters/societies` |
| GET `/masters/crops` |
| GET `/masters/schemes` |
| GET `/masters/machines` |
| GET `/masters/options` |

### Master data — admin CRUD (admin-only, generic registry-driven, `backend/app/master_data.py`)
A single set of 4 routes serves **every** master table listed in `MASTER_TABLES`
(currently District/Taluka/Village/Society/CropMaster/SchemeMaster/
MachineMaster/OptionMaster) — the `{table}` path segment is one of that
registry's keys (`district`, `taluka`, `village`, `society`, `crop`,
`scheme`, `machine`, `option`). **Adding a future master table means adding
one entry to `MASTER_TABLES`, not new endpoint code.**

| Method & Path | Notes |
|---|---|
| GET `/admin/master-data/tables` | metadata for every registered table (label + field list) — the frontend (`MasterData.tsx`) renders its tabs and forms entirely from this, no hardcoded field lists |
| GET `/admin/master-data/{table}` | list rows; a foreign-key field (e.g. Taluka's `district_id`) is returned with a resolved `<field>_display` name alongside the raw id |
| POST `/admin/master-data/{table}` | create a row; validates required fields, uniqueness, and that any fk id actually exists |
| PUT `/admin/master-data/{table}/{id}` | update a row; same validation |
| DELETE `/admin/master-data/{table}/{id}` | delete a row; **blocked with a 400 if any other registered table's fk still points at it** (e.g. can't delete a District while a Taluka references it) — checked at the application level so behavior is identical on SQLite (dev) and Postgres (prod), which enforce foreign keys differently |

All five actions are audit-logged (`master_data_create`/`master_data_update`/`master_data_delete`).

### Farmer / Survey data (permission-gated per above)
| Method & Path | Required permission |
|---|---|
| GET `/farmer-master/lookup` | authenticated |
| GET `/surveys` | `farmer_records` |
| GET `/surveys/{id}` | `farmer_records` |
| POST `/surveys` | `survey_entry` |
| PUT `/surveys/{id}` | `farmer_records` |
| DELETE `/surveys/{id}` | `admin` only |
| PUT `/surveys/{id}/assign` | `admin` only — body `{user_id}` (null clears) |
| POST `/surveys/assign` | `admin` only — body `{survey_ids, user_id}` bulk assign |
| GET `/surveys/{id}/plot-boundary` | `plots_map` |
| PUT `/surveys/{id}/plot-boundary` | `plots_map` |
| DELETE `/surveys/{id}/plot-boundary` | `plots_map` |
| GET `/plots` | `plots_map` |

### Dashboard (any authenticated user)
| Method & Path |
|---|
| GET `/dashboard/kpis` |
| GET `/dashboard/yield-benchmarks` |

### FPO Consultation module (`fpo_consultation` permission, `backend/app/fpo_consultation.py`)
A second large questionnaire (72 questions, 6 sections, ~180 fields) administered
by the same field team, gated by its own grantable permission independent of
`survey_entry`/`farmer_records`/`plots_map` — an admin can give a user FPO
Consultation access without also giving them the farmer survey, and vice versa.

**Draft-first, unlike the farmer survey**: every field on `FPOConsultationIn`
is optional. The frontend wizard (`frontend/src/pages/FPOConsultationWizard.tsx`)
`PUT`s to the server after every Next/Back/Save-Draft click with only the
fields touched so far — closing the app mid-form loses nothing beyond the
current step's unsaved keystrokes. `status` (`"draft"` → `"submitted"`) is
set by the client when the user finishes the last step; it is advisory
bookkeeping, not a validation gate — there is no "all fields required" check
anywhere in this module, by explicit design (the client's requirement was
resumable step-wise saving, not farmer-survey-style all-or-nothing validation).
Once `status="submitted"`, `PUT` is rejected (400) — a submitted consultation
is immutable.

Repeating tables in the source questionnaire (BDS providers, licences, credit
facilities, buyer terms, etc.) are stored as JSON text in single columns
(`bds_providers`, `licences`, `govt_schemes`, `credit_history`, ...) — same
pattern as `FarmerSurvey.mech_rental_rate_inr_hr` elsewhere in this codebase —
rather than child tables, since they're always read/written as a whole unit
per consultation, never queried across consultations by row.

| Method & Path | Notes |
|---|---|
| GET `/fpo-consultations` | list (optionally `?status=draft` or `?status=submitted`); lightweight `FPOConsultationListItem` shape, not all ~180 fields |
| GET `/fpo-consultations/{id}` | full record |
| POST `/fpo-consultations` | create a draft; accepts a partial payload (only the fields the first step collected) |
| PUT `/fpo-consultations/{id}` | partial update — only the fields present in the payload are touched, so a later step's save never wipes an earlier step's data; rejected (400) once `status="submitted"` |
| POST `/fpo-consultations/{id}/submit` | marks `status="submitted"`, sets `submitted_at` |
| DELETE `/fpo-consultations/{id}` | admin-only |

All five actions are audit-logged (`fpo_consultation_create`/`update`/`submit`/`delete`).

**Frontend routing**: `/entry` is now a landing page (`EntryLanding.tsx`)
choosing between "Farmer Survey" (`/entry/farmer`, the original wizard,
`survey_entry` permission) and "FPO Consultation" (`/entry/fpo?id=<id>`,
`fpo_consultation` permission) — `ProtectedRoute` gained a `requireAny`
prop (passes if the user has *any* of the listed modules) so the landing
page itself is reachable by a user who has either permission, while each
destination page still gates on its own specific one. `/fpo-consultations`
lists drafts (resumable) and submitted consultations.


## Record-level ownership (field users)

On top of module permissions, a **field** user only sees/edits survey records they own. Applies to list, export, get, update, draft save, plot-boundary get/put/delete and `/plots`. A record is owned if `created_by_user_id` = user, OR `assigned_to_user_id` = user (set by admin via the assign endpoints), OR it is a legacy row with no creator id whose `enumerator_name` equals the user's `full_name`. Others return 404 (not 403). Admin is unscoped. `/dashboard/kpis` and `/dashboard/yield-benchmarks` are scoped the same way for field users (admin sees global). Helper: `scoped_surveys(db, user)`. Implemented by `owned_by()` / `get_owned_survey()` in `backend/app/main.py`.

## List/export filters: date and user

`GET /surveys` and `GET /surveys/export` accept `date_from` / `date_to` (YYYY-MM-DD, inclusive, on `entry_timestamp`; any user) and `user_ids` (comma-separated user ids; **admin only**, 403 otherwise, 400 if malformed). `user_ids` returns records owned by ANY selected user under the same ownership rule as above (creator, assignee, legacy name match). UI: date pickers + admin user multi-select on the Farmer Records page (`FarmerList.tsx`, filters live in the URL).

## Audit trail fields (survey records)

Server-set, never accepted from the payload: `created_by_user_id`, `entry_timestamp` (created at), `device_id` (created from), `last_modified_by_user_id`, `last_modified_at`, `last_modified_device_id` (stamped on update, draft save, plot-boundary save/delete, assign). Device id comes from the `X-Device-Id` request header sent by the frontend (`frontend/src/lib/deviceId.ts`): native Android app = `android:<real device id>` (via @capacitor/device); browser = random per-browser UUID, stored by the server as `web:<uuid>|<client ip>` (IP from X-Forwarded-For first hop, else socket). `GET /surveys/{id}` also returns `created_by_name` / `last_modified_by_name`; shown on the record view page. `X-Device-Id` is in the CORS allow-list — **deploy the backend before any frontend/APK that sends it**, or cross-origin requests fail preflight. Offline-queued saves report the device/IP at sync time, not entry time.

## Data Verifier module, user mapping, freeze/unfreeze

- **Module `data_verifier`** — a permission checkbox in User Management (same mechanism as `survey_entry`, `farmer_records`...), granted to a `field` user. When granted, the admin must also map the user to ≥1 other field users (`mapped_user_ids` on `POST /users` / `PUT /users/{id}`, shown as a multi-select of users in the form; mapping is cleared when the module is removed). A verifier sees/edits/freezes records owned by their mapped users **plus their own** (confirmed by the user), via `owned_by()` — so list, export, view, edit, plots map and dashboard are all scoped that way. A mapped user's records = created by, assigned to, or legacy name-match for that user.
- **Freeze:** `PUT /surveys/{id}/freeze {frozen, note}` and `POST /surveys/freeze {survey_ids, frozen, note}` (bulk, max 500) — require `data_verifier` (admin always). Drafts cannot be frozen. Re-freezing an already frozen record is a no-op and is NOT logged; every real transition is. **Web only:** requests with `X-Device-Id: android:...` get 403; UI hides the controls in the native app.
- **Lock:** a frozen record is **read-only for everyone, admin included** — edits (update, draft save, plot-boundary save/delete) return **423** until it is unfrozen. Only freeze/unfreeze and admin assignment still work on a frozen record. Freezing changes no survey data. UI: Edit is shown red and disabled while frozen, green when not.
- **Audit:** every transition writes a `survey_freeze_log` row (survey_id, farmer_id, action, user, timestamp, device_id, note; survey_id is not an FK so history survives deletion) plus an `audit_log` entry (`survey_freeze`/`survey_unfreeze`). `GET /surveys/{id}/freeze-log` returns the history (shown on the record page). List/export accept `frozen=true|false`. Admin's `user_ids` filter matches a user's OWN records only (not their mapped ones).
- (An earlier same-day design used a separate `verifier` role mapped by village; it was replaced by this module + user mapping before any commit/deploy.)
