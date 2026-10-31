import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, FileText, RefreshCw, Search, CheckCircle2, AlertCircle, ListChecks } from "lucide-react";
import { api } from "../api";
import type { CatalogItem } from "../lib/mis";
import { TYPE_LABEL } from "../lib/mis";
import Pagination from "../components/Pagination";
import { PAGE_SIZES, DEFAULT_PAGE_SIZE } from "../lib/paging";

type Tab = "catalog" | "access" | "assignments";

function CatalogTab({ onChanged }: { onChanged: (msg: string) => void }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    api.misCatalog().then(setItems).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const t = query.trim().toLowerCase();
    return items.filter((i) => (!type || i.item_type === type) && (!status || i.status === status) && (!t || `${i.name} ${i.code} ${i.category}`.toLowerCase().includes(t)));
  }, [items, query, type, status]);

  const patch = async (item: CatalogItem, data: { status?: string; display_order?: number }) => {
    setError("");
    try {
      await api.patchCatalogItem(item.id, data);
      load();
      onChanged(data.status ? `${item.name} is now ${data.status}.` : `Display order of ${item.name} updated.`);
    } catch (e: any) { setError(e.message); }
  };
  const sync = async () => {
    setSyncing(true); setError("");
    try {
      const r = await api.syncCatalog();
      load();
      onChanged(`Catalog synced from the application: ${r.added} added, ${r.updated} updated, ${r.retired} retired.`);
    } catch (e: any) { setError(e.message); } finally { setSyncing(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
          <input className="gt-input !pl-9" placeholder="Search name, code or category" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="gt-input !w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="">All types</option><option value="report">Reports</option><option value="dashboard">Dashboards</option></select>
        <select className="gt-input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <button type="button" className="gt-btn-secondary ml-auto flex items-center gap-1.5" onClick={sync} disabled={syncing}><RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> Sync from application</button>
      </div>
      <p className="text-xs text-[var(--gt-text-muted)]">Reports and dashboards register themselves in the application code and appear here automatically at startup — nothing is entered by hand. You can activate/deactivate an item and change its display order; deactivating hides it from every MIS user immediately.</p>
      <div className="gt-card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--gt-text-muted)] bg-[#FAF8FC] border-b border-[var(--gt-border)]">
              <th className="px-4 py-2.5 font-semibold">Name</th><th className="px-4 py-2.5 font-semibold">Type</th><th className="px-4 py-2.5 font-semibold">Category</th>
              <th className="px-4 py-2.5 font-semibold">Order</th><th className="px-4 py-2.5 font-semibold">Assigned</th><th className="px-4 py-2.5 font-semibold hidden lg:table-cell">Added</th><th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} className={`border-b border-[var(--gt-border)] last:border-0 ${i.status === "inactive" ? "opacity-60" : ""}`}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${i.item_type === "dashboard" ? "bg-[#F1EBF7] text-[var(--gt-purple)]" : "bg-sky-50 text-sky-600"}`}>{i.item_type === "dashboard" ? <BarChart3 size={16} /> : <FileText size={16} />}</span>
                    <div className="min-w-0">
                      <div className="font-medium">{i.name}{!i.registered && <span className="ml-2 text-[10px] bg-red-50 text-red-700 border border-red-200 rounded px-1.5 py-0.5">removed from app</span>}</div>
                      <div className="text-xs text-[var(--gt-text-muted)]"><code>{i.code}</code></div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5">{TYPE_LABEL[i.item_type]}</td>
                <td className="px-4 py-2.5">{i.category}</td>
                <td className="px-4 py-2.5"><input type="number" min={0} className="gt-input !w-20 !py-1 text-xs" defaultValue={i.display_order} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== i.display_order) patch(i, { display_order: v }); }} aria-label={`Display order of ${i.name}`} /></td>
                <td className="px-4 py-2.5 text-xs text-[var(--gt-text-muted)]">{i.assigned_users ?? 0} user(s)</td>
                <td className="px-4 py-2.5 text-xs text-[var(--gt-text-muted)] hidden lg:table-cell whitespace-nowrap">{i.created_at ? new Date(i.created_at + "Z").toLocaleDateString(undefined, { dateStyle: "medium" }) : "—"}</td>
                <td className="px-4 py-2.5">
                  <button type="button" disabled={!i.registered && i.status === "inactive"} onClick={() => patch(i, { status: i.status === "active" ? "inactive" : "active" })}
                    className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${i.status === "active" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"} disabled:opacity-40`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${i.status === "active" ? "bg-green-600" : "bg-gray-400"}`} /> {i.status === "active" ? "Active" : "Inactive"}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--gt-text-muted)]">No catalog items match.</td></tr>}
            {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--gt-text-muted)]">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-[var(--gt-text-muted)]">{shown.length} of {items.length} item(s)</div>
    </div>
  );
}

function LogTab({ kind }: { kind: "access" | "assignments" }) {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [userId, setUserId] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    api.listUsers().then((u: any[]) => setUsers(u.filter((x) => x.role === "mis_user"))).catch(() => {});
    api.misCatalog().then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    const params: Record<string, string> = { limit: String(pageSize), offset: String((page - 1) * pageSize) };
    if (itemCode) params.item_code = itemCode;
    if (kind === "access") { if (userId) params.user_id = userId; if (from) params.date_from = from; if (to) params.date_to = to; }
    else if (userId) params.target_user_id = userId;
    (kind === "access" ? api.misAccessLogPaged(params) : api.misAssignmentLogPaged(params))
      .then(({ items: r, total: t }) => { setRows(r); setTotal(t); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [kind, page, pageSize, userId, itemCode, from, to]);

  const reset = () => setPage(1);
  const fmt = (t: string) => new Date(t + "Z").toLocaleString();
  const actionLabel: Record<string, string> = { grant: "Granted", revoke: "Revoked", all_on: "All access ON", all_off: "All access OFF", scope: "Data scope" };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <select className="gt-input !w-auto" value={userId} onChange={(e) => { setUserId(e.target.value); reset(); }} aria-label="User"><option value="">All MIS users</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name} (@{u.username})</option>)}</select>
        <select className="gt-input !w-auto" value={itemCode} onChange={(e) => { setItemCode(e.target.value); reset(); }} aria-label="Report or dashboard"><option value="">All reports/dashboards</option>{items.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}</select>
        {kind === "access" && (
          <>
            <label className="text-xs text-[var(--gt-text-muted)] flex flex-col gap-0.5">From<input type="date" className="gt-input !py-1" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} /></label>
            <label className="text-xs text-[var(--gt-text-muted)] flex flex-col gap-0.5">To<input type="date" className="gt-input !py-1" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} /></label>
          </>
        )}
      </div>
      {error && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>}
      <div className="gt-card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--gt-text-muted)] bg-[#FAF8FC] border-b border-[var(--gt-border)]">
              <th className="px-4 py-2.5 font-semibold">When</th>
              {kind === "access" ? <><th className="px-4 py-2.5 font-semibold">User</th><th className="px-4 py-2.5 font-semibold">Opened</th><th className="px-4 py-2.5 font-semibold hidden md:table-cell">IP address</th></>
                : <><th className="px-4 py-2.5 font-semibold">Action</th><th className="px-4 py-2.5 font-semibold">By</th><th className="px-4 py-2.5 font-semibold">For user</th><th className="px-4 py-2.5 font-semibold">Item / detail</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--gt-border)] last:border-0">
                <td className="px-4 py-2 text-xs whitespace-nowrap">{fmt(r.timestamp)}</td>
                {kind === "access" ? (
                  <><td className="px-4 py-2">@{r.username}</td><td className="px-4 py-2"><code className="text-xs">{r.item_code}</code></td><td className="px-4 py-2 text-xs text-[var(--gt-text-muted)] hidden md:table-cell">{r.ip_address || "—"}</td></>
                ) : (
                  <>
                    <td className="px-4 py-2"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.action === "grant" || r.action === "all_on" ? "bg-green-50 text-green-700" : r.action === "revoke" || r.action === "all_off" ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"}`}>{actionLabel[r.action] || r.action}</span></td>
                    <td className="px-4 py-2">@{r.actor}</td><td className="px-4 py-2">@{r.target}</td>
                    <td className="px-4 py-2 text-xs">{r.item_code ? <code>{r.item_code}</code> : r.note || "—"}</td>
                  </>
                )}
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-[var(--gt-text-muted)]">No log entries.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE} total={total} loading={loading} noun="entries" onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      {total <= PAGE_SIZES[0] && <div className="text-xs text-[var(--gt-text-muted)]">{total} entr{total === 1 ? "y" : "ies"}</div>}
    </div>
  );
}

export default function MisCatalog() {
  const [tab, setTab] = useState<Tab>("catalog");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(t); }, [notice]);
  const tabBtn = (k: Tab, label: string) => (
    <button key={k} type="button" onClick={() => setTab(k)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? "border-[var(--gt-purple)] text-[var(--gt-purple-dark)]" : "border-transparent text-[var(--gt-text-muted)] hover:text-[var(--gt-text)]"}`}>{label}</button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)] flex items-center gap-2"><ListChecks size={20} /> Reports &amp; Dashboards Catalog</h1>
        <p className="text-sm text-[var(--gt-text-muted)]">The master list behind MIS access. Assign items to users from User Management.</p>
      </div>
      {notice && <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-3 py-2.5"><CheckCircle2 size={16} /> {notice}</div>}
      <div className="flex border-b border-[var(--gt-border)]">{tabBtn("catalog", "Catalog")}{tabBtn("access", "Access log")}{tabBtn("assignments", "Assignment log")}</div>
      {tab === "catalog" && <CatalogTab onChanged={setNotice} />}
      {tab === "access" && <LogTab kind="access" />}
      {tab === "assignments" && <LogTab kind="assignments" />}
    </div>
  );
}
