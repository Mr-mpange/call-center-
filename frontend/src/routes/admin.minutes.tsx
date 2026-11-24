import { createFileRoute } from "@tanstack/react-router";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AdminShell } from "@/components/AppShell";
import { KpiCard, PageHeader, Panel } from "@/components/kit";
import { Clock, PhoneCall } from "lucide-react";
import type { CallRecord } from "@/lib/domain-types";
import { useApiCollection } from "@/lib/api";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/admin/minutes")({
  head: () => pageHead("Minutes Used", "Daily call minutes used across the contact center."),
  component: MinutesUsedPage,
});

const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };
const axisStyle = { fontSize: 11, fill: "var(--muted-foreground)" };

function MinutesUsedPage() {
  const { items: calls } = useApiCollection<CallRecord>("calls", [], "calls");
  const dailyUsage = Object.values(calls.reduce<Record<string, { date: string; minutes: number; calls: number }>>((days, call) => {
    const date = call.at.slice(0, 10);
    const day = days[date] ??= { date, minutes: 0, calls: 0 };
    day.minutes += call.durationSec / 60;
    day.calls += 1;
    return days;
  }, {})).sort((a, b) => a.date.localeCompare(b.date)).map((day) => ({ ...day, label: new Date(`${day.date}T00:00:00`).toLocaleDateString("en-TZ", { weekday: "short", day: "numeric", month: "short" }) }));
  const totalMinutes = dailyUsage.reduce((total, day) => total + day.minutes, 0);
  const totalCalls = dailyUsage.reduce((total, day) => total + day.calls, 0);
  const averageMinutes = dailyUsage.length ? totalMinutes / dailyUsage.length : 0;
  return (
    <AdminShell>
      <PageHeader title="Minutes used" description="Daily call duration totals across the contact center." />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <KpiCard label="Total minutes" value={Math.round(totalMinutes).toLocaleString()} icon={Clock} hint="In displayed call history" />
        <KpiCard label="Calls counted" value={totalCalls.toLocaleString()} icon={PhoneCall} hint="Includes completed calls" />
        <KpiCard label="Daily average" value={averageMinutes.toFixed(0)} icon={Clock} hint="Minutes per day" />
      </div>
      <Panel title="Minutes used per day">
        <div className="h-80">
          <ResponsiveContainer>
            <LineChart data={dailyUsage} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={42} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${Number(value).toFixed(1)} min`, "Minutes"]} />
              <Line type="monotone" dataKey="minutes" name="Minutes used" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--chart-1)" }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </AdminShell>
  );
}
