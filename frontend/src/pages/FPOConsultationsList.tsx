import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, FileEdit, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import Pagination from "../components/Pagination";
import { PAGE_SIZES, DEFAULT_PAGE_SIZE } from "../lib/paging";

interface Row {
  id: number;
  status: string;
  fpo_name: string | null;
  district: string | null;
  respondent_name: string | null;
  created_at: string;
  updated_at: string;
}

const TABS = [
  { key: "", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "submitted", label: "Submitted" },
];

export default function FPOConsultationsList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Server-side paging; tab, page and page size live in the URL so refresh/back keep the place.
  const status = searchParams.get("status") || "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const rawSize = Number(searchParams.get("page_size"));
  const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE;

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    setSearchParams(next);
  };

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = { limit: String(pageSize), offset: String((page - 1) * pageSize) };
    if (status) params.status = status;
    api.listFpoConsultationsPaged(params)
      .then(({ items, total: t }) => {
        if (items.length === 0 && t > 0 && page > 1) { update({ page: String(Math.ceil(t / pageSize)) }); return; }
        setRows(items);
        setTotal(t);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page, pageSize]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">FPO Consultations</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">Resume a draft or review a completed consultation. {total.toLocaleString("en-IN")} in this view.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/entry/fpo")}
          className="flex items-center gap-1.5 bg-[var(--gt-purple)] text-white px-3 py-2 rounded-lg text-sm font-semibold shrink-0"
        >
          <Plus size={16} /> New
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => update({ status: t.key || null, page: null })}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              status === t.key ? "gt-gradient text-white border-transparent shadow-sm" : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const isDraft = r.status === "draft";
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => navigate(`/entry/fpo?id=${r.id}`)}
              className="gt-card p-3 text-left flex items-center gap-3 hover:border-[var(--gt-purple)] border border-transparent transition-colors"
            >
              {isDraft ? <FileEdit size={18} className="text-amber-500 shrink-0" /> : <CheckCircle2 size={18} className="text-[var(--gt-success)] shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{r.fpo_name || (isDraft ? "(FPO name not yet entered)" : "—")}</div>
                <div className="text-xs text-[var(--gt-text-muted)]">
                  {r.district || "—"} · {r.respondent_name ? `respondent ${r.respondent_name} · ` : ""}
                  {isDraft ? "last saved" : "submitted"} {new Date(r.updated_at).toLocaleString()}
                </div>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${isDraft ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>
                {isDraft ? "Draft" : "Submitted"}
              </span>
            </button>
          );
        })}
        {!loading && rows.length === 0 && (
          <div className="text-sm text-[var(--gt-text-muted)] px-1 py-4">
            {status === "draft" ? "No drafts in progress." : status === "submitted" ? "No submitted consultations yet." : "No FPO consultations yet."}
          </div>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        loading={loading}
        noun="consultations"
        onPage={(p) => { update({ page: String(p) }); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        onPageSize={(s) => update({ page_size: String(s), page: null })}
      />
    </div>
  );
}
