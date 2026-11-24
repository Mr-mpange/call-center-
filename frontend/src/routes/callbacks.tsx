import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { KpiCard, PageHeader, StatusBadge } from "@/components/kit";
import { usePhone } from "@/components/phone/PhoneProvider";
import { Button } from "@/components/ui/button";
import type { Callback } from "@/lib/domain-types";
import { fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { apiPatch, apiPost, useApiCollection } from "@/lib/api";

export const Route = createFileRoute("/callbacks")({
  head: () => pageHead("Callbacks", "Scheduled customer callbacks and follow-ups."),
  component: CallbacksPage,
});

function CallbacksPage() {
  const phone = usePhone();
  const { items: list, setItems: setList } = useApiCollection<Callback>("callbacks", [], "callbacks");
  const [status, setStatus] = useState("scheduled");
  const rows = list.filter((c) => matches(c.status, status));

  async function call(c: Callback) {
    if (!await phone.dial(c.phone, c.customer)) return;
    try { await apiPatch(`callbacks/${c.id}`, { attempts: c.attempts + 1 }); } catch (error) { toast.error(error instanceof Error ? error.message : "Callback attempt was not saved"); return; }
    setList((l) => l.map((x) => (x.id === c.id ? { ...x, attempts: x.attempts + 1 } : x)));
  }
  async function done(c: Callback) {
    try { await apiPost(`callbacks/${c.id}/complete`); } catch (error) { toast.error(error instanceof Error ? error.message : "Callback was not completed"); return; }
    setList((l) => l.map((x) => (x.id === c.id ? { ...x, status: "completed" } : x)));
    toast.success(`Callback to ${c.customer} completed`);
  }

  const columns: Column<Callback>[] = [
    { id: "due", header: "Due", cell: (c) => <span className="font-mono text-xs">{fmtTime(c.due)}</span>, sortValue: (c) => c.due },
    { id: "customer", header: "Customer", cell: (c) => <span><span className="block font-medium">{c.customer}</span><span className="font-mono text-[11px] text-muted-foreground">{c.phone}</span></span>, sortValue: (c) => c.customer },
    { id: "reason", header: "Reason", cell: (c) => <span className="text-muted-foreground">{c.reason}</span> },
    { id: "lang", header: "Language", cell: (c) => c.language, sortValue: (c) => c.language },
    { id: "agent", header: "Agent", cell: (c) => c.agent, sortValue: (c) => c.agent },
    { id: "attempts", header: "Attempts", cell: (c) => <span className="font-mono">{c.attempts}</span>, sortValue: (c) => c.attempts },
    { id: "status", header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
    { id: "act", header: "", className: "text-right", cell: (c) => c.status === "scheduled" ? (
      <div className="flex justify-end gap-1">
        <Button size="sm" onClick={() => call(c)}><PhoneOutgoing className="h-3.5 w-3.5" /> Call now</Button>
        <Button size="sm" variant="outline" onClick={() => done(c)}>Done</Button>
      </div>
    ) : null },
  ];

  return (
    <AppShell>
      <PageHeader title="Callbacks" description="Customers waiting for a call back from the team." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Scheduled" value={String(list.filter((c) => c.status === "scheduled").length)} icon={CalendarClock} />
        <KpiCard label="Completed today" value={String(list.filter((c) => c.status === "completed").length)} icon={CheckCircle2} />
        <KpiCard label="Missed" value={String(list.filter((c) => c.status === "missed").length)} icon={PhoneMissed} goodWhen="down" />
        <KpiCard label="Kiswahili requests" value={`${Math.round((list.filter((c) => c.language === "Kiswahili").length / list.length) * 100)}%`} icon={PhoneOutgoing} />
      </div>
      <DataTable label="Callbacks" rows={rows} columns={columns} rowKey={(c) => c.id}
        searchText={(c) => `${c.customer} ${c.phone} ${c.reason} ${c.agent}`} searchPlaceholder="Search callbacks…"
        toolbar={<FilterSelect label="Statuses" value={status} onChange={setStatus} options={["scheduled", "completed", "missed", "cancelled"]} />} />
    </AppShell>
  );
}
