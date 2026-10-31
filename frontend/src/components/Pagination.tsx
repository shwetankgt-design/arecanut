import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PAGE_SIZES, pageWindow } from "../lib/paging";

interface Props {
  page: number; // 1-based
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  loading?: boolean;
  noun?: string;
}

// Shared pagination bar: "Showing 21–40 of 534", page-size selector, first/prev/numbers/next/last.
// Renders nothing for lists that fit on one page at the smallest page size.
export default function Pagination({ page, pageSize, total, onPage, onPageSize, loading, noun = "records" }: Props) {
  if (total <= PAGE_SIZES[0]) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = "h-8 min-w-8 px-2 rounded-lg text-xs font-medium border border-[var(--gt-border)] bg-white text-[var(--gt-text)] hover:bg-[#F6F4F9] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--gt-text-muted)] pt-1">
      <div className="flex items-center gap-3">
        <span>Showing <b className="text-[var(--gt-text)]">{from}–{to}</b> of <b className="text-[var(--gt-text)]">{total.toLocaleString("en-IN")}</b> {noun}{loading ? " · loading…" : ""}</span>
        <label className="flex items-center gap-1.5">
          Rows per page
          <select className="gt-input !w-auto !py-1 !px-2 text-xs" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} onClick={() => onPage(1)} disabled={page <= 1} aria-label="First page"><ChevronsLeft size={14} /></button>
        <button type="button" className={btn} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={14} /></button>
        {pageWindow(page, pages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1">…</span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
              className={`${btn} ${p === page ? "!bg-[var(--gt-purple)] !text-white !border-[var(--gt-purple)]" : ""}`}
            >
              {p}
            </button>
          )
        )}
        <button type="button" className={btn} onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight size={14} /></button>
        <button type="button" className={btn} onClick={() => onPage(pages)} disabled={page >= pages} aria-label="Last page"><ChevronsRight size={14} /></button>
      </div>
    </nav>
  );
}
