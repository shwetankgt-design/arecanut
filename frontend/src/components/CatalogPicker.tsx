import { useMemo, useState } from "react";
import { Search, BarChart3, FileText } from "lucide-react";
import type { CatalogItem } from "../lib/mis";
import { TYPE_LABEL } from "../lib/mis";

interface Props {
  items: CatalogItem[];
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}

// Admin picker for "Reports & Dashboards Access": grouped by category, filterable by type and search,
// with select-all-shown, clear, and select-by-category. Scales to hundreds of items (scrolling list).
export default function CatalogPicker({ items, value, onChange, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "report" | "dashboard">("all");
  const [category, setCategory] = useState("");
  const selected = useMemo(() => new Set(value), [value]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const shown = useMemo(() => {
    const t = query.trim().toLowerCase();
    return items.filter((i) =>
      (type === "all" || i.item_type === type) &&
      (!category || i.category === category) &&
      (!t || `${i.name} ${i.description || ""} ${i.category} ${i.code}`.toLowerCase().includes(t)));
  }, [items, query, type, category]);

  const groups = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    for (const i of shown) { if (!m.has(i.category)) m.set(i.category, []); m.get(i.category)!.push(i); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const setMany = (ids: number[], on: boolean) => {
    const next = new Set(value);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    onChange([...next]);
  };
  const toggle = (id: number) => setMany([id], !selected.has(id));
  const allShownSelected = shown.length > 0 && shown.every((i) => selected.has(i.id));
  const chip = (on: boolean) => `text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${on ? "gt-gradient text-white border-transparent" : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"}`;

  return (
    <div className={`rounded-xl border border-[var(--gt-border)] bg-white ${disabled ? "opacity-50 pointer-events-none" : ""}`} aria-disabled={disabled}>
      <div className="p-2.5 flex flex-col gap-2 border-b border-[var(--gt-border)]">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
          <input className="gt-input !pl-8 !py-1.5 text-sm w-full" placeholder="Search reports and dashboards…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {([["all", "All"], ["report", "Reports"], ["dashboard", "Dashboards"]] as const).map(([k, l]) => (
            <button key={k} type="button" className={chip(type === k)} onClick={() => setType(k)}>{l}</button>
          ))}
          <select className="gt-input !w-auto !py-1 !px-2 text-xs ml-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--gt-text-muted)]">
          <span><b className="text-[var(--gt-text)]">{value.length}</b> of {items.length} selected · {shown.length} shown</span>
          <span className="flex gap-3">
            <button type="button" className="text-[var(--gt-purple)] font-medium" onClick={() => setMany(shown.map((i) => i.id), !allShownSelected)}>
              {allShownSelected ? "Unselect shown" : "Select shown"}
            </button>
            {value.length > 0 && <button type="button" onClick={() => onChange([])}>Clear all</button>}
          </span>
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {groups.map(([cat, list]) => {
          const ids = list.map((i) => i.id);
          const count = ids.filter((id) => selected.has(id)).length;
          return (
            <div key={cat}>
              <label className="flex items-center gap-2 px-3 py-1.5 bg-[#FAF8FC] border-b border-[var(--gt-border)] sticky top-0 cursor-pointer">
                <input type="checkbox" checked={count === ids.length} ref={(el) => { if (el) el.indeterminate = count > 0 && count < ids.length; }}
                  onChange={() => setMany(ids, count !== ids.length)} aria-label={`Select all in ${cat}`} />
                <span className="text-xs font-semibold text-[var(--gt-purple-dark)] uppercase tracking-wide">{cat}</span>
                <span className="text-[11px] text-[var(--gt-text-muted)] ml-auto">{count}/{ids.length}</span>
              </label>
              {list.map((i) => (
                <label key={i.id} className="flex items-start gap-2.5 px-3 py-2 border-b border-[var(--gt-border)] last:border-0 cursor-pointer hover:bg-[#F6F4F9]">
                  <input type="checkbox" className="mt-1" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                  {i.item_type === "dashboard" ? <BarChart3 size={15} className="mt-0.5 text-[var(--gt-purple)] shrink-0" /> : <FileText size={15} className="mt-0.5 text-sky-600 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">{i.name}</span>
                      <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${i.item_type === "dashboard" ? "bg-[#F1EBF7] text-[var(--gt-purple-dark)]" : "bg-sky-50 text-sky-700"}`}>{TYPE_LABEL[i.item_type]}</span>
                    </span>
                    {i.description && <span className="block text-xs text-[var(--gt-text-muted)]">{i.description}</span>}
                  </span>
                </label>
              ))}
            </div>
          );
        })}
        {groups.length === 0 && <div className="p-6 text-center text-xs text-[var(--gt-text-muted)]">{items.length === 0 ? "No active reports or dashboards in the catalog yet." : "Nothing matches your filters."}</div>}
      </div>
    </div>
  );
}
