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
| GET `/surveys/{id}/plot-boundary` | `plots_map` |
| PUT `/surveys/{id}/plot-boundary` | `plots_map` |
| DELETE `/surveys/{id}/plot-boundary` | `plots_map` |
| GET `/plots` | `plots_map` |

### Dashboard (any authenticated user)
| Method & Path |
|---|
| GET `/dashboard/kpis` |
| GET `/dashboard/yield-benchmarks` |
