# Change notes — 31 Oct 2026 (problem → solution)

| # | Problem | Solution | Where |
|---|---|---|---|
| 1 | MIS login showed the page title twice (report viewer title + the embedded dashboard's own title). | Dashboard and Plots Map take an `embedded` prop that hides their own heading inside the MIS viewer; unchanged when opened directly. | `Dashboard.tsx`, `PlotsRegistry.tsx`, `MisViewer.tsx` |
| 2 | Changes seemed missing: work was spread over several local branches and the app kept switching code. | Merged everything into `shwetank-25-Oct-onwards`, pushed, opened PR #2 (merge into `main` left to the user). Clean dashboard fix lives inside it, so no force-push of `dashborad_update_30_Oct` was needed. | git |
| 3 | External clients need their own, restricted view of the data. | **Client User role** (`client`): organisations with modules + data scope, per-user module overrides, access log. Closed to every non-`/api/client` endpoint in `auth.get_current_user`; read-only; scope via `scoped_query()`; field masking by allowlist + `scrub()` (no mobile, created/modified by/on/device). Spec: `docs/CLIENT_MODULE.md`. | `backend/app/client.py`, models, auth |
| 4 | "Client Dashboard" name; land-holding average wrongly added leased land; farmer profile opened as a popup. | Renamed to **Dashboard**; Average Land Holding = **own land only**; profile is a **full page** with Back at top and bottom. | `ClientDashboard.tsx`, `ClientFarmerDetail.tsx`, `client.py` |
| 5 | Dashboard looked plain. | Redesigned to the approved mock-ups (sections, teal land cards, pies with legends, progress-bar lists, Land Holding Distribution); added Average Leased Land and Average Areca Area KPIs. | `ClientDashboard.tsx` |
| 6 | A separate "Clients" tab duplicated user management. | Merged into **User Management**: role *Client User* → organisation + modules; organisations managed from a "Client organisations" button. Tab and `/clients` route removed. | `UserManagement.tsx`, `ClientAdmin.tsx` (now a panel), `main.py` |
| 7 | Branding said NCCF; farmer ids showed `NCCF/KA/####`. | Visible text changed to **DSAreca**. Ids are **displayed** as `DSA/KA/<serial>`; stored ids are unchanged (lookups, links, numbering). Typing `DSA/KA/0007` works in client search and farmer lookup. | `lib/farmerSerial.ts`, `i18n.ts`, `Login.tsx`, `client.py`, `main.py` |
| 8 | Dashboard and admin functionality must not ship in the Android app until requested. | `lib/platform.ts`: `featureOn(feature)` is true on the web, and on the Capacitor app only for names listed in `MOBILE_ENABLED` (empty = none). Gates menu items, routes (`ProtectedRoute feature=`), the home page (`Home.tsx` redirects to New Entry / Farmers / Plots) and admin-only widgets in Farmer list / record view. MIS and Client users get a "use the web portal" notice in the app. Features: `dashboard`, `admin`, `mis`, `client` (freeze was already web-only). **To enable one on mobile: add its name to `MOBILE_ENABLED`, rebuild.** | `lib/platform.ts`, `Layout.tsx`, `ProtectedRoute.tsx`, `App.tsx`, `Home.tsx`, `FarmerList.tsx`, `SurveyView.tsx`, `platform.test.ts` |

## Notes
* Farmer ids contain slashes, so the client detail route is `{farmer_id:path}`.
* Role key is `client` (the schema limits role to 10 characters).
* Indexes on `farmer_survey` (district, taluka, village, society_name, scope) created at startup by `db.ensure_indexes()`.
* Still showing the stored NCCF id: admin/field Excel exports and the data-entry "Farmer Unique ID" field.
* Local demo client: `democlient` / `Client@12345`. Local admin password was reset to the user's chosen value.
* Verified: 51 unit tests, type check, 104-check API script, browser spot checks. Not yet committed: items 6–7 and the dashboard-line removal (branch `client_module_31_Oct` holds items 1–5).
