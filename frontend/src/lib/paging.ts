export const PAGE_SIZES = [20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;

// Compact page list with ellipses: 1 … 4 5 [6] 7 8 … 40
export function pageWindow(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pages - 1, page + 1);
  if (lo > 2) out.push("…");
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < pages - 1) out.push("…");
  out.push(pages);
  return out;
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize);
}
