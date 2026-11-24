import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AdminShell } from "@/components/AppShell";
import { KpiCard, PageHeader, Panel, StatusBadge } from "@/components/kit";
import { Activity, CreditCard, Phone, Users } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { useApiCollection, useApiResource } from "@/lib/api";

export const Route = createFileRoute("/admin")({
  head: () => pageHead("Admin Dashboard", "Administrative overview of your contact center."),
  component: AdminDashboard,
});

const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };
const axisStyle = { fontSize: 11, fill: "var(--muted-foreground)" };
const emptyAdmin = { metrics: { callsToday: 0, activeCalls: 0, queueWaiting: 0, missed: 0, agentsAvailable: 0 }, agents: [], volume: [] as Array<{ hour: string; inbound: number; outbound: number; missed: number }> };
const emptyAnalytics = { totals: { calls: 0, resolved: 0, missed: 0, abandoned: 0 }, volume: [] as Array<{ hour: string; inbound: number; outbound: number; missed: number }> };

function AdminDashboard() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { value: overview } = useApiResource("overview?range=today", emptyAdmin);
  const { value: analytics } = useApiResource("analytics?range=today", emptyAnalytics);
  const { items: users } = useApiCollection<{ status?: string }>("users", [], "users");
  const outcomeBreakdown = [
    { name: "Resolved", value: analytics.totals.resolved, color: "var(--chart-1)" },
    { name: "Missed", value: analytics.totals.missed, color: "var(--chart-5)" },
    { name: "Abandoned", value: analytics.totals.abandoned, color: "var(--chart-3)" },
  ].filter((item) => item.value > 0);
  if (pathname !== "/admin") return <Outlet />;

  return (
    <AdminShell>
      <PageHeader title="Admin dashboard" description="Manage organization access, call setup, billing, and settings." />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Team members" value={String(users.length)} icon={Users} hint="Persisted users" />
        <KpiCard label="Active agents" value={String(overview.metrics.agentsAvailable)} icon={Phone} hint="Currently available" />
        <KpiCard label="Open invitations" value={String(users.filter((user) => user.status === "invited").length)} icon={Activity} hint="Awaiting acceptance" />
        <KpiCard label="Organization plan" value="Not configured" icon={CreditCard} hint="Configure billing to view plan" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Call volume by hour" className="xl:col-span-2" action={
          <div className="flex gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-chart-1" />Inbound</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-chart-2" />Outbound</span>
          </div>
        }>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={overview.volume}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="hour" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="inbound" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.18} strokeWidth={2} />
                <Area type="monotone" dataKey="outbound" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.08} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Call outcomes">
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={outcomeBreakdown} dataKey="value" nameKey="name" innerRadius={54} outerRadius={88} paddingAngle={2} stroke="none">
                  {outcomeBreakdown.map((outcome) => <Cell key={outcome.name} fill={outcome.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {outcomeBreakdown.map((outcome) => <span key={outcome.name} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: outcome.color }} />{outcome.name}</span>)}
          </div>
        </Panel>
      </div>
      <Panel title="Organization status" action={<StatusBadge status="Active" />}>
        <p className="text-sm text-muted-foreground">Your workspace is operational. Manage users, call routing, billing, and organization settings from the sections below.</p>
      </Panel>
    </AdminShell>
  );
}
