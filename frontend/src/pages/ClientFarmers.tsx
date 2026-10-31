import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowDown, ArrowUp, Columns3, Download, FilterX, Search } from "lucide-react";
import { api } from "../api";
import Pagination from "../components/Pagination";

type Row = Record<string, string | number | null>;
interface Col { key: string; label: string }
interface ListRes { total: number; columns: Col[]; items: Row[] }

// Everything a client may see. Mobile number, created / modified by / on / device are never sent by the server.
const ALL_COLUMNS: Col[] = [
  { key: "farmer_id", label: "Farmer ID" }, { key: "farmer_name", label: "Farmer name" }, { key: "gender", label: "Gender" }, { key: "age", label: "Age" },
  { key: "village", label: "Village" }, { key: "taluka", label: "Taluk" }, { key: "district", label: "District" },
  { key: "society_assoc", label: "Society / FPC linked" }, { key: "society_name", label: "Society / FPC" }, { key: "credit_linkage", label: "Credit linked" },
  { key: "credit_source", label: "Credit source" }, { key: "land_holding_acres", label: "Land holding (own, ac)" }, { key: "areca_area_acres", label: "Areca area (ac)" },
  { key: "areca_plant_count", label: "Tree count" }, { key: "marketing_channel", label: "Marketing channel" }, { key: "sale_type", label: "Sale type" }, { key: "survey_year", label: "Survey year" },
];
const DEFAULT_COLS = ["farmer_id", "farmer_name", "village", "taluka", "district", "society_name", "credit_linkage", "land_holding_acres", "areca_plant_count"];
const SORTABLE = new Set(["farmer_id", "farmer_name", "village", "taluka", "district", "society_name", "land_holding_acres", "areca_area_acres", "areca_plant_count", "survey_year"]);
const NC = "Not captured";
const show = (v: string | number | null | undefined, key = "") => (v === null || v === undefined || v === "" ? NC : typeof v === "number" && !/year/.test(key) ? v.toLocaleString("en-IN") : String(v));

interface Q { q: string; village: string; taluka: string; district: string; society: string; credit: string; land_min: string; land_max: string; crop: string; year_from: string; year_to: string }
const EMPTY: Q = { q: "", village: "", taluka: "", district: "", society: "", credit: "", land_min: "", land_max: "", crop: "", year_from: "", year_to: "" };

export default function ClientFarmers() {
  const navigate = useNavigate();
  const openFarmer = (id: string) => navigate(`/client/farmer?id=${encodeURIComponent(id)}`);
  const [form, setForm] = useState<Q>(EMPTY);
  const [applied, setApplied] = useState<Q>(EMPTY);
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);
  const [colMenu, setColMenu] = useState(false);
  const [sort, setSort] = useState("farmer_name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [res, setRes] = useState<ListRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opts, setOpts] = useState<{ districts: string[]; talukas: string[]; villages: string[]; societies: string[]; crops: string[]; years: number[] }>({ districts: [], talukas: [], villages: [], societies: [], crops: [], years: [] });
  const [canExport, setCanExport] = useState(false);

  useEffect(() => { api.clientMe().then((me) => setCanExport(me.modules.some((m: { code: string }) => m.code === "client_export"))).catch(() => {}); }, []);
  useEffect(() => {
    api.clientFilters({ ...(form.district ? { district: form.district } : {}), ...(form.taluka ? { taluka: form.taluka } : {}) }).then(setOpts).catch(() => {});
  }, [form.district, form.taluka]);

  const query = useCallback((extra: Record<string, string> = {}) => {
    const p: Record<string, string> = { sort, dir, ...extra };
    for (const [k, v] of Object.entries(applied)) if (v) p[k] = v;
    return p;
  }, [applied, sort, dir]);

  useEffect(() => {
    let live = true;
    api.clientFarmers(query({ page: String(page), limit: String(size), columns: cols.join(",") }))
      .then((r) => { if (live) { setRes(r); setError(""); } })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));

    return () => { live = false; };
  }, [query, page, size, cols]);

  const search = (e: React.FormEvent) => { e.preventDefault(); setLoading(true); setApplied(form); setPage(1); };
  const clearAll = () => { setForm(EMPTY); setApplied(EMPTY); setPage(1); };
  const hasFilters = Object.values(applied).some(Boolean);
  const toggleSort = (key: string) => {
    if (!SORTABLE.has(key)) return;
    if (sort === key) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(key); setDir("asc"); }
    setPage(1);
  };
  const toggleCol = (key: string) => setCols((c) => (c.includes(key) ? (c.length > 1 ? c.filter((x) => x !== key) : c) : ALL_COLUMNS.map((x) => x.key).filter((k) => c.includes(k) || k === key)));
  const inp = "gt-input !py-1.5 !text-xs";
  const set = (k: keyof Q) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === "district" ? { taluka: "", village: "", society: "" } : k === "taluka" ? { village: "", society: "" } : {}) }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">Farmer Records</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">Read-only view of submitted surveys within your project scope.</p>
        </div>
        <div className="flex gap-2 relative">
          <button type="button" className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--gt-border)] bg-white" onClick={() => setColMenu((o) => !o)} aria-expanded={colMenu}><Columns3 size={14} /> Columns</button>
          {colMenu && (
            <div className="absolute right-0 top-9 z-20 bg-white border border-[var(--gt-border)] rounded-xl shadow-lg p-2 w-56 max-h-72 overflow-auto" role="menu">
              {ALL_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-[#F6F4F9] cursor-pointer">
                  <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                </label>
              ))}
            </div>
          )}
          {canExport && (
            <button type="button" className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--gt-border)] bg-white" onClick={() => api.clientDownload("farmers/export", query({ columns: cols.join(",") }), "farmers.xlsx").catch((e) => setError(e.message))}><Download size={14} /> Excel</button>
          )}
        </div>
      </div>

      <form onSubmit={search} className="gt-card p-3 grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
        <div className="col-span-2 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
          <input className={`${inp} !pl-9`} aria-label="Search by farmer name or ID" placeholder="Farmer name or farmer ID" value={form.q} onChange={set("q")} maxLength={100} />
        </div>
        <select className={inp} aria-label="District" value={form.district} onChange={set("district")}><option value="">All districts</option>{opts.districts.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={inp} aria-label="Block / Taluk" value={form.taluka} onChange={set("taluka")}><option value="">All taluks</option>{opts.talukas.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={inp} aria-label="Village" value={form.village} onChange={set("village")}><option value="">All villages</option>{opts.villages.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={inp} aria-label="Society / FPC" value={form.society} onChange={set("society")}><option value="">All societies / FPCs</option>{opts.societies.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={inp} aria-label="Credit linked" value={form.credit} onChange={set("credit")}><option value="">Credit: any</option><option value="Y">Credit linked: Yes</option><option value="N">Credit linked: No</option></select>
        <select className={inp} aria-label="Crop" value={form.crop} onChange={set("crop")} title="Farmers who also grow this crop"><option value="">All crops</option>{opts.crops.map((d) => <option key={d}>{d}</option>)}</select>
        <input className={inp} type="number" min="0" step="any" placeholder="Land min (ac)" aria-label="Land holding minimum" value={form.land_min} onChange={set("land_min")} />
        <input className={inp} type="number" min="0" step="any" placeholder="Land max (ac)" aria-label="Land holding maximum" value={form.land_max} onChange={set("land_max")} />
        <select className={inp} aria-label="Survey year from" value={form.year_from} onChange={set("year_from")}><option value="">Year from</option>{opts.years.map((y) => <option key={y}>{y}</option>)}</select>
        <select className={inp} aria-label="Survey year to" value={form.year_to} onChange={set("year_to")}><option value="">Year to</option>{opts.years.map((y) => <option key={y}>{y}</option>)}</select>
        <div className="col-span-2 md:col-span-4 flex gap-2 justify-end">
          {(hasFilters || Object.values(form).some(Boolean)) && <button type="button" onClick={clearAll} className="text-xs text-[var(--gt-purple)] inline-flex items-center gap-1 hover:underline"><FilterX size={13} /> Clear all</button>}
          <button type="submit" className="gt-gradient text-white text-xs font-semibold px-4 py-1.5 rounded-lg">Search</button>
        </div>
      </form>

      {error && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>}

      <div className="gt-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]">
              {(res?.columns || ALL_COLUMNS.filter((c) => cols.includes(c.key))).map((c) => (
                <th key={c.key} className="py-2.5 px-3 whitespace-nowrap" aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  {SORTABLE.has(c.key) ? (
                    <button type="button" className="inline-flex items-center gap-1 font-semibold hover:text-[var(--gt-purple)]" onClick={() => toggleSort(c.key)}>
                      {c.label}{sort === c.key && (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  ) : <span className="font-semibold">{c.label}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(res?.items || []).map((r) => (
              <tr key={String(r.farmer_id)} className="border-b border-[var(--gt-border)] last:border-none hover:bg-[#FAF8FC] cursor-pointer" onClick={() => openFarmer(String(r.farmer_id))}>
                {(res?.columns || []).map((c) => (
                  <td key={c.key} className="py-2 px-3 whitespace-nowrap">
                    {c.key === "farmer_id" ? <button type="button" className="text-[var(--gt-purple)] hover:underline" onClick={(e) => { e.stopPropagation(); openFarmer(String(r.farmer_id)); }}>{String(r[c.key])}</button> : <span className={r[c.key] === null || r[c.key] === "" ? "text-[var(--gt-text-muted)]" : ""}>{show(r[c.key], c.key)}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {res && res.items.length === 0 && <div className="py-10 text-center text-sm text-[var(--gt-text-muted)]">No farmers match these filters.</div>}
        {!res && <div className="py-10 text-center text-[var(--gt-text-muted)]">Loading…</div>}
      </div>
      {res && <Pagination page={page} pageSize={size} total={res.total} onPage={setPage} onPageSize={(s) => { setSize(s); setPage(1); }} loading={loading} noun="farmers" />}

    </div>
  );
}
