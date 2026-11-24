import { useEffect, useState, type ReactNode } from "react";
import { Inbox, Printer, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/40 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section data-print-panel className={cn("soft-card rounded-[22px]", className)}>
      {title && (
        <header className="soft-section-header flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="min-w-0 flex-1 break-words text-sm font-semibold text-card-foreground">{title}</h2>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const bar = {
    default: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
  }[tone];
  return (
    <div
      data-print-card
      className="soft-card relative overflow-hidden rounded-[20px] p-4"
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", bar)} aria-hidden />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold text-card-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const toneMap: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-primary",
  neutral: "text-muted-foreground",
};

const statusTone: Record<string, keyof typeof toneMap> = {
  available: "success",
  resolved: "success",
  connected: "success",
  "in-progress": "info",
  "on-call": "info",
  ringing: "warning",
  "on-hold": "warning",
  break: "warning",
  escalated: "warning",
  unverified: "warning",
  "wrap-up": "neutral",
  offline: "neutral",
  voicemail: "neutral",
  "not configured": "neutral",
  disabled: "neutral",
  missed: "danger",
  abandoned: "danger",
  error: "danger",
  high: "danger",
  normal: "info",
  low: "neutral",
  planned: "neutral",
  running: "success",
  active: "success",
  completed: "success",
  paused: "warning",
  scheduled: "info",
  draft: "neutral",
  inbound: "info",
  outbound: "neutral",
  transferred: "info",
  declined: "danger",
  cancelled: "neutral",
  yes: "success",
  no: "danger",
  open: "info",
  invited: "info",
  paid: "success",
  due: "warning",
  overdue: "danger",
  heard: "neutral",
  new: "info",
  on: "success",
  off: "neutral",
  "do not call": "danger",
  consented: "success",
  "no consent": "warning",
};

export function StatusBadge({ status, tone }: { status: string; tone?: keyof typeof toneMap }) {
  const t = tone ?? statusTone[status.toLowerCase()] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center text-xs font-medium capitalize",
        toneMap[t],
      )}
    >
      {status.replace(/-/g, " ")}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface-recessed flex flex-col items-center justify-center rounded-[18px] px-6 py-12 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  delta,
  goodWhen = "up",
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  delta?: number | undefined;
  goodWhen?: "up" | "down";
  hint?: string | undefined;
}) {
  const good = delta === undefined ? true : goodWhen === "up" ? delta >= 0 : delta <= 0;
  const Trend = (delta ?? 0) >= 0 ? TrendingUp : TrendingDown;
  return (
    <div data-print-card className="soft-card group rounded-[20px] p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className="soft-icon h-9 w-9 text-accent-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-card-foreground">
        {value}
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta !== undefined && (
          <span
            className={cn(
              "surface-flat inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium",
              good ? "bg-success-soft text-success" : "bg-danger-soft text-destructive",
            )}
          >
            <Trend className="h-3 w-3" aria-hidden />
            {delta > 0 ? "+" : ""}
            {delta}%
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

export function FilterSelectLabel({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

/** Opens the browser print dialog; menus, phone and pagers are hidden and tables print every row. */
export function PrintButton({ label = "Print", className }: { label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn(
        "soft-button inline-flex h-9 items-center gap-2 rounded-xl border-0 bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted",
        className,
      )}
    >
      <Printer className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

/** Title + timestamp shown only on paper. */
export function PrintHeader() {
  const [stamp, setStamp] = useState("");
  useEffect(() => {
    const set = () => setStamp(new Date().toLocaleString());
    set();
    window.addEventListener("beforeprint", set);
    return () => window.removeEventListener("beforeprint", set);
  }, []);
  return (
    <div
      data-print-only
      className="hidden border-b border-border pb-3 text-center text-xs text-muted-foreground"
    >
      <div className="mb-1 flex items-center justify-center gap-2">
        <span
          className="soft-icon h-8 w-8 bg-primary font-display text-sm font-bold text-primary-foreground"
          aria-hidden
        >
          M
        </span>
        <div className="text-left">
          <p className="font-display text-sm font-semibold tracking-wide text-foreground">
            MPANGE TECHNOLOGY SOLUTION Ltd
          </p>
          <p className="text-[10px] text-muted-foreground">AI Call Center</p>
        </div>
      </div>
      <p>Printed {stamp}</p>
    </div>
  );
}
