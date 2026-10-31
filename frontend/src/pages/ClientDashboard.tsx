import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AlertCircle, ArrowLeft, ChevronRight, Download, FilterX, Info, Printer } from "lucide-react";
import { api } from "../api";
import Pagination from "../components/Pagination";

interface Kpi {
  title: string;
  kind: "count" | "share" | "ratio" | "dist" | "mean";
  definition: string;
  farmers: number;
  value?: number | null;
  pct?: number | null;
  n: number;
  not_captured: number;
  items?: { label: string; farmers: number; pct: number | null }[];
}
interface DrillRow { key: string | null; label: string; farmers: number; value?: number | null; pct?: number | null; n?: number; not_captured?: number }
interface Drill { kpi: string; by: string; category: string | null; parent_total: number; rows: DrillRow[]; title: string; kind: string }
interface Options { districts: string[]; talukas: string[]; villages: string[]; societies: string[]; crops: string[]; years: number[] }
interface Me { modules: { code: string }[]; client: string | null }

const NOT_CAPTURED = "Not captured";
const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: d }));
const UNITS: Record<string, string> = { avg_yield: " Qtl", avg_land: " ac", avg_leased: " ac", avg_areca_area: " ac" };

type FilterKey = "district" | "taluka" | "village" | "society" | "crop" | "year_from" | "year_to";
type Filters = Partial<Record<FilterKey, string>>;
interface DrillState { kpi: string; category?: string; path: Filters; by: "district" | "taluka" | "village" | "society" | "farmers" }

function levelFor(path: Filters): DrillState["by"] {
  if (!path.district) return "district";
  if (!path.taluka) return "taluka";
  if (!path.village) return "village";
  return "farmers";
}
const clean = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;

export default function ClientDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [options, setOptions] = useState<Options>({ districts: [], talukas: [], villages: [], societies: [], crops: [], years: [] });
  const [kpis, setKpis] = useState<Record<string, Kpi> | null>(null);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState<DrillState | null>(null);

  useEffect(() => { api.clientMe().then(setMe).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    api.clientFilters(clean({ district: filters.district, taluka: filters.taluka })).then(setOptions).catch((e) => setError(e.message));
  }, [filters.district, filters.taluka]);
  useEffect(() => {
    let live = true;
    api.clientDashboard(clean({ ...filters })).then((d) => { if (live) { setKpis(d.kpis); setError(""); } }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [filters]);

  const canExport = !!me?.modules.some((m) => m.code === "client_export");
  const canRecords = !!me?.modules.some((m) => m.code === "client_farmer_records");
  const setF = (k: FilterKey, v: string) => setFilters((f) => {
    const next = { ...f, [k]: v || undefined };
    if (k === "district") { delete next.taluka; delete next.village; delete next.society; }
    if (k === "taluka") { delete next.village; delete next.society; }
    return next;
  });
  const hasFilters = Object.values(filters).some(Boolean);
  const open = (code: string) => setDrill({ kpi: code, path: {}, by: "district" });
  const sel = "gt-input !py-1.5 !text-xs !w-auto min-w-[130px]";

  const filterBar = (
    <div className="gt-card p-3 flex flex-wrap items-center gap-2 print:hidden">
      <select className={sel} aria-label="District" value={filters.district || ""} onChange={(e) => setF("district", e.target.value)}>
        <option value="">All districts</option>{options.districts.map((d) => <option key={d}>{d}</option>)}
      </select>
      <select className={sel} aria-label="Taluk" value={filters.taluka || ""} onChange={(e) => setF("taluka", e.target.value)}>
        <option value="">All taluks</option>{options.talukas.map((d) => <option key={d}>{d}</option>)}
      </select>
      <select className={sel} aria-label="Village" value={filters.village || ""} onChange={(e) => setF("village", e.target.value)}>
        <option value="">All villages</option>{options.villages.map((d) => <option key={d}>{d}</option>)}
      </select>
      <select className={sel} aria-label="Society / FPC" value={filters.society || ""} onChange={(e) => setF("society", e.target.value)}>
        <option value="">All societies / FPCs</option>{options.societies.map((d) => <option key={d}>{d}</option>)}
      </select>
      <select className={sel} aria-label="Crop" value={filters.crop || ""} onChange={(e) => setF("crop", e.target.value)} title="Farmers who also grow this crop">
        <option value="">All crops</option>{options.crops.map((d) => <option key={d}>{d}</option>)}
      </select>
      <select className={sel} aria-label="Survey year from" value={filters.year_from || ""} onChange={(e) => setF("year_from", e.target.value)}>
        <option value="">Year from</option>{options.years.map((y) => <option key={y}>{y}</option>)}
      </select>
      <select className={sel} aria-label="Survey year to" value={filters.year_to || ""} onChange={(e) => setF("year_to", e.target.value)}>
        <option value="">Year to</option>{options.years.map((y) => <option key={y}>{y}</option>)}
      </select>
      {hasFilters && (
        <button type="button" onClick={() => setFilters({})} className="text-xs text-[var(--gt-purple)] inline-flex items-center gap-1 hover:underline"><FilterX size={13} /> Clear all</button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">Dashboard</h1>
        </div>
        <div className="flex gap-2 print:hidden">
          {canExport && !drill && (
            <button type="button" className="gt-btn-outline text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--gt-border)] bg-white" onClick={() => api.clientDownload("dashboard/export", clean({ ...filters }), "dashboard.xlsx").catch((e) => setError(e.message))}>
              <Download size={14} /> Excel
            </button>
          )}
          <button type="button" className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--gt-border)] bg-white" onClick={() => window.print()}>
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </div>

      {filterBar}
      {error && <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={15} /> {error}</div>}

      {drill && kpis ? (
        <DrillView drill={drill} setDrill={setDrill} filters={filters} kpi={kpis[drill.kpi]} canExport={canExport} canRecords={canRecords} />
      ) : !kpis ? (
        <div className="text-center py-16 text-[var(--gt-text-muted)]">Loading…</div>
      ) : (
        <>
          <SectionTitle>Record status &amp; coverage</SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {["farmers_surveyed", "society_linked", "credit_linked", "avg_yield"].map((c) => <KpiCard key={c} code={c} k={kpis[c]} onOpen={() => open(c)} />)}
          </div>
          <SectionTitle>Land holding &amp; areca plantation</SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard code="avg_land" k={kpis.avg_land} onOpen={() => open("avg_land")} accent caption="Mean own land holding per farmer" />
            <KpiCard code="avg_leased" k={kpis.avg_leased} onOpen={() => open("avg_leased")} accent caption="Mean leased land per farmer" />
            <KpiCard code="avg_areca_area" k={kpis.avg_areca_area} onOpen={() => open("avg_areca_area")} accent caption="Mean area under areca cultivation" />
            <KpiCard code="avg_trees" k={kpis.avg_trees} onOpen={() => open("avg_trees")} accent caption="Mean areca plants per farmer" />
          </div>
          <SectionTitle>Market &amp; credit</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-3">
            <PieCard code="marketing_channel" k={kpis.marketing_channel} sub="Share of farmers by channel" setDrill={setDrill} />
            <PieCard code="raw_vs_processed" k={kpis.raw_vs_processed} sub="Share of farmers by form sold" setDrill={setDrill} />
            <BarListCard code="credit_source" k={kpis.credit_source} sub="Credit-linked farmers by source" setDrill={setDrill} />
            <BarListCard code="challenges" k={kpis.challenges} sub="Farmers reporting each challenge (multi-select)" setDrill={setDrill} color="#BE123C" />
          </div>
          <SectionTitle>Land holding</SectionTitle>
          <LandDistribution own={kpis.avg_land} leased={kpis.avg_leased} areca={kpis.avg_areca_area} onOpen={open} />
        </>
      )}
    </div>
  );
}

function Def({ k }: { k: Kpi }) {
  const nc = k.not_captured > 0 ? ` ${k.not_captured.toLocaleString("en-IN")} farmer(s) have no value captured: excluded from the figure and shown as "${NOT_CAPTURED}".` : "";
  return <span title={k.definition + nc} aria-label={k.definition + nc} className="text-[var(--gt-text-muted)] cursor-help"><Info size={13} /></span>;
}

// Palette of the approved dashboard mock-ups.
const MOCK = ["#6B2C6B", "#0F766E", "#B45309", "#1D4ED8", "#9CA3AF", "#BE123C", "#0891B2", "#65A30D"];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--gt-text-muted)] mt-1">{children}</h2>;
}

function KpiCard({ code, k, onOpen, accent, caption }: { code: string; k: Kpi; onOpen: () => void; accent?: boolean; caption?: string }) {
  const main = k.kind === "share" ? `${fmt(k.pct ?? null, 1)}%` : fmt(k.value, k.kind === "count" ? 0 : 2);
  return (
    <button type="button" onClick={onOpen}
      style={accent ? { borderLeft: "4px solid #0F766E" } : undefined}
      className="gt-card p-4 text-left bg-white hover:shadow-md transition-shadow focus-visible:outline-2 focus-visible:outline-[var(--gt-purple)]"
      aria-label={`${k.title}: ${main}${UNITS[code] || ""}. Open drill-down`}>
      <div className="flex items-center justify-between gap-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--gt-text-muted)]">{k.title}</div>
        <Def k={k} />
      </div>
      <div className="text-[28px] leading-tight font-bold text-[#1F2937] mt-1.5">{main}<span className="text-base font-semibold">{UNITS[code] || ""}</span></div>
      <div className="text-xs text-[var(--gt-text-muted)] mt-1">
        {caption ?? (k.kind === "count" ? "Submitted surveys" : k.kind === "share" ? `Of ${fmt(k.n, 0)} farmers with the answer captured` : `Based on ${fmt(k.n, 0)} of ${fmt(k.farmers, 0)} farmers`)}
        {k.kind !== "count" && k.not_captured > 0 && <span> · {fmt(k.not_captured, 0)} {NOT_CAPTURED.toLowerCase()}</span>}
      </div>
    </button>
  );
}

interface DistRow { name: string; value: number; pct: number | null }
const distRows = (k: Kpi): DistRow[] => (k.items || []).map((i) => ({ name: i.label, value: i.farmers, pct: i.pct }));

function DistHeader({ k, sub, onDrill }: { k: Kpi; sub: string; onDrill: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2 mb-3">
      <div>
        <div className="font-bold text-[15px] text-[#1F2937] flex items-center gap-1.5">{k.title} <Def k={k} /></div>
        <div className="text-xs text-[var(--gt-text-muted)]">{sub}</div>
      </div>
      <button type="button" className="text-xs text-[var(--gt-purple)] hover:underline shrink-0" onClick={onDrill}>Drill down</button>
    </div>
  );
}

// Pie with the legend listed on the right (marketing channel, raw vs processed).
function PieCard({ code, k, sub, setDrill }: { code: string; k: Kpi; sub: string; setDrill: (d: DrillState) => void }) {
  const data = distRows(k);
  const open = (category?: string) => setDrill({ kpi: code, category, path: {}, by: "district" });
  return (
    <div className="gt-card p-5 bg-white">
      <DistHeader k={k} sub={sub} onDrill={() => open()} />
      {data.length === 0 ? <div className="text-sm text-[var(--gt-text-muted)] py-8 text-center">No data captured for this view.</div> : (
        <div className="flex items-center gap-5 flex-wrap">
          <div className="w-[170px] h-[170px] shrink-0" role="img" aria-label={`${k.title}: ${data.map((d) => `${d.name} ${d.pct ?? ""}%`).join(", ")}`}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" outerRadius={82} stroke="#fff" strokeWidth={2} startAngle={90} endAngle={-270} onClick={(d) => open(d.name)} cursor="pointer">
                  {data.map((_, i) => <Cell key={i} fill={MOCK[i % MOCK.length]} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${Number(v).toLocaleString("en-IN")} farmers`, String(n)]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex flex-col gap-1.5 text-sm min-w-[150px]">
            {data.map((d, i) => (
              <li key={d.name}>
                <button type="button" className="inline-flex items-center gap-2 hover:underline text-left" onClick={() => open(d.name)}>
                  <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: MOCK[i % MOCK.length] }} />
                  <span>{d.name} <b>{d.pct === null ? "—" : `${Math.round(d.pct)}%`}</b></span>
                </button>
              </li>
            ))}
            {k.not_captured > 0 && <li className="text-xs text-[var(--gt-text-muted)] pl-[18px]">{NOT_CAPTURED}: {k.not_captured.toLocaleString("en-IN")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// Ranked progress bars with the % at the right (credit source mix, top challenges).
function BarListCard({ code, k, sub, setDrill, color }: { code: string; k: Kpi; sub: string; setDrill: (d: DrillState) => void; color?: string }) {
  const data = distRows(k);
  const open = (category?: string) => setDrill({ kpi: code, category, path: {}, by: "district" });
  const max = Math.max(1, ...data.map((d) => d.pct ?? 0));
  return (
    <div className="gt-card p-5 bg-white">
      <DistHeader k={k} sub={sub} onDrill={() => open()} />
      {data.length === 0 ? <div className="text-sm text-[var(--gt-text-muted)] py-8 text-center">No data captured for this view.</div> : (
        <ul className="flex flex-col gap-2.5">
          {data.map((d, i) => (
            <li key={d.name}>
              <button type="button" onClick={() => open(d.name)} className="w-full grid grid-cols-[minmax(110px,170px)_1fr_44px] items-center gap-3 text-sm hover:opacity-80 text-left" title={`${d.value.toLocaleString("en-IN")} farmers`}>
                <span className="truncate">{d.name}</span>
                <span className="h-3.5 rounded bg-[#F1F2F4] overflow-hidden" role="img" aria-label={`${d.name} ${d.pct ?? ""}%`}>
                  <span className="block h-full rounded" style={{ width: `${((d.pct ?? 0) / max) * 100}%`, background: color || MOCK[i % MOCK.length] }} />
                </span>
                <span className="text-right text-[var(--gt-text-muted)] tabular-nums">{d.pct === null ? "—" : `${Math.round(d.pct)}%`}</span>
              </button>
            </li>
          ))}
          {k.not_captured > 0 && <li className="text-xs text-[var(--gt-text-muted)]">{NOT_CAPTURED}: {k.not_captured.toLocaleString("en-IN")} (excluded from %)</li>}
        </ul>
      )}
    </div>
  );
}

// Own vs leased split of the average holding, and how much of it is under areca.
function LandDistribution({ own, leased, areca, onOpen }: { own: Kpi; leased: Kpi; areca: Kpi; onOpen: (code: string) => void }) {
  const o = own.value ?? 0, l = leased.value ?? 0, a = areca.value ?? 0, total = o + l;
  if (!total) return null;
  const ownPct = Math.round((100 * o) / total), leasedPct = 100 - ownPct, arecaPct = Math.min(100, Math.round((100 * a) / total));
  const ring = [{ name: "Own", value: o }, { name: "Leased", value: l }];
  return (
    <div className="gt-card p-5 bg-white">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-bold text-[15px] text-[#1F2937]">Land Holding Distribution</div>
          <div className="text-xs text-[var(--gt-text-muted)]">Own vs Leased · Basis: submitted surveys</div>
        </div>
        <div className="text-xs bg-[#F3F4F6] rounded-lg px-3 py-1.5 text-[var(--gt-text-muted)]">Avg total holding: <b className="text-[#1F2937]">{fmt(total, 2)} ac</b> · Areca coverage: <b className="text-[#1F2937]">{arecaPct}%</b></div>
      </div>
      <div className="mt-4 grid md:grid-cols-[190px_1fr_220px] gap-5 items-center">
        <div className="relative w-[170px] h-[170px] mx-auto" role="img" aria-label={`Average holding ${fmt(total, 2)} acres: ${ownPct}% own, ${leasedPct}% leased`}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={ring} dataKey="value" innerRadius={56} outerRadius={82} startAngle={90} endAngle={-270} stroke="none">
                <Cell fill="#6B2C6B" /><Cell fill="#0F766E" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-2xl font-bold text-[#1F2937]">{fmt(total, 2)}</div><div className="text-[11px] text-[var(--gt-text-muted)]">avg acres</div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {[{ code: "avg_land", name: "Own land", pct: ownPct, avg: o, c: "#6B2C6B", bg: "#FAF5FC", track: "#E9D5F5" },
            { code: "avg_leased", name: "Leased land", pct: leasedPct, avg: l, c: "#0F766E", bg: "#F0FBF8", track: "#A7F3D0" }].map((r) => (
            <button key={r.code} type="button" onClick={() => onOpen(r.code)} className="text-left rounded-lg p-3 border-l-4 hover:shadow-sm" style={{ background: r.bg, borderLeftColor: r.c }}>
              <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: r.c }}>{r.name}</div>
              <div className="text-3xl font-bold" style={{ color: r.c }}>{r.pct}%</div>
              <div className="text-xs text-[#374151]">Avg <b>{fmt(r.avg, 2)} ac</b> per farmer</div>
              <div className="h-1.5 rounded mt-2" style={{ background: r.track }}><div className="h-full rounded" style={{ width: `${r.pct}%`, background: r.c }} /></div>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onOpen("avg_areca_area")} className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-center hover:shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#B45309]">Under areca</div>
          <div className="text-4xl font-bold text-[#B45309] my-1">{arecaPct}%</div>
          <div className="text-xs text-[#374151]">of total holding<br />Avg <b>{fmt(a, 2)} ac</b> per farmer</div>
        </button>
      </div>
    </div>
  );
}

function DrillView({ drill, setDrill, filters, kpi, canExport, canRecords }: { drill: DrillState; setDrill: (d: DrillState | null) => void; filters: Filters; kpi: Kpi; canExport: boolean; canRecords: boolean }) {
  const [data, setData] = useState<Drill | null>(null);
  const [error, setError] = useState("");
  const params = useMemo(() => clean({ ...filters, ...drill.path, kpi: drill.kpi, category: drill.category }), [filters, drill.path, drill.kpi, drill.category]);

  useEffect(() => {
    if (drill.by === "farmers") return;
    let live = true;
    api.clientDrill({ ...params, by: drill.by }).then((d) => { if (live) { setData(d); setError(""); } }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [params, drill.by]);

  const goDeeper = (key: string | null) => {
    if (!key) return;
    if (drill.by === "society") { setDrill({ ...drill, path: { society: key }, by: "district" }); return; }
    const path = { ...drill.path, [drill.by]: key } as Filters;
    setDrill({ ...drill, path, by: levelFor(path) });
  };
  // Breadcrumb: each crumb truncates the path back to that level.
  const crumbs: { label: string; to: Filters }[] = [{ label: "Karnataka", to: {} }];
  const acc: Filters = {};
  for (const k of ["district", "taluka", "village"] as const) {
    if (drill.path[k]) { acc[k] = drill.path[k]; crumbs.push({ label: drill.path[k]!, to: { ...acc } }); }
  }
  if (drill.path.society) crumbs.splice(1, 0, { label: `Society: ${drill.path.society}`, to: { society: drill.path.society } });
  const goto = (to: Filters) => setDrill({ ...drill, path: to, by: levelFor(to) });
  const columnLabel = drill.by === "society" ? "Society / FPC" : drill.by === "farmers" ? "Farmers" : { district: "District", taluka: "Taluk", village: "Village" }[drill.by];
  const showValue = kpi.kind !== "count" && kpi.kind !== "dist";
  const valueHead = kpi.kind === "share" ? "Linked (%)" : kpi.kind === "ratio" ? "Yield (qtl/ac)" : kpi.title;
  const sum = data ? data.rows.reduce((a, r) => a + r.farmers, 0) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap print:hidden">
        <button type="button" onClick={() => (crumbs.length > 1 ? goto(crumbs[crumbs.length - 2].to) : setDrill(null))} className="inline-flex items-center gap-1 text-xs text-[var(--gt-purple)] hover:underline"><ArrowLeft size={13} /> Back</button>
        <nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-1 text-xs">
          <button type="button" className="text-[var(--gt-purple)] hover:underline" onClick={() => setDrill(null)}>Dashboard</button>
          <ChevronRight size={12} />
          <span className="font-semibold">{kpi.title}{drill.category ? ` · ${drill.category}` : ""}</span>
          {crumbs.map((c, i) => (
            <span key={c.label} className="inline-flex items-center gap-1">
              <ChevronRight size={12} />
              {i === crumbs.length - 1 ? <b>{c.label}</b> : <button type="button" className="text-[var(--gt-purple)] hover:underline" onClick={() => goto(c.to)}>{c.label}</button>}
            </span>
          ))}
        </nav>
      </div>

      <div className="gt-card p-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="font-semibold text-[var(--gt-purple-dark)] flex items-center gap-1.5">{kpi.title}{drill.category ? ` — ${drill.category}` : ""} <Def k={kpi} /></div>
            <div className="text-xs text-[var(--gt-text-muted)]">{kpi.definition}</div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            {drill.by !== "society" && drill.by !== "farmers" && !drill.path.district && (
              <button type="button" className="text-xs px-3 py-1.5 rounded-full border border-[var(--gt-border)] bg-white" onClick={() => setDrill({ ...drill, by: "society" })}>By society / FPC</button>
            )}
            {drill.by === "society" && <button type="button" className="text-xs px-3 py-1.5 rounded-full border border-[var(--gt-border)] bg-white" onClick={() => setDrill({ ...drill, by: "district" })}>By geography</button>}
            {canExport && drill.by !== "farmers" && (
              <button type="button" className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--gt-border)] bg-white" onClick={() => api.clientDownload("dashboard/export", { ...params, by: drill.by }, "drilldown.xlsx").catch((e) => setError(e.message))}><Download size={13} /> Excel</button>
            )}
          </div>
        </div>
        {error && <div className="text-sm text-red-700 mt-2">{error}</div>}

        {drill.by === "farmers" ? (
          <FarmerTable params={params} canRecords={canRecords} canExport={canExport} />
        ) : !data ? <div className="py-10 text-center text-[var(--gt-text-muted)]">Loading…</div> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]">
                  <th className="py-2 pr-3">{columnLabel}</th><th className="py-2 pr-3 text-right">Farmers</th><th className="py-2 pr-3 text-right">Share of total</th>
                  {showValue && <th className="py-2 pr-3 text-right">{valueHead}</th>}
                  {showValue && <th className="py-2 pr-3 text-right" title="Farmers with no value captured; excluded from the figure">{NOT_CAPTURED}</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.label} className="border-b border-[var(--gt-border)] last:border-none">
                    <td className="py-2 pr-3">
                      {r.key ? <button type="button" className="text-[var(--gt-purple)] hover:underline font-medium text-left" onClick={() => goDeeper(r.key)}>{r.label}</button> : <span className="text-[var(--gt-text-muted)]">{r.label}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.farmers.toLocaleString("en-IN")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{data.parent_total ? fmt((100 * r.farmers) / data.parent_total) : "—"}%</td>
                    {showValue && <td className="py-2 pr-3 text-right tabular-nums">{kpi.kind === "share" ? (r.pct === null || r.pct === undefined ? "—" : `${r.pct}% (${fmt(r.value, 0)})`) : fmt(r.value, 2)}</td>}
                    {showValue && <td className="py-2 pr-3 text-right tabular-nums text-[var(--gt-text-muted)]">{fmt(r.not_captured, 0)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{data.parent_total.toLocaleString("en-IN")}</td>
                  <td className="py-2 pr-3 text-right text-xs font-normal text-[var(--gt-text-muted)]" colSpan={showValue ? 3 : 1}>{sum === data.parent_total ? "✓ reconciles with the parent total" : "does not reconcile"}</td>
                </tr>
              </tfoot>
            </table>
            {data.rows.length === 0 && <div className="py-6 text-center text-sm text-[var(--gt-text-muted)]">No farmers match this view.</div>}
            {drill.by !== "society" && (
              <div className="pt-3 print:hidden"><button type="button" className="text-xs text-[var(--gt-purple)] hover:underline" onClick={() => setDrill({ ...drill, by: "farmers" })}>Show these {data.parent_total.toLocaleString("en-IN")} farmers →</button></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FarmerTable({ params, canRecords, canExport }: { params: Record<string, string>; canRecords: boolean; canExport: boolean }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [res, setRes] = useState<{ total: number; items: Record<string, string | number | null>[] } | null>(null);
  const [err, setErr] = useState("");
  const cols = "farmer_id,farmer_name,village,society_name,credit_linkage,areca_plant_count";
  const load = useCallback(() => {
    api.clientFarmers({ ...params, page: String(page), limit: String(size), columns: cols }).then((r) => { setRes(r); setErr(""); }).catch((e) => setErr(e.message));
  }, [params, page, size]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="text-sm text-red-700 mt-2">{err}</div>;
  if (!res) return <div className="py-8 text-center text-[var(--gt-text-muted)]">Loading…</div>;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex justify-end print:hidden">
        {canExport && <button type="button" className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--gt-border)] bg-white" onClick={() => api.clientDownload("farmers/export", { ...params, columns: cols }, "farmers.xlsx").catch((e) => setErr(e.message))}><Download size={13} /> Excel</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]"><th className="py-2 pr-3">Farmer ID</th><th className="pr-3">Name</th><th className="pr-3">Village</th><th className="pr-3">Society / FPC</th><th className="pr-3">Credit</th><th className="pr-3 text-right">Trees</th></tr></thead>
          <tbody>
            {res.items.map((r) => (
              <tr key={String(r.farmer_id)} className="border-b border-[var(--gt-border)] last:border-none">
                <td className="py-2 pr-3">{canRecords ? <Link className="text-[var(--gt-purple)] hover:underline" to={`/client/farmer?id=${encodeURIComponent(String(r.farmer_id))}`}>{r.farmer_id}</Link> : r.farmer_id}</td>
                <td className="pr-3">{r.farmer_name}</td><td className="pr-3">{r.village || NOT_CAPTURED}</td><td className="pr-3">{r.society_name || "—"}</td><td className="pr-3">{r.credit_linkage || NOT_CAPTURED}</td>
                <td className="pr-3 text-right tabular-nums">{r.areca_plant_count ?? NOT_CAPTURED}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={size} total={res.total} onPage={setPage} onPageSize={(s) => { setSize(s); setPage(1); }} noun="farmers" />
    </div>
  );
}
