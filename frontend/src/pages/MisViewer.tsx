import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Search, AlertCircle, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { api } from "../api";
import type { CatalogItem } from "../lib/mis";
import Pagination from "../components/Pagination";
import { paginate, DEFAULT_PAGE_SIZE } from "../lib/paging";
import Dashboard from "./Dashboard";
import PlotsRegistry from "./PlotsRegistry";

interface Column { key: string; label: string; type: "text" | "number" }
interface ReportData { title: string; columns: Column[]; rows: Record<string, any>[]; summary?: Record<string, any>; generated_at?: string; scope_districts?: string[] }

// Generic table viewer: any report registered on the backend with @report(...) renders here with no frontend change.
function GenericReport({ code }: { code: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    api.misReport(code).then(setData).catch((e) => setError(e.message));
  }, [code]); // the viewer remounts per report (see key below), so state never carries over between reports

  const rows = useMemo(() => {
    if (!data) return [];
    const t = query.trim().toLowerCase();
    let r = t ? data.rows.filter((row) => data.columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(t))) : data.rows;
    if (sort) {
      const col = data.columns.find((c) => c.key === sort.key);
      r = [...r].sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        const cmp = col?.type === "number" ? (Number(x) || 0) - (Number(y) || 0) : String(x ?? "").localeCompare(String(y ?? ""));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return r;
  }, [data, query, sort]);

  const downloadCsv = () => {
    if (!data) return;
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [data.columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => data.columns.map((c) => esc(r[c.key])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${code}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error) return <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>;
  if (!data) return <div className="text-center py-16 text-[var(--gt-text-muted)]">Loading report…</div>;
  const safePage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));

  return (
    <div className="flex flex-col gap-3">
      {data.summary && (
        <div className="flex flex-wrap gap-3">
          {Object.entries(data.summary).map(([k, v]) => (
            <div key={k} className="gt-card px-4 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-[var(--gt-text-muted)]">{k.replace(/_/g, " ")}</div>
              <div className="text-lg font-bold text-[var(--gt-purple-dark)]">{typeof v === "number" ? v.toLocaleString("en-IN") : String(v)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
          <input className="gt-input !pl-9" placeholder="Filter rows" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
        </div>
        <span className="text-xs text-[var(--gt-text-muted)]">{rows.length.toLocaleString("en-IN")} row(s){data.generated_at ? ` · generated ${new Date(data.generated_at + "Z").toLocaleString()}` : ""}</span>
        <button type="button" className="gt-btn-secondary ml-auto flex items-center gap-1.5" onClick={downloadCsv}><Download size={15} /> Download CSV</button>
      </div>
      <div className="gt-card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--gt-text-muted)] border-b border-[var(--gt-border)] bg-[#FAF8FC]">
              {data.columns.map((c) => (
                <th key={c.key} className={`px-4 py-2.5 font-medium cursor-pointer select-none ${c.type === "number" ? "text-right" : ""}`}
                  onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "asc" }))}>
                  <span className="inline-flex items-center gap-1">{c.label}{sort?.key === c.key ? (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-30" />}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginate(rows, safePage, pageSize).map((r, i) => (
              <tr key={i} className="border-b border-[var(--gt-border)] last:border-0 hover:bg-[#FBF9FD]">
                {data.columns.map((c) => <td key={c.key} className={`px-4 py-2 ${c.type === "number" ? "text-right tabular-nums" : ""}`}>{c.type === "number" && typeof r[c.key] === "number" ? r[c.key].toLocaleString("en-IN") : (r[c.key] ?? "—")}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={data.columns.length} className="px-4 py-8 text-center text-[var(--gt-text-muted)]">No data.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={safePage} pageSize={pageSize} total={rows.length} noun="rows" onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
    </div>
  );
}

// Frontend component registry: the backend catalog item's `component` key picks what renders. Only a NEW kind
// of visual needs an entry here; any report that returns {columns, rows} uses GenericReport automatically.
const COMPONENTS: Record<string, ComponentType<{ code: string }>> = {
  GenericReport,
  ProgrammeDashboard: () => <Dashboard />,
  PlotsMap: () => <PlotsRegistry />,
};

export default function MisViewer() {
  const { code = "" } = useParams();
  const [state, setState] = useState<{ code: string; item: CatalogItem | null; error: string } | null>(null);

  useEffect(() => {
    api.misMenu()
      .then((m) => setState({ code, item: (m.items as CatalogItem[]).find((i) => i.code === code) || null, error: "" }))
      .catch((e) => setState({ code, item: null, error: e.message }));
  }, [code]);

  const item = state && state.code === code ? state.item : undefined;
  const error = state && state.code === code ? state.error : "";
  if (item === undefined) return <div className="text-center py-16 text-[var(--gt-text-muted)]">Loading…</div>;
  const Comp = item ? COMPONENTS[item.component] : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/mis" className="inline-flex items-center gap-1 text-xs text-[var(--gt-purple)] hover:underline"><ArrowLeft size={13} /> Reports &amp; Dashboards</Link>
        {item && (
          <>
            <h1 className="text-xl font-bold text-[var(--gt-purple-dark)] mt-1">{item.name}</h1>
            <p className="text-xs text-[var(--gt-text-muted)]">{item.category}{item.description ? ` · ${item.description}` : ""}</p>
          </>
        )}
      </div>
      {!item && (
        <div className="gt-card p-8 text-center">
          <AlertCircle size={28} className="mx-auto text-amber-500" />
          <div className="font-semibold mt-2">{error ? "Could not load this item" : "This report or dashboard isn't available to you"}</div>
          <p className="text-sm text-[var(--gt-text-muted)] mt-1">{error || "It may not be assigned to you, or it may have been deactivated."}</p>
        </div>
      )}
      {item && !Comp && <div className="gt-card p-6 text-sm text-[var(--gt-text-muted)]">This item needs a newer version of the application (component “{item.component}”).</div>}
      {item && Comp && <Comp key={item.code} code={item.code} />}
    </div>
  );
}
