import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { paginate, pageWindow } from "@/lib/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: ((row: T) => string | number) | undefined;
  className?: string | undefined;
}

interface Props<T> {
  label: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchText?: ((row: T) => string) | undefined;
  searchPlaceholder?: string | undefined;
  initialQuery?: string | undefined;
  pageSize?: number | undefined;
  pageSizes?: number[] | undefined;
  toolbar?: ReactNode;
  onRowClick?: ((row: T) => void) | undefined;
  emptyMessage?: string | undefined;
  className?: string | undefined;
}

export function DataTable<T>({
  label,
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = "Search…",
  initialQuery = "",
  pageSize = 10,
  pageSizes = [5, 10, 25, 50],
  toolbar,
  onRowClick,
  emptyMessage = "No records match your filters.",
  className,
}: Props<T>) {
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const on = () => setPrinting(true);
    const off = () => setPrinting(false);
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
    };
  }, []);

  const filtered = useMemo(() => {
    let r = rows;
    const q = query.trim().toLowerCase();
    if (searchText && q) r = r.filter((x) => searchText(x).toLowerCase().includes(q));
    const col = sort ? columns.find((c) => c.id === sort.id) : undefined;
    if (sort && col?.sortValue) {
      const get = col.sortValue;
      r = [...r].sort((a, b) => {
        const va = get(a),
          vb = get(b);
        const c = va < vb ? -1 : va > vb ? 1 : 0;
        return sort.dir === "asc" ? c : -c;
      });
    }
    return r;
  }, [rows, query, sort, columns, searchText]);

  const p = paginate(filtered, page, size);
  const visible = printing ? filtered : p.items;
  const sizes = pageSizes.includes(size) ? pageSizes : [...pageSizes, size].sort((a, b) => a - b);

  function toggleSort(id: string) {
    setSort((s) =>
      s?.id !== id ? { id, dir: "asc" } : s.dir === "asc" ? { id, dir: "desc" } : null,
    );
  }

  const pagerBtn =
    "soft-button grid h-9 min-w-9 place-items-center rounded-full border-0 bg-background px-2 text-xs font-medium text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className={cn("soft-table-shell overflow-hidden rounded-[22px]", className)}>
      {(searchText || toolbar) && (
        <div
          data-print-hide
          className="soft-section-header flex flex-col items-stretch gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4"
        >
          {searchText && (
            <div className="relative w-full sm:w-64">
              <Search
                className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={searchPlaceholder}
                aria-label={`Search ${label}`}
                className="h-9 pl-8"
              />
            </div>
          )}
          {toolbar && (
            <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
              {toolbar}
            </div>
          )}
        </div>
      )}
      <Table aria-label={label}>
        <TableHeader>
          <TableRow className="soft-table-header-row hover:bg-transparent">
            {columns.map((c) => {
              const active = sort?.id === c.id;
              const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <TableHead
                  key={c.id}
                  className={cn(
                    "h-10 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                    c.className,
                  )}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.id)}
                      className="soft-table-sort inline-flex items-center gap-1 uppercase"
                    >
                      {c.header}
                      <Icon className={cn("h-3 w-3", !active && "opacity-40")} aria-hidden />
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length ? (
            visible.map((r) => (
              <TableRow
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn("soft-table-data-row", onRowClick && "cursor-pointer")}
              >
                {columns.map((c) => (
                  <TableCell key={c.id} className={cn("py-2.5", c.className)}>
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="h-32 text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div
        data-print-hide
        className="soft-table-footer flex flex-col gap-3 px-3 py-2.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
      >
        <p>
          Showing{" "}
          <span className="font-mono font-medium text-foreground">
            {p.from}–{p.to}
          </span>{" "}
          of <span className="font-mono font-medium text-foreground">{p.total}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span>Rows</span>
            <Select
              value={String(size)}
              onValueChange={(v) => {
                setSize(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[70px]" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <nav aria-label={`${label} pages`} className="flex items-center gap-1">
            <button
              type="button"
              className={pagerBtn}
              onClick={() => setPage(1)}
              disabled={p.page === 1}
              aria-label="First page"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={pagerBtn}
              onClick={() => setPage(p.page - 1)}
              disabled={p.page === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            {pageWindow(p.page, p.pageCount).map((n, i) =>
              n === "…" ? (
                <span key={`gap-${i}`} className="px-1">
                  …
                </span>
              ) : (
                <button
                  type="button"
                  key={n}
                  onClick={() => setPage(n)}
                  aria-current={n === p.page ? "page" : undefined}
                  className={cn(
                    pagerBtn,
                    n === p.page && "surface-recessed text-primary hover:bg-transparent",
                  )}
                >
                  {n}
                </button>
              ),
            )}
            <button
              type="button"
              className={pagerBtn}
              onClick={() => setPage(p.page + 1)}
              disabled={p.page === p.pageCount}
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={pagerBtn}
              onClick={() => setPage(p.pageCount)}
              disabled={p.page === p.pageCount}
              aria-label="Last page"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}
