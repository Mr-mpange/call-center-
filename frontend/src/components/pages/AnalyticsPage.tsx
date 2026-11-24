import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Clock, Download, PhoneIncoming, PhoneMissed, Timer } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { FOURTEEN_DAY_FILTER, dashboardDateParams, type DateFilterValue } from "@/components/date-range";
import { KpiCard, PageHeader, Panel, PrintButton } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { fmtDuration } from "@/lib/format";
import { downloadText, toCsv } from "@/lib/table";
import { useApiResource } from "@/lib/api";

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};
type Perf = { id: string; name: string; team: string; callsToday: number; avgHandle: number; csat: number; fcr: number; occupancy: number };
type AnalyticsData = { totals: { calls: number; missed: number; resolved: number; abandoned: number }; answerRate: number; agentPerformance: Perf[]; byQueue: Array<{ id?: string; queue: string; calls: number; resolved: number; missed: number }>; volume: Array<{ hour: string; inbound: number; outbound: number; missed: number }> };
const emptyAnalytics: AnalyticsData = { totals: { calls: 0, missed: 0, resolved: 0, abandoned: 0 }, answerRate: 0, agentPerformance: [], byQueue: [], volume: [] };

export function AnalyticsPage() {
  const [dateFilter, setDateFilter] = useState<DateFilterValue>(FOURTEEN_DAY_FILTER);
  const { value: analytics } = useApiResource<AnalyticsData>(`analytics?${dashboardDateParams(dateFilter)}`, emptyAnalytics);
  const handled = analytics.totals.calls;
  const missed = analytics.totals.missed;
  const avgSla = analytics.answerRate;
  const avgAht = analytics.agentPerformance.length ? Math.round(analytics.agentPerformance.reduce((sum, agent) => sum + agent.avgHandle, 0) / analytics.agentPerformance.length) : 0;
  const exportReport = () => {
    if (!analytics.totals.calls) {
      toast.info("There is no data in the selected range to export.");
      return;
    }
    downloadText("analytics.csv", toCsv(["Metric", "Value"], [["Calls", handled], ["Missed", missed], ["Answer rate", `${analytics.answerRate}%`], ["Average handle seconds", avgAht]]));
  };

  const columns: Column<Perf>[] = [
    {
      id: "name",
      header: "Agent",
      cell: (a) => (
        <span>
          <span className="block font-medium">{a.name}</span>
          <span className="text-[11px] text-muted-foreground">{a.team}</span>
        </span>
      ),
      sortValue: (a) => a.name,
    },
    {
      id: "calls",
      header: "Calls",
      className: "text-right",
      cell: (a) => <span className="font-mono">{a.callsToday}</span>,
      sortValue: (a) => a.callsToday,
    },
    {
      id: "aht",
      header: "Avg handle",
      className: "text-right",
      cell: (a) => <span className="font-mono text-xs">{fmtDuration(a.avgHandle)}</span>,
      sortValue: (a) => a.avgHandle,
    },
    {
      id: "csat",
      header: "CSAT",
      className: "text-right",
      cell: (a) => <span className="font-mono text-xs">{a.csat.toFixed(1)} / 5</span>,
      sortValue: (a) => a.csat,
    },
    {
      id: "fcr",
      header: "Solved first call",
      cell: (a) => (
        <div className="w-28">
          <Progress value={a.fcr} className="h-1.5" />
          <span className="font-mono text-[11px] text-muted-foreground">{a.fcr}%</span>
        </div>
      ),
      sortValue: (a) => a.fcr,
    },
    {
      id: "occ",
      header: "Busy time",
      cell: (a) => (
        <div className="w-28">
          <Progress value={a.occupancy} className="h-1.5" />
          <span className="font-mono text-[11px] text-muted-foreground">{a.occupancy}%</span>
        </div>
      ),
      sortValue: (a) => a.occupancy,
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Analytics"
        description="How many calls came in, how fast they were answered and how each agent performed."
        actions={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <span data-print-only className="hidden text-sm">
              Range: {dateFilter.label}
            </span>
            <span data-print-hide className="col-span-2 w-full sm:col-span-1 sm:w-auto">
              <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
            </span>
            <PrintButton label="Print report" className="w-full sm:w-auto" />
            <Button
              variant="outline"
              onClick={exportReport}
              className="w-full sm:w-auto"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Calls handled (week)"
          value={handled.toLocaleString()}
          icon={PhoneIncoming}
        />
        <KpiCard
          label="Missed calls (week)"
          value={missed.toLocaleString()}
          icon={PhoneMissed}
          goodWhen="down"
        />
        <KpiCard
          label="Answered on time"
          value={`${avgSla}%`}
          icon={Clock}
          hint="target 85%"
        />
        <KpiCard
          label="Avg handle time"
          value={fmtDuration(avgAht)}
          icon={Timer}
          goodWhen="down"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Call volume by hour" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={analytics.volume}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="hour" tick={axis} axisLine={false} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="inbound" stackId="a" fill="var(--chart-1)" />
                <Bar dataKey="outbound" stackId="a" fill="var(--chart-2)" />
                <Bar dataKey="missed" stackId="a" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Caller language"><p className="text-sm text-muted-foreground">Language analytics are unavailable until calls include language metadata.</p></Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Calls by hour (today)">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={analytics.volume}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="hour" tick={axis} axisLine={false} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="inbound" stackId="a" fill="var(--chart-1)" />
                <Bar dataKey="outbound" stackId="a" fill="var(--chart-2)" />
                <Bar dataKey="missed" stackId="a" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Queues right now">
          <ul className="space-y-4">
            {analytics.byQueue.map((q) => {
              const pct = q.calls ? Math.min(100, Math.round((q.missed / q.calls) * 100)) : 0;
              return (
                <li key={q.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{q.queue}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {q.calls} calls · {q.missed} missed
                    </span>
                  </div>
                  <Progress value={pct} className="mt-1.5 h-2" />
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <DataTable
        label="Agent performance"
            rows={analytics.agentPerformance}
        columns={columns}
        rowKey={(a) => a.id}
        searchText={(a) => `${a.name} ${a.team}`}
        searchPlaceholder="Search agents…"
      />
    </AppShell>
  );
}
