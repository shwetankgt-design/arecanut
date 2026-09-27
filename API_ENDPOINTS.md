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

### Master data (read: any authenticated user; the FRS-required admin CRUD screen is not yet built — see PROJECT_STATE.md)
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
