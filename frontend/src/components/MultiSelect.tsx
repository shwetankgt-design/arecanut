import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Check, Search, X } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  icon?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

interface Props {
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  mode?: "multiple" | "single";
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel: string;
  invalid?: boolean;
  disabled?: boolean;
  maxChips?: number;
}

// Searchable list box that scales to many options: a field showing the selection as removable chips,
// opening a panel with search, select-all / clear (multiple mode), checkboxes or radios, descriptions and
// keyboard navigation (↑ ↓ Home End, Enter/Space to toggle, Esc to close). Used for roles and modules in
// User Management so new roles / modules need no layout change.
export default function MultiSelect({
  options, value, onChange, mode = "multiple", placeholder = "Select…", searchPlaceholder = "Search…",
  emptyText = "No options", ariaLabel, invalid, disabled, maxChips = 3,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [dropUp, setDropUp] = useState(false);
  const [listMax, setListMax] = useState(256);
  const listId = useId();
  const single = mode === "single";
  const searchable = options.length > 6;

  const filtered = useMemo(() => {
    const t = query.trim().toLowerCase();
    return t ? options.filter((o) => `${o.label} ${o.description || ""}`.toLowerCase().includes(t)) : options;
  }, [options, query]);

  const selected = options.filter((o) => value.includes(o.value));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openPanel = () => {
    if (disabled) return;
    // Open upwards when there is not enough room below (e.g. near the bottom of a drawer with a sticky footer).
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom - 80;
      const above = rect.top - 70;
      const up = below < 320 && above > below;
      setDropUp(up);
      // The list scrolls inside the space that is actually available (minus search + header rows).
      setListMax(Math.max(120, Math.min(256, (up ? above : below) - 90)));
    }
    setOpen(true);
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => value.includes(o.value))));
    setTimeout(() => searchRef.current?.focus(), 0);
  };
  const close = () => { setOpen(false); setQuery(""); };

  const toggle = (opt: SelectOption) => {
    if (opt.disabled) return;
    if (single) {
      onChange([opt.value]);
      close();
    } else {
      onChange(value.includes(opt.value) ? value.filter((v) => v !== opt.value) : [...value, opt.value]);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(filtered.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) toggle(filtered[active]); }
    else if (e.key === " " && !searchable) { e.preventDefault(); if (filtered[active]) toggle(filtered[active]); }
  };

  const selectableShown = filtered.filter((o) => !o.disabled);
  const allShownSelected = selectableShown.length > 0 && selectableShown.every((o) => value.includes(o.value));

  return (
    <div ref={rootRef} className="relative" onKeyDown={open ? onKeyDown : undefined}>
      <div
        ref={triggerRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={(e) => { if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); openPanel(); } }}
        className={`gt-input w-full min-h-[42px] flex items-center gap-2 cursor-pointer ${invalid ? "!border-[var(--gt-danger)]" : ""} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {selected.length === 0 && <span className="text-[var(--gt-text-muted)] text-sm">{placeholder}</span>}
          {single && selected[0] && <span className="text-sm font-medium truncate">{selected[0].label}</span>}
          {!single && selected.slice(0, maxChips).map((o) => (
            <span key={o.value} className="inline-flex items-center gap-1 bg-[#F1EBF7] text-[var(--gt-purple-dark)] text-xs rounded-full pl-2.5 pr-1 py-0.5 max-w-[180px]">
              <span className="truncate">{o.label}</span>
              <button type="button" aria-label={`Remove ${o.label}`} className="p-0.5 rounded-full hover:bg-white/70"
                onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v !== o.value)); }}><X size={11} /></button>
            </span>
          ))}
          {!single && selected.length > maxChips && (
            <span className="text-xs font-medium text-[var(--gt-purple-dark)] bg-[#E9DFF3] rounded-full px-2 py-0.5">+{selected.length - maxChips} more</span>
          )}
        </div>
        {!single && selected.length > 0 && (
          <span className="text-[11px] text-[var(--gt-text-muted)] whitespace-nowrap hidden sm:inline">{selected.length} selected</span>
        )}
        <ChevronDown size={16} className={`text-[var(--gt-text-muted)] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </div>

      {open && (
        <div className={`absolute z-30 left-0 right-0 bg-white border border-[var(--gt-border)] rounded-xl shadow-xl overflow-hidden ${dropUp ? "bottom-full mb-1" : "mt-1"}`}>
          {searchable && (
            <div className="relative p-2 border-b border-[var(--gt-border)]">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
              <input ref={searchRef} className="gt-input !pl-8 !py-1.5 text-sm w-full" placeholder={searchPlaceholder} value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }} />
            </div>
          )}
          {!single && (
            <div className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-[var(--gt-border)] bg-[#FAF8FC]">
              <span className="text-[var(--gt-text-muted)]">{filtered.length} option{filtered.length === 1 ? "" : "s"}</span>
              <span className="flex gap-3">
                <button type="button" className="text-[var(--gt-purple)] font-medium"
                  onClick={() => onChange(allShownSelected
                    ? value.filter((v) => !selectableShown.some((o) => o.value === v))
                    : [...new Set([...value, ...selectableShown.map((o) => o.value)])])}>
                  {allShownSelected ? "Unselect shown" : "Select shown"}
                </button>
                {value.length > 0 && <button type="button" className="text-[var(--gt-text-muted)]" onClick={() => onChange([])}>Clear all</button>}
              </span>
            </div>
          )}
          <ul ref={listRef} id={listId} role="listbox" aria-multiselectable={!single} aria-label={ariaLabel} className="overflow-y-auto py-1" style={{ maxHeight: listMax }} tabIndex={-1}>
            {filtered.map((o, i) => {
              const on = value.includes(o.value);
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={on}
                  aria-disabled={o.disabled}
                  data-index={i}
                  title={o.disabled ? o.disabledReason : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(o)}
                  className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer ${i === active ? "bg-[#F6F0FB]" : ""} ${o.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span className={`mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center border ${single ? "rounded-full" : "rounded"} ${on ? "bg-[var(--gt-purple)] border-[var(--gt-purple)] text-white" : "border-gray-300 bg-white"}`}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  {o.icon}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">{o.label}</span>
                      {o.badge && <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{o.badge}</span>}
                    </span>
                    {o.description && <span className="block text-xs text-[var(--gt-text-muted)]">{o.description}</span>}
                    {o.disabled && o.disabledReason && <span className="block text-[11px] text-amber-700">{o.disabledReason}</span>}
                  </span>
                </li>
              );
            })}
            {filtered.length === 0 && <li className="px-3 py-4 text-center text-xs text-[var(--gt-text-muted)]">{options.length === 0 ? emptyText : "No matches."}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
