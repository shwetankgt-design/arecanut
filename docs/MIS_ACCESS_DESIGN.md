# MIS User role — Reports & Dashboards access (design and operations guide)

Status: implemented on branch `shwetank-25-Oct-onwards` (local, not deployed). Backend: `backend/app/mis.py`, `models.py`, `auth.py`, `main.py`. Frontend: `pages/Mis*.tsx`, `components/CatalogPicker.tsx`, `pages/UserManagement.tsx`.

## 1. What it does
A new role **MIS User** can open only the reports and dashboards an admin has assigned. It cannot see or reach data entry, farmer records, FPO, plots capture, master data, user management or any other API. New reports/dashboards register themselves in code and appear in the admin's picker with no change to user management.

## 2. Data model (ER)
```
auth_user (existing) ──< user_catalog_access >── catalog_item
   role  ('field' | 'admin' | 'mis_user')           id, code (unique), name, item_type (report|dashboard),
   mis_access_all (bool)  "all current + future"     category, description, route, component,
   data_scope_districts   optional district scope    status (active|inactive), display_order,
   permissions (field only)                          registered (false = removed from code), created_at, updated_at

user_catalog_access: id, user_id, item_id, assigned_by_user_id, assigned_at   UNIQUE(user_id, item_id)
catalog_assignment_log (append-only): timestamp, actor, target user, item_code, action (grant|revoke|all_on|all_off|scope), note
catalog_access_log     (append-only): timestamp, user, item_code, ip_address, device_id
```
Roles and modules themselves are code-defined (`auth.ROLE_DEFS`, `MODULE_DEFS`); the role `mis_user` has `uses_catalog: true`.

## 3. Registration (no manual DB entry)
* **Table report:** decorate a function in `mis.py` (or any module imported by `main.py`):
  `@report(code="rpt.my_report", name="My Report", category="Coverage", description="…")` returning `{"columns":[{key,label,type}], "rows":[…], "summary":{…}}`. It renders in the generic table viewer with search, sort, paging and CSV download — no frontend change.
* **Dashboard / special page:** `register_item(code=…, item_type="dashboard", component="<FrontendComponentKey>", …)`; add the key to `COMPONENTS` in `MisViewer.tsx` only if it is a new kind of visual.
* **Any other API serving a report:** protect it with `Depends(require_catalog_access("<code>"))`.
* At startup `sync_catalog()` inserts new codes (Active), refreshes code-owned fields (name, type, category, description, route, component), keeps admin-owned fields (status, display order), and retires codes removed from code (inactive, `registered=false`). Admin can also press **Sync from application** on the Catalog page.

## 4. Admin experience
* **User Management → role "MIS User"** shows **Reports & Dashboards Access**: toggle *Grant access to all current and future reports and dashboards*; otherwise a picker listing active items grouped by category, filter by type (Reports/Dashboards), category and search, select-all-shown, select-by-category, clear; **Copy access from another MIS user**; optional **Data scope** (districts).
* **Bulk assign reports** (Users page): choose many MIS users + items, mode Add / Remove / Replace.
* **Catalog page** (`/mis-catalog`): list, activate/deactivate, display order, assigned-user counts, Sync; **Access log** and **Assignment log** tabs (server-paged, filterable).
* Changes are stored as user↔item mappings and take effect on the user's next request (see caching).

## 5. MIS user experience
After login the user lands on `/mis`: cards grouped by category, only their active, assigned items (search/type filter appear once there are more than 6). Items open at `/mis/view/<code>`. Unassigned/deactivated items vanish from the menu and return 403 from the API. The only menu entry is "Reports & Dashboards"; every other URL redirects to `/mis`.

## 6. Enforcement (server-side)
* `authorize()` / `require_catalog_access(code)`: admin passes; `mis_user` needs the code in `allowed_codes()` (item Active **and** registered **and** (`mis_access_all` or assigned)); every other role gets 403 on MIS endpoints.
* `require_permission` / `require_any_permission` now refuse the `mis_user` role outright, so survey, FPO, plots-capture, master-data and user-management APIs are closed to it even if a stale permission string existed. Switching a user to MIS clears their module permissions and mappings.
* Existing shared endpoints: `/dashboard/kpis` and `/dashboard/yield-benchmarks` need item `dash.programme` for MIS users (unchanged for other roles); `/api/plots` needs `rpt.plots_map` for MIS users (module `plots_map` for others); `/farmer-master/lookup` rejects MIS users.
* **Data scope:** an MIS user's reports/dashboards/plots read through `owned_by()` → `district IN (scope)` when a scope is set, otherwise all districts.
* Unauthorized access → **403** (unknown report code → 404).

## 7. Audit
* `catalog_assignment_log`: who granted/revoked which item for whom and when, plus all-access toggles and scope changes (also on bulk, copy, and when a user stops being MIS).
* `catalog_access_log`: user, item, timestamp, IP, device id each time an MIS user loads an item (de-duplicated to one entry per user+item per 60 s so a page that makes several calls logs once).
* Catalog status/order edits and syncs also go to the main `audit_log`.

## 8. Performance and scale
* `allowed_codes(user)` is cached in-process for 30 s and invalidated immediately on any assignment change for that user and on any catalog status change. With several backend replicas, a change reaches other replicas within the 30 s TTL (replace with a shared cache/Redis if instant cross-replica propagation is required).
* Indexed: `catalog_item.code`, `user_catalog_access(user_id)`, `(item_id)`, unique pair; logs indexed by timestamp/user/item. Lists are server-paged; the picker is a scrolling list suitable for hundreds of items.

## 9. API summary (prefix `/api/mis`)
`GET my-menu` (MIS/admin) · `GET reports/{code}` · admin: `GET catalog`, `PATCH catalog/{id}`, `POST catalog/sync`, `GET|PUT users/{id}/access`, `POST access/bulk`, `POST users/{id}/copy-from/{src}`, `GET logs/access`, `GET logs/assignments`; `GET /api/users/access-options` lists roles/modules; user create/update accept `mis_access_all`, `catalog_item_ids`, `data_scope_districts`.

## 10. Verified
47 API checks (`scratchpad/mis_test.py`, not in the repo) all pass: catalog auto-registration, MIS user blocked on 16 other endpoints, grant/revoke/deactivate/all-access effect on the next request, district scope, bulk add/remove/copy, other roles unaffected, logs, role change clears access. UI checked in the browser as admin and as an MIS user.

## 11. Known limits / decisions
* One role per user. A report's data endpoints must use the decorators/dependencies above — an endpoint added without them is not covered by the catalog.
* Scope is by district only (the app has no state/department concept). Dashboard drill-down links to record lists are inert for MIS users.
* Rate limits: the API default is 120 requests/min per IP.
