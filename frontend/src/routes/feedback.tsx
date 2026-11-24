import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MessageSquareQuote, Smile, Star, ThumbsUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { KpiCard, PageHeader, Panel, PrintButton } from "@/components/kit";
import type { Feedback } from "@/lib/domain-types";
import { fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { useApiCollection } from "@/lib/api";

export const Route = createFileRoute("/feedback")({
  head: () => pageHead("Feedback", "Customer satisfaction and NPS survey results after calls."),
  component: FeedbackPage,
});

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex" aria-label={`${n} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={i <= n ? "h-3.5 w-3.5 fill-warning text-warning" : "h-3.5 w-3.5 text-muted-foreground/40"} />)}
    </span>
  );
}

function FeedbackPage() {
  const { items: list } = useApiCollection<Feedback>("feedback", [], "feedback");
  const [score, setScore] = useState("all");
  const rows = list.filter((f) => matches(String(f.csat), score));
  const csat = (list.reduce((s, f) => s + f.csat, 0) / Math.max(1, list.length)).toFixed(1);
  const promoters = list.filter((f) => f.nps >= 9).length;
  const detractors = list.filter((f) => f.nps <= 6).length;
  const nps = Math.round(((promoters - detractors) / Math.max(1, list.length)) * 100);
  const dist = [1, 2, 3, 4, 5].map((n) => ({ stars: `${n}★`, count: list.filter((f) => f.csat === n).length }));

  const columns: Column<Feedback>[] = [
    { id: "at", header: "Date", cell: (f) => <span className="font-mono text-xs">{fmtTime(f.at)}</span>, sortValue: (f) => f.at },
    { id: "customer", header: "Customer", cell: (f) => <span className="font-medium">{f.customer}</span>, sortValue: (f) => f.customer },
    { id: "agent", header: "Agent", cell: (f) => f.agent, sortValue: (f) => f.agent },
    { id: "queue", header: "Queue", cell: (f) => f.queue },
    { id: "csat", header: "Rating", cell: (f) => <Stars n={f.csat} />, sortValue: (f) => f.csat },
    { id: "nps", header: "NPS", cell: (f) => <span className="font-mono">{f.nps}</span>, sortValue: (f) => f.nps },
    { id: "comment", header: "Comment", className: "max-w-[320px]", cell: (f) => <span className="line-clamp-2 text-muted-foreground">{f.comment}</span> },
  ];

  return (
    <AppShell>
      <PageHeader title="Feedback" description="What customers said in the short survey sent after each call." actions={<PrintButton />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Average rating" value={`${csat} / 5`} icon={Star} />
        <KpiCard label="NPS" value={String(nps)} icon={ThumbsUp} />
        <KpiCard label="Responses" value={String(list.length)} icon={MessageSquareQuote} hint="Persisted responses" />
        <KpiCard label="Response rate" value="—" icon={Smile} hint="Not calculated" />
      </div>
      <Panel title="Rating distribution">
        <div className="h-48">
          <ResponsiveContainer>
            <BarChart data={dist}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="stars" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <DataTable label="Feedback" rows={rows} columns={columns} rowKey={(f) => f.id}
        searchText={(f) => `${f.customer} ${f.agent} ${f.comment}`} searchPlaceholder="Search comments…"
        toolbar={<FilterSelect label="Ratings" value={score} onChange={setScore} options={["5", "4", "3", "2", "1"]} />} />
    </AppShell>
  );
}
