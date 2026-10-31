import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, X, CloudUpload, Download, ArrowUp, ArrowDown, ArrowUpDown, WifiOff, Lock, LockOpen } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { api } from "../api";
import { useLang } from "../LangContext";
import { tr, trDistrict, trTaluka, trVillage } from "../i18n";
import { analytics } from "../lib/analytics";
import { useAuth } from "../AuthContext";
import { listQueuedDrafts } from "../offlineDraftQueue";
import { subscribe } from "../lib/syncManager";
import Pagination from "../components/Pagination";
import { PAGE_SIZES, DEFAULT_PAGE_SIZE } from "../lib/paging";

// CR-19: columns the Farmer Records table can be sorted by, matching the
// backend's SORTABLE_FIELDS whitelist — keep these in sync with main.py.
const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: "farmer_name", label: "Farmer" },
  { key: "village", label: "Village" },
  { key: "district", label: "District" },
  { key: "areca_area_acres", label: "Areca Area" },
  { key: "yield_raw_qtl", label: "Yield (Qtl)" },
  { key: "total_income_inr", label: "Net Income" },
];

export default function FarmerList() {
  const [rows, setRows] = useState<any[]>([]);
  // Drafts created offline that have never reached the server at all (no
  // surveyId yet) — these don't exist in `rows` (that's api.listSurveys(),
  // server data only), so they're fetched separately and merged into the
  // Drafts view. A local draft that already has a surveyId (an offline edit
  // of an existing synced draft) is intentionally NOT included here — it's
  // already present in `rows`, just possibly showing stale pre-edit values
  // until that edit syncs.
  const [localDrafts, setLocalDrafts] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { lang } = useLang();
  const { user, hasPermission } = useAuth();
  const justQueued = searchParams.get("queued") === "1";
  const sortBy = searchParams.get("sort_by") || "entry_timestamp";
  const sortDir = searchParams.get("sort_dir") === "asc" ? "asc" : "desc";

  // Paging state lives in the URL (?page=3&page_size=50) so refresh / back / shared links keep the place.
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const rawSize = Number(searchParams.get("page_size"));
  const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE;
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const filterParams = useMemo(() => {
    const obj: Record<string, string> = {};
    searchParams.forEach((v, k) => { if (k !== "queued" && k !== "page" && k !== "page_size") obj[k] = v; });
    return obj;
  }, [searchParams]);

  const goToPage = (p: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(p));
    setSearchParams(next);
    setSelected(new Set());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const changePageSize = (size: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page_size", String(size));
    next.delete("page");
    setSearchParams(next);
  };

  const load = () => {
    const params = { ...filterParams, ...(q ? { q } : {}), limit: String(pageSize), offset: String((page - 1) * pageSize) };
    setLoading(true);
    api.listSurveysPaged(params)
      .then(({ items, total: t }) => {
        // A filter or deletion can leave the current page past the end — jump back to the last real page.
        if (items.length === 0 && t > 0 && page > 1) { goToPage(Math.ceil(t / pageSize)); return; }
        setRows(items);
        setTotal(t);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  // Searching starts again from page 1.
  const runSearch = () => { if (page > 1) goToPage(1); else load(); };

  const toggleSort = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (sortBy === key) {
      next.set("sort_dir", sortDir === "asc" ? "desc" : "asc");
    } else {
      next.set("sort_by", key);
      next.set("sort_dir", "asc");
    }
    next.delete("page");
    setSearchParams(next);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const params = { ...filterParams, ...(q ? { q } : {}) };
      const blob = await api.exportSurveys(Object.keys(params).length ? params : undefined);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `farmer_surveys_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      analytics.track("excel_export");
    } catch (e: any) {
      setExportError(e.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!user) { setLocalDrafts([]); return; }
    const loadLocalDrafts = () => {
      listQueuedDrafts(user.username).then((entries) => {
        setLocalDrafts(
          entries
            .filter((e) => !e.surveyId)
            .map((e) => ({ ...e.payload, id: e.clientUuid, clientUuid: e.clientUuid, status: "draft", localOnly: true }))
        );
      });
    };
    loadLocalDrafts();
    // Re-reads whenever the sync manager's state changes — in particular,
    // once a background sync assigns this draft a real surveyId, it needs
    // to drop out of this local-only list (it'll then appear via `rows`
    // like any other server draft, picking up the "DRAFT" badge without
    // the "not yet synced" one).
    return subscribe(loadLocalDrafts);
  }, [user]);

  const statusFilter = searchParams.get("status") || "all";
  const showLocalDrafts = statusFilter === "all" || statusFilter === "draft";
  const visibleLocalDrafts = showLocalDrafts
    ? localDrafts.filter((d) => !q || (d.farmer_name || "").toLowerCase().includes(q.toLowerCase()))
    : [];
  const displayRows = [...visibleLocalDrafts, ...rows];

  const [allUsers, setAllUsers] = useState<{ id: number; username: string; full_name: string; role: string }[]>([]);
  useEffect(() => {
    if (user?.role !== "admin") return;
    api.listUsers().then((us: any[]) => setAllUsers(us.filter((u) => u.role === "field"))).catch(() => {});
  }, [user?.role]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    setSearchParams(next);
  };
  const selectedUserIds = (searchParams.get("user_ids") || "").split(",").filter(Boolean);
  const toggleUser = (id: number) => {
    const cur = new Set(selectedUserIds);
    const key = String(id);
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    setParam("user_ids", [...cur].join(","));
  };
  const userLabel = (idStr: string) => allUsers.find((u) => String(u.id) === idStr)?.full_name || `user ${idStr}`;

  // Freeze/unfreeze is a web-only, admin/data-verifier feature.
  const canFreeze = (user?.role === "admin" || hasPermission("data_verifier")) && !Capacitor.isNativePlatform();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [freezeMsg, setFreezeMsg] = useState<string | null>(null);
  const selectable = rows.filter((r) => r.status !== "draft");
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const toggleSelect = (id: number) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const runFreeze = async (ids: number[], frozen: boolean) => {
    setFreezeMsg(null);
    try {
      const res = await api.bulkFreeze(ids, frozen);
      setFreezeMsg(`${res.changed} record(s) ${frozen ? "frozen" : "unfrozen"}${res.skipped ? `, ${res.skipped} unchanged` : ""}.`);
      setSelected(new Set());
      load();
    } catch (e: any) {
      setFreezeMsg(e.message);
    }
  };

  const clearFilters = () => {
    setSearchParams({});
    setQ("");
  };

  const removeFilter = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    next.delete("page");
    setSearchParams(next);
  };

  const activeFilters = Object.entries(filterParams).filter(([k]) => k !== "sort_by" && k !== "sort_dir" && k !== "status");
  const setStatusFilter = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    next.delete("page");
    setSearchParams(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">{tr("farmerListTitle", lang)}</h1>
        <p className="text-sm text-[var(--gt-text-muted)]">{(total + visibleLocalDrafts.length).toLocaleString("en-IN")} {tr("records", lang)}</p>
      </div>

      {justQueued && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg px-3 py-2">
          <CloudUpload size={14} /> Saved on this device — it will sync automatically once you're back online.
        </div>
      )}

      <div className="flex gap-2">
        {[
          { key: "all", label: "All" },
          { key: "submitted", label: "Submitted" },
          { key: "draft", label: "Drafts" },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setStatusFilter(opt.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              statusFilter === opt.key
                ? "gt-gradient text-white border-transparent shadow-sm"
                : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {canFreeze && (
        <div className="flex gap-2 items-center">
          <span className="text-xs text-[var(--gt-text-muted)]">Verification:</span>
          {[{ k: "", l: "All" }, { k: "true", l: "Frozen" }, { k: "false", l: "Not frozen" }].map((o) => (
            <button key={o.k} onClick={() => setParam("frozen", o.k)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${(searchParams.get("frozen") || "") === o.k ? "gt-gradient text-white border-transparent shadow-sm" : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"}`}>
              {o.l}
            </button>
          ))}
        </div>
      )}

      {canFreeze && selected.size > 0 && (
        <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 text-sky-900 text-sm rounded-lg px-3 py-2">
          <span className="font-medium">{selected.size} selected</span>
          <button className="gt-btn-secondary flex items-center gap-1.5" onClick={() => runFreeze([...selected], true)}><Lock size={14} /> Freeze</button>
          <button className="gt-btn-secondary flex items-center gap-1.5" onClick={() => runFreeze([...selected], false)}><LockOpen size={14} /> Unfreeze</button>
          <button className="text-xs underline ml-auto" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {freezeMsg && <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">{freezeMsg}</div>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--gt-text-muted)] flex flex-col gap-1">
          From date
          <input type="date" className="gt-input" value={searchParams.get("date_from") || ""} max={searchParams.get("date_to") || undefined}
            onChange={(e) => setParam("date_from", e.target.value)} />
        </label>
        <label className="text-xs text-[var(--gt-text-muted)] flex flex-col gap-1">
          To date
          <input type="date" className="gt-input" value={searchParams.get("date_to") || ""} min={searchParams.get("date_from") || undefined}
            onChange={(e) => setParam("date_to", e.target.value)} />
        </label>
        {user?.role === "admin" && (
          <details className="relative">
            <summary className="gt-input cursor-pointer select-none list-none text-sm min-w-[12rem]">
              {selectedUserIds.length ? `${selectedUserIds.length} user(s) selected` : "All users"}
            </summary>
            <div className="absolute z-20 mt-1 w-64 max-h-64 overflow-auto bg-white border border-[var(--gt-border)] rounded-lg shadow-lg p-2 flex flex-col gap-1">
              {allUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                  <input type="checkbox" checked={selectedUserIds.includes(String(u.id))} onChange={() => toggleUser(u.id)} />
                  {u.full_name} <span className="text-[var(--gt-text-muted)]">({u.username})</span>
                </label>
              ))}
              {allUsers.length === 0 && <span className="text-xs text-[var(--gt-text-muted)] p-1">No field users</span>}
            </div>
          </details>
        )}
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--gt-text-muted)] font-medium">{tr("filteredBy", lang)}:</span>
          {activeFilters.map(([key, value]) => (
            <span key={key} className="gt-chip active !cursor-default text-xs px-2.5 py-1">
              {key === "user_ids" ? `users: ${value.split(",").map(userLabel).join(", ")}` : `${key.replace(/_/g, " ")}: ${value}`}
              <X size={12} className="cursor-pointer" onClick={() => removeFilter(key)} />
            </span>
          ))}
          <button className="text-xs text-[var(--gt-purple)] underline font-medium" onClick={clearFilters}>
            {tr("clearFilters", lang)}
          </button>
        </div>
      )}

      {exportError && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-xs rounded-lg px-3 py-2">
          {exportError}
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
          <input
            className="gt-input pl-9"
            placeholder={tr("searchPlaceholder", lang)}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
        </div>
        <button className="gt-btn-secondary" onClick={runSearch}>{tr("search", lang)}</button>
        <button className="gt-btn-secondary flex items-center gap-1.5" onClick={handleExport} disabled={exporting}>
          <Download size={15} /> {exporting ? "Exporting…" : "Download Excel"}
        </button>
      </div>

      <div className="gt-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]">
              {canFreeze && (
                <th className="p-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))} />
                </th>
              )}
              {SORT_COLUMNS.map(({ key, label }) => (
                <th key={key} className="p-3 cursor-pointer select-none hover:text-[var(--gt-purple-dark)]" onClick={() => toggleSort(key)}>
                  <span className="inline-flex items-center gap-1">
                    {key === "village" ? <>{tr("village", lang)} / {tr("taluka", lang)}</> : key === "district" ? tr("district", lang) : label}
                    {sortBy === key ? (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-30" />}
                  </span>
                </th>
              ))}
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r) => {
              const editHref = r.localOnly ? `/entry/farmer?localDraft=${r.clientUuid}` : `/entry/farmer?id=${r.id}`;
              return (
              <tr
                key={r.id}
                className="border-b border-[var(--gt-border)] hover:bg-[#F6F4F9] cursor-pointer"
                onClick={() => navigate(r.localOnly ? editHref : `/farmers/${r.id}`)}
              >
                {canFreeze && (
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    {!r.localOnly && r.status !== "draft" && (
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                    )}
                  </td>
                )}
                <td className="p-3">
                  <div className="font-medium flex items-center gap-1.5">
                    {r.farmer_name || <span className="text-[var(--gt-text-muted)]">Untitled draft</span>}
                    {r.status === "draft" && (
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">DRAFT</span>
                    )}
                    {r.is_frozen && (
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded-full">
                        <Lock size={9} /> FROZEN
                      </span>
                    )}
                    {r.localOnly && (
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-[var(--gt-text-muted)] bg-[#F1EBF7] px-1.5 py-0.5 rounded-full">
                        <WifiOff size={9} /> Not yet synced
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--gt-text-muted)]">{r.farmer_id || "—"} &middot; {r.mobile_no || "—"}</div>
                </td>
                <td className="p-3">{r.village ? <>{trVillage(r.village, lang)} / {trTaluka(r.taluka, lang)}</> : "—"}</td>
                <td className="p-3">{r.district ? trDistrict(r.district, lang) : "—"}</td>
                <td className="p-3">{r.areca_area_acres != null ? `${r.areca_area_acres} ac` : "—"}</td>
                <td className="p-3">{r.yield_raw_qtl ?? "—"}</td>
                <td className="p-3 font-semibold text-[var(--gt-purple-dark)]">
                  {r.total_income_inr != null ? r.total_income_inr.toLocaleString("en-IN") : "—"}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {r.is_frozen ? (
                    <span className="text-xs font-semibold text-red-600 cursor-not-allowed inline-flex items-center gap-1" title="Frozen — unfreeze to edit" onClick={(e) => e.stopPropagation()}>
                      <Lock size={12} /> Edit
                    </span>
                  ) : (
                    <button
                      className="text-xs font-semibold underline text-green-600"
                      onClick={(e) => { e.stopPropagation(); navigate(editHref); }}
                    >
                      {r.status === "draft" ? "Continue" : tr("edit", lang)}
                    </button>
                  )}
                  {canFreeze && !r.localOnly && r.status !== "draft" && (
                    <button
                      className="ml-3 text-xs font-semibold text-sky-700 underline"
                      onClick={(e) => { e.stopPropagation(); runFreeze([r.id], !r.is_frozen); }}
                    >
                      {r.is_frozen ? "Unfreeze" : "Freeze"}
                    </button>
                  )}
                </td>
              </tr>
              );
            })}
            {displayRows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-[var(--gt-text-muted)]">{tr("noRecords", lang)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onPage={goToPage} onPageSize={changePageSize} loading={loading} noun="records" />
    </div>
  );
}
