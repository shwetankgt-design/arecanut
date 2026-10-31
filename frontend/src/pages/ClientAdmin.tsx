import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Plus, ScrollText, X } from "lucide-react";
import { api } from "../api";
import MultiSelect from "../components/MultiSelect";
import Pagination from "../components/Pagination";

interface ModuleDef { code: string; label: string; description: string }
interface Org { id: number; name: string; is_active: boolean; modules: string[]; scope: { district: string[]; taluka: string[]; survey_year: string[] }; user_count: number | null }
interface ScopeOpts { districts: string[]; talukas: string[]; survey_years: number[] }
interface LogRow { id: number; at: string; user: string | number; action: string; farmer_id: string | null; detail: string | null; ip: string | null }

const card = "gt-card p-4";
const label = "block text-xs font-semibold text-[var(--gt-text-muted)] mb-1";

// Client organisations (modules + data scope). Opened from User Management; client USERS are created there too.
export default function ClientOrgsPanel({ onChanged }: { onChanged?: () => void }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [scopeOpts, setScopeOpts] = useState<ScopeOpts>({ districts: [], talukas: [], survey_years: [] });
  const [editing, setEditing] = useState<Org | "new" | null>(null);
  const [logsOf, setLogsOf] = useState<Org | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(() => { api.clientAdminOrgs().then(setOrgs).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    reload();
    api.clientAdminModules().then(setModules).catch((e) => setError(e.message));
    api.clientAdminScopeOptions().then(setScopeOpts).catch(() => {});
  }, [reload]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);
  const modLabel = (code: string) => modules.find((m) => m.code === code)?.label || code;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-[var(--gt-text-muted)]">Each client organisation has its own modules and data scope. Add its users from <b>New user → Client User</b>.</p>
        <button type="button" onClick={() => setEditing("new")} className="gt-gradient text-white text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-1.5"><Plus size={16} /> New client</button>
      </div>
      {notice && <div className="flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2"><CheckCircle2 size={15} /> {notice}</div>}
      {error && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>}

      <div className="grid gap-3">
        {orgs.map((o) => (
          <div key={o.id} className={card}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{o.name}</div>
                <div className="text-xs text-[var(--gt-text-muted)]">{o.user_count ?? 0} user(s) · manage them in the user list</div>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${o.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>{o.is_active ? "Active" : "Inactive"}</span>
            </div>
            <div className="mt-2 text-xs"><b>Modules:</b> {o.modules.length ? o.modules.map(modLabel).join(", ") : <span className="text-amber-700">none assigned</span>}</div>
            <div className="mt-1 text-xs"><b>Scope:</b> {[
              o.scope.district.length ? `Districts: ${o.scope.district.join(", ")}` : "",
              o.scope.taluka.length ? `Taluks: ${o.scope.taluka.join(", ")}` : "",
              o.scope.survey_year.length ? `Survey years: ${o.scope.survey_year.join(", ")}` : "",
            ].filter(Boolean).join(" · ") || "All data (no restriction)"}</div>
            <div className="flex gap-2 mt-3 text-xs">
              <button type="button" className="px-3 py-1.5 rounded-lg border border-[var(--gt-border)] bg-white" onClick={() => setEditing(o)}>Edit modules &amp; scope</button>
              <button type="button" className="px-3 py-1.5 rounded-lg border border-[var(--gt-border)] bg-white inline-flex items-center gap-1" onClick={() => setLogsOf(o)}><ScrollText size={13} /> Access log</button>
            </div>
          </div>
        ))}
        {orgs.length === 0 && <div className="text-sm text-[var(--gt-text-muted)] md:col-span-2 text-center py-10">No clients yet. Create one, assign its modules and data scope, then add its users.</div>}
      </div>

      {editing && (
        <OrgDrawer org={editing === "new" ? null : editing} modules={modules} scopeOpts={scopeOpts} onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice(msg); reload(); onChanged?.(); }} />
      )}
      {logsOf && <LogsDrawer org={logsOf} onClose={() => setLogsOf(null)} />}
    </div>
  );
}

export function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return createPortal(
    <div className="fixed inset-0 flex justify-end bg-black/30" style={{ zIndex: 60 }} onClick={onClose}>
      <aside className={`bg-white w-full ${wide ? "max-w-3xl" : "max-w-lg"} h-full overflow-y-auto p-5 shadow-2xl`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 className="text-lg font-bold text-[var(--gt-purple-dark)]">{title}</h2>
          <button type="button" aria-label="Close" className="p-1.5 rounded-lg hover:bg-[#F6F4F9]" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </aside>
    </div>,
    document.body
  );
}

function OrgDrawer({ org, modules, scopeOpts, onClose, onSaved }: { org: Org | null; modules: ModuleDef[]; scopeOpts: ScopeOpts; onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(org?.name || "");
  const [active, setActive] = useState(org?.is_active ?? true);
  const [mods, setMods] = useState<string[]>(org?.modules || []);
  const [districts, setDistricts] = useState<string[]>(org?.scope.district || []);
  const [talukas, setTalukas] = useState<string[]>(org?.scope.taluka || []);
  const [years, setYears] = useState<string[]>(org?.scope.survey_year || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    if (name.trim().length < 2) { setErr("Enter the client name."); return; }
    setBusy(true);
    try {
      await api.clientAdminSaveOrg(org?.id ?? null, { name, is_active: active, modules: mods, districts, talukas, survey_years: years.map(Number) });
      onSaved(org ? "Client updated." : "Client created — now add its users.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Drawer title={org ? `Edit ${org.name}` : "New client"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div><label className={label} htmlFor="cn">Client / organisation name</label><input id="cn" className="gt-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (inactive clients cannot see any data)</label>
        <div>
          <span className={label}>Modules this client gets</span>
          <MultiSelect ariaLabel="Modules" placeholder="Select modules" value={mods} onChange={setMods}
            options={modules.map((m) => ({ value: m.code, label: m.label, description: m.description }))} />
          <p className="text-[11px] text-[var(--gt-text-muted)] mt-1">New modules registered in code appear here automatically. Unassigned modules are hidden and blocked (403).</p>
        </div>
        <fieldset className="border border-[var(--gt-border)] rounded-xl p-3 flex flex-col gap-3">
          <legend className="text-xs font-bold text-[var(--gt-purple)] px-1">Data scope (leave a list empty = no restriction on it)</legend>
          <div><span className={label}>Districts</span><MultiSelect ariaLabel="Districts" placeholder="All districts" value={districts} onChange={setDistricts} options={scopeOpts.districts.map((d) => ({ value: d, label: d }))} /></div>
          <div><span className={label}>Taluks / blocks</span><MultiSelect ariaLabel="Taluks" placeholder="All taluks" value={talukas} onChange={setTalukas} options={scopeOpts.talukas.map((d) => ({ value: d, label: d }))} /></div>
          <div><span className={label}>Survey years (project / survey round)</span><MultiSelect ariaLabel="Survey years" placeholder="All survey years" value={years} onChange={setYears} options={scopeOpts.survey_years.map((y) => ({ value: String(y), label: String(y) }))} /></div>
        </fieldset>
        {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="px-4 py-2 text-sm rounded-lg border border-[var(--gt-border)]" onClick={onClose}>Cancel</button>
          <button type="button" disabled={busy} className="gt-gradient text-white text-sm font-semibold px-5 py-2 rounded-lg disabled:opacity-60" onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Drawer>
  );
}

function LogsDrawer({ org, onClose }: { org: Org; onClose: () => void }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [action, setAction] = useState("");
  useEffect(() => {
    api.clientAdminLogs({ client_id: String(org.id), limit: String(size), offset: String((page - 1) * size), ...(action ? { action } : {}) })
      .then((r) => { setRows(r.items); setTotal(r.total); }).catch(() => {});
  }, [org.id, page, size, action]);
  return (
    <Drawer title={`${org.name} — access log`} onClose={onClose} wide>
      <select className="gt-input !w-auto !py-1.5 !text-xs mb-3" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action">
        <option value="">All actions</option>{["view_record", "list", "dashboard", "export", "denied"].map((a) => <option key={a}>{a}</option>)}
      </select>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]"><th className="py-2 pr-2">When</th><th className="pr-2">User</th><th className="pr-2">Action</th><th className="pr-2">Farmer</th><th>Detail</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-[var(--gt-border)] last:border-none align-top">
              <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(r.at + "Z").toLocaleString()}</td><td className="pr-2">{r.user}</td><td className="pr-2">{r.action}</td><td className="pr-2">{r.farmer_id || "—"}</td><td className="break-all">{r.detail || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="text-center text-sm text-[var(--gt-text-muted)] py-8">No access recorded yet.</div>}
      <Pagination page={page} pageSize={size} total={total} onPage={setPage} onPageSize={(s) => { setSize(s); setPage(1); }} noun="events" />
    </Drawer>
  );
}
