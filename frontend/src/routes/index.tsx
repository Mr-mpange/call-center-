import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Clock, Hourglass, Mail, Phone, PhoneCall, PhoneMissed, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { KpiCard, PageHeader, Panel, PrintButton, StatusBadge } from "@/components/kit";
import { usePhone } from "@/components/phone/PhoneProvider";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { TODAY_FILTER, dashboardDateParams, type DateFilterValue } from "@/components/date-range";
import { initials } from "@/lib/phone";
import type { CallRecord, Contact, Voicemail } from "@/lib/domain-types";
import { fmtDuration, fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { useApiCollection, useApiResource } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => pageHead("Overview", "Operational overview of calls, queues and agents."),
  component: Overview,
});

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};
const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
type OverviewData = {
  metrics: {
    callsToday: number;
    activeCalls: number;
    queueWaiting: number;
    missed: number;
    agentsAvailable: number;
  };
  liveCalls: unknown[];
  recentCalls: CallRecord[];
  agents: Array<{ id: string; name: string; status: string }>;
  queues: Array<{
    id: string;
    name: string;
    waiting: number;
    longestWaitSec: number;
    slaTargetSec: number;
  }>;
  volume: Array<{ hour: string; inbound: number; outbound: number; missed: number }>;
};
const emptyOverview: OverviewData = {
  metrics: { callsToday: 0, activeCalls: 0, queueWaiting: 0, missed: 0, agentsAvailable: 0 },
  liveCalls: [],
  recentCalls: [],
  agents: [],
  queues: [],
  volume: [],
};

function Overview() {
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(TODAY_FILTER);
  const [canViewIntegrations, setCanViewIntegrations] = useState(false);
  const phone = usePhone();
  useEffect(() => {
    try {
      const user = JSON.parse(window.localStorage.getItem("mpange.auth.user") ?? "null") as { role?: string } | null;
      setCanViewIntegrations(user?.role === "Org Admin" || user?.role === "Platform Admin");
    } catch {
      setCanViewIntegrations(false);
    }
  }, []);
  const { value: overview } = useApiResource<OverviewData>(
    `overview?${dashboardDateParams(dateFilter)}`,
    emptyOverview,
  );
  const { items: contacts } = useApiCollection<Contact>("contacts", [], "contacts");
  const { items: voicemails } = useApiCollection<Voicemail>("voicemails", [], "voicemails");
  const { items: integrations } = useApiCollection<{ id: string; name: string; status: string }>(
    "integrations",
    [],
    "integrations",
    canViewIntegrations,
  );
  const count = (s: string) => overview.agents.filter((a) => a.status === s).length;
  const displayCustomer = (value: string | undefined) =>
    value && !/^unknown caller$/i.test(value) ? value : "Customer";
  const outcomeCounts = ["resolved", "missed", "abandoned", "escalated", "voicemail"]
    .map((name) => ({
      name,
      value: overview.recentCalls.filter((call) => call.outcome === name).length,
      color:
        name === "resolved"
          ? "var(--chart-1)"
          : name === "missed"
            ? "var(--chart-5)"
            : "var(--chart-3)",
    }))
    .filter((item) => item.value > 0);
  const resolvedRate = overview.recentCalls.length
    ? Math.round(
        (overview.recentCalls.filter((call) => call.outcome === "resolved").length /
          overview.recentCalls.length) *
          100,
      )
    : 0;

  const columns: Column<CallRecord>[] = [
    {
      id: "at",
      header: "Time",
      cell: (c) => <span className="font-mono text-xs">{fmtTime(c.at)}</span>,
      sortValue: (c) => c.at,
    },
    {
      id: "caller",
      header: "Caller",
      cell: (c) => (
        <span>
          <span className="block font-medium">{displayCustomer(c.caller)}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{c.phone}</span>
        </span>
      ),
      sortValue: (c) => c.caller,
    },
    { id: "dir", header: "Type", cell: (c) => <StatusBadge status={c.direction} /> },
    {
      id: "queue",
      header: "Queue",
      cell: (c) => <span className="text-muted-foreground">{c.queue || "General"}</span>,
      sortValue: (c) => c.queue || "General",
    },
    {
      id: "agent",
      header: "Agent",
      cell: (c) => c.agent || "Unassigned",
      sortValue: (c) => c.agent || "Unassigned",
    },
    {
      id: "dur",
      header: "Duration",
      cell: (c) => <span className="font-mono text-xs">{fmtDuration(c.durationSec)}</span>,
      sortValue: (c) => c.durationSec,
    },
    { id: "outcome", header: "Outcome", cell: (c) => <StatusBadge status={c.outcome} /> },
    {
      id: "act",
      header: "",
      className: "text-right",
      cell: (c) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => phone.dial(c.phone, c.caller)}
          aria-label={`Call back ${c.caller}`}
        >
          <Phone className="h-3.5 w-3.5" /> Call back
        </Button>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Operational overview"
        description="Current performance from your persisted contact-center data."
        actions={
          <>
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
            <PrintButton />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Calls handled"
          value={String(overview.metrics.callsToday)}
          icon={PhoneCall}
          hint={dateFilter.label}
        />
        <KpiCard
          label="Active now"
          value={String(overview.metrics.activeCalls)}
          icon={Phone}
          hint="Live calls"
        />
        <KpiCard
          label="In queue"
          value={String(overview.metrics.queueWaiting)}
          icon={Hourglass}
          goodWhen="down"
          hint="Current queue depth"
        />
        <KpiCard
          label="Missed / abandoned"
          value={String(overview.metrics.missed)}
          icon={PhoneMissed}
          goodWhen="down"
        />
        <KpiCard
          label="New voicemail"
          value={String(voicemails.filter((item) => !item.heard).length)}
          icon={Mail}
          hint="Needs review"
        />
        <KpiCard
          label="Avg wait"
          value={fmtDuration(0)}
          icon={Clock}
          goodWhen="down"
          hint="No wait-time aggregate"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Call volume by hour"
          className="xl:col-span-2"
          action={
            <div className="flex gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-chart-1" />
                Inbound
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-chart-2" />
                Outbound
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-chart-5" />
                Missed
              </span>
            </div>
          }
        >
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={overview.volume}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="hour" tick={axis} axisLine={false} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="inbound"
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={0.18}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="outbound"
                  stroke="var(--chart-2)"
                  fill="var(--chart-2)"
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="missed"
                  stroke="var(--chart-5)"
                  fill="transparent"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Call outcomes">
          <div className="relative h-44">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={outcomeCounts}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                >
                  {outcomeCounts.map((o) => (
                    <Cell key={o.name} fill={o.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="font-display text-xl font-semibold">{resolvedRate}%</p>
                <p className="text-[11px] text-muted-foreground">resolved</p>
              </div>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {outcomeCounts.map((o) => (
              <li key={o.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: o.color }} />
                  {o.name}
                </span>
                <span className="font-mono text-xs">{o.value}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Queue performance"
          action={
            <Link to="/queue" className="text-xs font-medium text-primary hover:underline">
              Manage
            </Link>
          }
        >
          <ul className="space-y-4">
            {overview.queues.map((q) => {
              const pct = Math.min(100, (q.longestWaitSec / q.slaTargetSec) * 50);
              const breach = q.longestWaitSec > q.slaTargetSec;
              return (
                <li key={q.id}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{q.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {q.waiting} waiting · {fmtDuration(q.longestWaitSec)}
                    </span>
                  </div>
                  <div className="soft-progress-track mt-1.5 h-2 rounded-full">
                    <div
                      className={
                        breach
                          ? "soft-progress-fill h-full rounded-full bg-destructive"
                          : "soft-progress-fill h-full rounded-full bg-primary"
                      }
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel
          title="Agent availability"
          action={
            <Link to="/agents" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          }
        >
          <div className="space-y-1">
            {[
              ["available", "Available"],
              ["break", "Break"],
              ["on-call", "On Call"],
              ["offline", "Offline"],
            ].map(([status, label]) => (
              <div
                key={status}
                className="flex items-center justify-between border-b border-border/30 py-2.5 last:border-b-0"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground" aria-hidden>
                    •
                  </span>
                  {label}
                </span>
                <span className="font-display text-xl font-semibold">{count(status)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {overview.agents.length} agents
          </p>
        </Panel>

        <Panel
          title="Quick dial"
          action={
            <button
              onClick={() => phone.setOpen(true)}
              className="soft-button rounded-xl bg-background px-2 py-1 text-xs font-medium text-primary"
            >
              Open keypad
            </button>
          }
        >
          <ul className="space-y-1">
            {contacts
              .filter((c) => !c.doNotCall)
              .slice(0, 5)
              .map((c) => (
                <li
                  key={c.id}
                  className="soft-nav-item flex items-center gap-3 rounded-xl px-1.5 py-1.5 hover:text-foreground"
                >
                  <span className="soft-icon h-8 w-8 text-[11px] font-semibold text-accent-foreground">
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{c.phone}</span>
                  </span>
                  <button
                    onClick={() => phone.dial(c.phone, c.name)}
                    aria-label={`Call ${c.name}`}
                    className="soft-button soft-icon h-8 w-8 bg-success text-success-foreground hover:opacity-90"
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
          </ul>
        </Panel>

        <Panel
          title="Voicemail"
          action={
            <Link to="/voicemail" className="text-xs font-medium text-primary hover:underline">
              Open inbox
            </Link>
          }
        >
          <ul className="space-y-1">
            {voicemails.slice(0, 5).map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 border-b border-border/30 py-2.5 last:border-b-0"
              >
                <span className="soft-icon h-8 w-8 shrink-0 text-accent-foreground">
                  <Mail className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.from}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {item.phone}
                  </span>
                </span>
                <StatusBadge status={item.heard ? "heard" : "new"} />
              </li>
            ))}
          </ul>
          {voicemails.length === 0 && (
            <p className="text-sm text-muted-foreground">No voicemails yet.</p>
          )}
        </Panel>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent calls</h2>
          <Link to="/history" className="text-xs font-medium text-primary hover:underline">
            Full call history
          </Link>
        </div>
        <DataTable
          label="Recent calls"
          rows={overview.recentCalls.slice(0, 30)}
          columns={columns}
          rowKey={(c) => c.id}
          pageSize={5}
          searchText={(c) => `${c.caller} ${c.agent} ${c.queue} ${c.phone}`}
          searchPlaceholder="Filter recent calls…"
        />
      </section>

      <Panel title="System health">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          {integrations.length ? (
            integrations.map((integration) => (
              <Link
                key={integration.id}
                to="/integrations"
                className="soft-inner-panel flex items-center justify-between rounded-xl p-3 hover:text-foreground"
              >
                <span>{integration.name}</span>
                <StatusBadge status={integration.status} />
              </Link>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No integrations are configured.</p>
          )}
        </div>
      </Panel>
    </AppShell>
  );
}
