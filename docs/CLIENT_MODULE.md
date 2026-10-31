# Client User role, Client Survey Dashboard, View Farmer Records

Code: `backend/app/client.py` (all logic), `auth.py` (role gate), models `Client*` in `models.py`;
UI: `ClientDashboard.tsx`, `ClientFarmers.tsx` (client users), `ClientAdmin.tsx` (admin "Clients" screen).

## 1. Data model
Tables are created by `create_all`; `auth_user.client_id` by `sync_missing_columns`; indexes by `db.ensure_indexes()`.
```sql
CREATE TABLE client_org (id INTEGER PRIMARY KEY, name VARCHAR UNIQUE NOT NULL, is_active BOOLEAN NOT NULL, created_at DATETIME);
CREATE TABLE client_scope (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES client_org(id), scope_type VARCHAR NOT NULL /* district|taluka|survey_year */, value VARCHAR NOT NULL);
CREATE TABLE client_module (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES client_org(id), module_code VARCHAR NOT NULL);      -- group-level grant
CREATE TABLE client_user_module (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES auth_user(id), module_code VARCHAR NOT NULL, granted BOOLEAN NOT NULL); -- per-user override (true adds, false removes)
CREATE TABLE client_access_log (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, client_id INTEGER, action VARCHAR NOT NULL /* view_record|list|dashboard|export|denied */, farmer_id VARCHAR, detail VARCHAR, ip_address VARCHAR, at DATETIME);
ALTER TABLE auth_user ADD COLUMN client_id INTEGER REFERENCES client_org(id);   -- role = 'client'
CREATE INDEX ix_farmer_survey_scope ON farmer_survey (status, district, taluka, survey_year);  -- + district, taluka, village, society_name
```
**Module registry** = `CLIENT_MODULES` in `client.py` (`register_client_module(code,label,description,route)`). The admin screen reads
`GET /api/client/admin/modules`, so a registered module shows up in the assignment list with no user-management change.
Registered: `client_dashboard`, `client_farmer_records`, `client_export`.

## 2. KPI definitions (submitted surveys in scope only; drafts never counted)
| # | KPI | Formula | Source fields | Null handling |
|---|---|---|---|---|
| 1 | Farmers Surveyed | count(rows) | – | – |
| 2 | Society / FPC Linked | count(society_assoc='Yes'); % = that / answered | society_assoc | blank answers = "Not captured", excluded from % |
| 3 | Avg Yield / Acre | sum(yield_raw_qtl) / sum(areca_area_acres) over rows having both (area>0) | yield_raw_qtl, areca_area_acres | other rows "Not captured"; same basis as the Programme Dashboard |
| 4 | Credit Linked | count(credit_linkage='Yes'); % of answered | credit_linkage | as #2 |
| 5 | Marketing Channel Share | farmers per channel; % of farmers with a channel | marketing_channel | blank = Not captured |
| 6 | Raw vs Processed | farmers per sale type (Raw / Processed / Both) | sale_type | blank = Not captured |
| 7 | Credit Source Mix | credit-linked farmers per source | credit_linkage='Yes', credit_source | blank = Not captured |
| 8 | Top Challenges | farmers reporting each challenge (multi-select, so shares exceed 100%), top N (default 10) | cultivation_challenges | farmers with none = Not captured |
| 9 | Avg Land Holding | mean(land_own + coalesce(land_leased,0)) | land_own_acres, land_leased_acres | own-land blank = excluded |
|10 | Avg Tree Count | mean(areca_plant_count) | areca_plant_count | blank excluded |

Added for the redesigned layout: **Average Leased Land** (mean land_leased_acres) and **Average Areca Area** (mean areca_area_acres), both drillable. Land holding (#9) = own land only.

## 3. API (all under `/api/client`, JWT, role `client`; reads only)
| Endpoint | Module | Notes |
|---|---|---|
| `GET /me` | any client | client name, effective modules (drives the menu), scope |
| `GET /filters?district&taluka` | dashboard or records | filter options **within scope** |
| `GET /dashboard?district&taluka&village&society&crop&year_from&year_to&top` | client_dashboard | all 10 KPIs + definitions; 60 s cache invalidated on any survey write |
| `GET /dashboard/drill?kpi&by=district|taluka|village|society|state&category&<filters>` | client_dashboard | rows reconcile to `parent_total` (asserted server-side); `category` drills into one chart segment |
| `GET /farmers?page&limit(≤100)&sort&dir&columns&q&farmer_id&credit=Y|N&land_min&land_max&kpi&category&<filters>` | client_farmer_records | `{total,page,limit,columns,items}` + `X-Total-Count` |
| `GET /farmers/{farmer_id}` | client_farmer_records | grouped read-only profile; out-of-scope = **404** (no IDOR) |
| `GET /farmers/export`, `GET /dashboard/export` | client_export (+ the source module) | .xlsx, same masking |
| `/admin/*` (admin only) | – | `orgs` CRUD, `orgs/{id}/users`, `users/{id}/modules` overrides, `modules`, `scope-options`, `logs` |

Masked list/detail schema = `LIST_FIELDS` / `DETAIL_GROUPS` in `client.py`. **Never returned**: mobile number, created by/on/device,
last-modified by/on/device (plus aadhaar, guardian name, geo, photo, enumerator, internal user ids, frozen/assigned info).

## 4. Admin flow (inside User Management — there is no separate Clients tab)
User Management → **Client organisations** button: create/edit an organisation (name, active, modules from the registry, data scope: districts / taluks / survey years) and open its access log.
User Management → **New user** → Role **Client User** → pick the **Client organisation**, adjust **Modules for this user** (starts from the organisation's modules; the difference is stored as per-user overrides), data scope is shown read-only → Create.
Edit, disable, reset password work like any other user. The user list shows the organisation and modules for client users.
Backend: `POST/PUT /api/users` accept `client_id` + `client_module_codes` for role `client`; `/api/client/admin/*` still serves the organisation CRUD and logs.

## 5. Dashboard layout / drill flow
Filter bar → sections styled after the approved mock-ups: *Record status & coverage* (4 cards), *Land holding & areca plantation* (4 teal-accent cards), *Market & credit* (2 pies with right-hand legends, 2 ranked progress-bar lists), *Land Holding Distribution* (own vs leased donut + under-areca %). Info icons state definitions and "Not captured".
Click a card or chart segment → drill table by **District → Taluk → Village → farmer list** (also *By society / FPC*), breadcrumb + Back, totals row with a reconcile check,
Excel export, Print/PDF (browser print). Final level lists farmers (paged) linking to the profile if the client has View Farmer Records.

## 6. Enforcement (backend)
1. `auth.get_current_user`: role `client` may only reach `/api/client/*` and `/api/auth/*` — every other endpoint (present or future) answers 403. Also `owned_by()` returns "no rows" for clients.
2. `client_module(code)`: client role only, GET/HEAD only (writes 403), module must be in group grants ± user overrides, else 403 and a `denied` log row.
3. `scoped_query()`: the only data entry point — submitted rows + district/taluk/year scope; no client / inactive client = nothing.
4. `scrub()` strips banned keys from every response; list `columns`, `sort` and filters accept allowlisted names only (400 otherwise); text search covers name / farmer id only; default order is name then farmer id (never insertion order).
5. Audit: every dashboard view/drill, list, record view, export and denied attempt is logged (user, farmer id, time, IP).

## 7. Tests
`scratchpad` script run against the live API (93 checks, 0 failures, on two different scopes): module gate, write blocking, all non-client endpoints 403, scope counts vs SQL, drill reconciliation at every level for all 10 KPIs and chart slices, IDOR 404, banned keys absent from list/detail/export header, mobile value absent, search-by-mobile returns 0, rejection of banned sort/columns, per-user override, inactive client, export gating, audit rows.

## 8. Assumptions and open questions
* "Project / survey" scope = **survey year** (there is no project table); State is fixed (Karnataka). Block = taluk.
* Marketing channel / credit source values are shown **as captured** (APMC, Cooperative Society, Local Trader, FPC/FPO, Commission Agent, Any Other …) — they do not match the brief's mandi/trader/FPC/direct/other list. Map them?
* Yield uses raw quantity only, as the Programme Dashboard does; "Raw vs Processed share" is by farmers, not volume.
* "Crop / variety" filter = farmers who also grow that crop (crop2 / crop3); variety lives inside grading JSON and is not filterable yet.
* "Survey date range" = survey year (Created On is a banned field, so it cannot be used).
* Excel only for exports; PDF = browser print (no server PDF library installed). Say if a server-side PDF is required.
* Farmer ID is the lookup key (NCCF/KA/0067 form; slashes handled). If one farmer has several submitted surveys the latest year is shown.
* No aggregate/materialized tables yet: KPI queries are indexed SQL with a 60 s cache — fine for tens of thousands of rows; add summary tables if lakhs of rows make the Python-side "challenges" count slow.
* Guardian name, aadhaar, geo-coordinates and plot boundary are also withheld (not in the brief's list) — confirm.
* Existing public master-data lookups (`/api/masters/*`) remain open to any caller as before; they contain no farmer data.
