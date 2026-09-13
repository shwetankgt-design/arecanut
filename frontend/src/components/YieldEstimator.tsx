import { useEffect, useMemo, useState } from "react";
import { Sprout } from "lucide-react";
import { api } from "../api";
import { useLang } from "../LangContext";
import { tr, trDistrict } from "../i18n";

type Bucket = {
  sample_size: number;
  avg_plants_per_acre: number;
  avg_yield_per_acre_qtl: number;
  avg_yield_per_plant_kg: number;
  avg_rate_inr_per_kg: number;
  avg_cost_per_acre_inr: number;
};

type Benchmarks = {
  overall: Bucket;
  by_district: Record<string, Bucket>;
  by_taluka: Record<string, Bucket>;
};

export default function YieldEstimator() {
  const { lang } = useLang();
  const [bench, setBench] = useState<Benchmarks | null>(null);
  const [district, setDistrict] = useState<string>("");
  const [area, setArea] = useState<string>("2");
  const [rateOverride, setRateOverride] = useState<string>("");

  useEffect(() => {
    api.yieldBenchmarks().then(setBench).catch(console.error);
  }, []);

  const basis: Bucket | null = useMemo(() => {
    if (!bench) return null;
    if (district && bench.by_district[district] && bench.by_district[district].sample_size >= 3) {
      return bench.by_district[district];
    }
    return bench.overall;
  }, [bench, district]);

  const usingFallback = district && bench && (!bench.by_district[district] || bench.by_district[district].sample_size < 3);

  const areaNum = parseFloat(area) || 0;
  const rate = rateOverride ? parseFloat(rateOverride) || 0 : basis?.avg_rate_inr_per_kg || 0;

  const estYieldQtl = basis ? Math.round(areaNum * basis.avg_yield_per_acre_qtl * 100) / 100 : 0;
  const estPlants = basis ? Math.round(areaNum * basis.avg_plants_per_acre) : 0;
  const estGross = Math.round(estYieldQtl * rate * 100);
  const estCost = basis ? Math.round(areaNum * basis.avg_cost_per_acre_inr) : 0;
  const estNet = estGross - estCost;

  if (!bench) return null;

  return (
    <div className="gt-card p-4 md:p-5 md:col-span-2">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl gt-gradient text-white flex items-center justify-center shrink-0">
          <Sprout size={20} />
        </div>
        <div>
          <div className="font-semibold text-sm text-[var(--gt-purple-dark)]">{tr("yieldEstTitle", lang)}</div>
          <p className="text-xs text-[var(--gt-text-muted)]">{tr("yieldEstSubtitle", lang)}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="gt-label">{tr("estimateBasis", lang)}</label>
          <select className="gt-input" value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">{tr("wholeState", lang)}</option>
            {Object.keys(bench.by_district).map((d) => (
              <option key={d} value={d}>{trDistrict(d, lang)}</option>
            ))}
          </select>
          {usingFallback && (
            <div className="text-[10px] text-[var(--gt-text-muted)] mt-1">Not enough district samples — using state-wide benchmark.</div>
          )}
        </div>
        <div>
          <label className="gt-label">{tr("arecaAreaInput", lang)}</label>
          <input type="number" min="0" step="0.1" className="gt-input" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
        <div>
          <label className="gt-label">{tr("expectedRate", lang)}</label>
          <input
            type="number"
            min="0"
            className="gt-input"
            placeholder={basis ? `${basis.avg_rate_inr_per_kg} (${tr("useBenchmarkRate", lang)})` : ""}
            value={rateOverride}
            onChange={(e) => setRateOverride(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl bg-[#F1EBF7] p-3">
          <div className="text-[10px] font-semibold text-[var(--gt-text-muted)] uppercase">{tr("estPlants", lang)}</div>
          <div className="text-lg font-bold text-[var(--gt-purple-dark)]">{estPlants.toLocaleString("en-IN")}</div>
        </div>
        <div className="rounded-xl bg-[#F1EBF7] p-3">
          <div className="text-[10px] font-semibold text-[var(--gt-text-muted)] uppercase">{tr("estYield", lang)}</div>
          <div className="text-lg font-bold text-[var(--gt-purple-dark)]">{estYieldQtl} Qtl</div>
          {basis && <div className="text-[10px] text-[var(--gt-text-muted)]">{basis.avg_yield_per_acre_qtl} {tr("perAcre", lang)}</div>}
        </div>
        <div className="rounded-xl bg-[#F1EBF7] p-3">
          <div className="text-[10px] font-semibold text-[var(--gt-text-muted)] uppercase">{tr("estGrossIncome", lang)}</div>
          <div className="text-lg font-bold text-[var(--gt-purple-dark)]">₹{estGross.toLocaleString("en-IN")}</div>
        </div>
        <div className="rounded-xl bg-[#F1EBF7] p-3">
          <div className="text-[10px] font-semibold text-[var(--gt-text-muted)] uppercase">{tr("estCost", lang)}</div>
          <div className="text-lg font-bold text-[var(--gt-danger)]">₹{estCost.toLocaleString("en-IN")}</div>
        </div>
        <div className="rounded-xl bg-[var(--gt-purple)] p-3">
          <div className="text-[10px] font-semibold text-white/80 uppercase">{tr("estNetIncome", lang)}</div>
          <div className="text-lg font-bold text-white">₹{estNet.toLocaleString("en-IN")}</div>
        </div>
      </div>

      {basis && (
        <div className="text-[11px] text-[var(--gt-text-muted)] mt-3">
          Benchmark from {basis.sample_size} {tr("basedOnSamples", lang)}
          {district ? ` — ${trDistrict(district, lang)}` : ` — ${tr("wholeState", lang)}`}
          &middot; avg. {basis.avg_yield_per_plant_kg} kg/plant &middot; avg. rate ₹{basis.avg_rate_inr_per_kg}/kg
        </div>
      )}
    </div>
  );
}
