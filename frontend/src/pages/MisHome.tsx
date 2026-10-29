import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, FileText, Search, ArrowRight, AlertCircle, Filter } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { CatalogItem } from "../lib/mis";
import { TYPE_LABEL } from "../lib/mis";

// Landing page for MIS users: exactly the reports and dashboards assigned to them (the server decides — an
// item that is unassigned or deactivated simply stops appearing here).
export default function MisHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [scope, setScope] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "report" | "dashboard">("all");

  useEffect(() => {
    api.misMenu()
      .then((m) => { setItems(m.items); setScope(m.scope_districts || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => {
    const t = query.trim().toLowerCase();
    return items.filter((i) => (type === "all" || i.item_type === type) && (!t || `${i.name} ${i.description || ""} ${i.category}`.toLowerCase().includes(t)));
  }, [items, query, type]);
  const groups = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    for (const i of shown) { if (!m.has(i.category)) m.set(i.category, []); m.get(i.category)!.push(i); }
    return [...m.entries()];
  }, [shown]);
  const chip = (on: boolean) => `text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${on ? "gt-gradient text-white border-transparent shadow-sm" : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)] flex items-center gap-2"><BarChart3 size={20} /> Reports &amp; Dashboards</h1>
        <p className="text-sm text-[var(--gt-text-muted)]">Welcome{user ? `, ${user.full_name}` : ""}. These are the reports and dashboards available to you.</p>
        {scope.length > 0 && (
          <p className="inline-flex items-center gap-1.5 text-xs mt-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2.5 py-1"><Filter size={12} /> Data shown is limited to: {scope.join(", ")}</p>
        )}
      </div>

      {error && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>}

      {items.length > 6 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
            <input className="gt-input !pl-9" placeholder="Search reports and dashboards" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {([["all", "All"], ["report", "Reports"], ["dashboard", "Dashboards"]] as const).map(([k, l]) => (
            <button key={k} type="button" className={chip(type === k)} onClick={() => setType(k)}>{l}</button>
          ))}
        </div>
      )}

      {loading && <div className="text-center py-16 text-[var(--gt-text-muted)]">Loading…</div>}

      {!loading && !error && items.length === 0 && (
        <div className="gt-card p-8 text-center">
          <BarChart3 size={32} className="mx-auto text-[var(--gt-purple-light)]" />
          <div className="font-semibold mt-2">No reports or dashboards assigned yet</div>
          <p className="text-sm text-[var(--gt-text-muted)] mt-1">Ask your administrator to give you access. New items appear here as soon as they are assigned.</p>
        </div>
      )}

      {groups.map(([cat, list]) => (
        <section key={cat}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--gt-text-muted)] mb-2">{cat}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((i) => (
              <button key={i.id} type="button" onClick={() => navigate(i.route || `/mis/view/${i.code}`)}
                className="gt-card p-4 text-left flex flex-col gap-2 border border-transparent hover:border-[var(--gt-purple)] transition-colors group">
                <div className="flex items-center gap-2">
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${i.item_type === "dashboard" ? "bg-[#F1EBF7] text-[var(--gt-purple)]" : "bg-sky-50 text-sky-600"}`}>
                    {i.item_type === "dashboard" ? <BarChart3 size={18} /> : <FileText size={18} />}
                  </span>
                  <span className={`ml-auto text-[10px] font-semibold rounded px-1.5 py-0.5 ${i.item_type === "dashboard" ? "bg-[#F1EBF7] text-[var(--gt-purple-dark)]" : "bg-sky-50 text-sky-700"}`}>{TYPE_LABEL[i.item_type]}</span>
                </div>
                <div className="font-semibold text-sm">{i.name}</div>
                {i.description && <p className="text-xs text-[var(--gt-text-muted)] flex-1">{i.description}</p>}
                <span className="text-xs font-medium text-[var(--gt-purple)] flex items-center gap-1 group-hover:gap-2 transition-all">Open <ArrowRight size={13} /></span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {!loading && items.length > 0 && shown.length === 0 && <div className="text-center text-sm text-[var(--gt-text-muted)] py-8">Nothing matches your search.</div>}
    </div>
  );
}
