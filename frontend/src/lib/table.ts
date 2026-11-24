export interface PageResult<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
}

/** Slice rows for one page. Out-of-range pages are clamped to the nearest valid page. */
export function paginate<T>(rows: T[], page: number, size: number): PageResult<T> {
  const safeSize = Math.max(1, Math.floor(size));
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / safeSize));
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const start = (current - 1) * safeSize;
  const items = rows.slice(start, start + safeSize);
  return { items, page: current, pageCount, total, from: total ? start + 1 : 0, to: start + items.length };
}

/** Page numbers to show in a pager, with "…" for skipped ranges. */
export function pageWindow(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const wanted = [1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount);
  const sorted = [...new Set(wanted)].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}

export function toCsv(headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
