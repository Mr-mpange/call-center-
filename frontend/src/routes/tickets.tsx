import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, Inbox, Phone } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { KpiCard, PageHeader, StatusBadge } from "@/components/kit";
import { usePhone } from "@/components/phone/PhoneProvider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Ticket, TicketStatus } from "@/lib/domain-types";
import { fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { apiPatch, useApiCollection } from "@/lib/api";

export const Route = createFileRoute("/tickets")({
  head: () => pageHead("Tickets", "Customer issues raised from calls, SMS and WhatsApp."),
  component: TicketsPage,
});

function TicketsPage() {
  const phone = usePhone();
  const { items: list, setItems: setList } = useApiCollection<Ticket>("tickets", [], "tickets");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const rows = list.filter((t) => matches(t.status, status) && matches(t.priority, priority));
  const count = (s: TicketStatus) => list.filter((t) => t.status === s).length;

  async function move(t: Ticket, s: TicketStatus) {
    try { await apiPatch(`tickets/${t.id}`, { status: s }); } catch (error) { toast.error(error instanceof Error ? error.message : "Ticket status was not saved"); return; }
    setList((l) => l.map((x) => (x.id === t.id ? { ...x, status: s } : x)));
    toast.success(`${t.id} marked ${s.replace("-", " ")}`);
  }

  const columns: Column<Ticket>[] = [
    { id: "id", header: "Ticket", cell: (t) => <span className="font-mono text-xs">{t.id}</span>, sortValue: (t) => t.id },
    { id: "subject", header: "Subject", cell: (t) => <span><span className="block font-medium">{t.subject}</span><span className="text-[11px] text-muted-foreground">{t.customer} · {t.channel}</span></span>, sortValue: (t) => t.subject },
    { id: "priority", header: "Priority", cell: (t) => <StatusBadge status={t.priority} />, sortValue: (t) => ["High", "Normal", "Low"].indexOf(t.priority) },
    { id: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
    { id: "assignee", header: "Assignee", cell: (t) => t.assignee, sortValue: (t) => t.assignee },
    { id: "sla", header: "SLA", cell: (t) => <span className="font-mono text-xs">{t.slaHours}h</span>, sortValue: (t) => t.slaHours },
    { id: "created", header: "Created", cell: (t) => <span className="font-mono text-xs">{fmtTime(t.created)}</span>, sortValue: (t) => t.created },
    { id: "act", header: "", className: "text-right", cell: (t) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => phone.dial(t.phone, t.customer)} aria-label={`Call ${t.customer}`}><Phone className="h-3.5 w-3.5" /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="outline">Update</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(["open", "in-progress", "escalated", "resolved"] as const).filter((s) => s !== t.status).map((s) => (
              <DropdownMenuItem key={s} onClick={() => move(t, s)} className="capitalize">{s.replace("-", " ")}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ) },
  ];

  return (
    <AppShell>
      <PageHeader title="Tickets" description="Customer issues raised from calls, SMS, WhatsApp and email." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Open" value={String(count("open"))} icon={Inbox} />
        <KpiCard label="In progress" value={String(count("in-progress"))} icon={Clock} />
        <KpiCard label="Escalated" value={String(count("escalated"))} icon={AlertTriangle} />
        <KpiCard label="Resolved" value={String(count("resolved"))} icon={CheckCircle2} />
      </div>
      <DataTable label="Tickets" rows={rows} columns={columns} rowKey={(t) => t.id}
        searchText={(t) => `${t.id} ${t.subject} ${t.customer} ${t.assignee}`} searchPlaceholder="Search tickets…"
        toolbar={<>
          <FilterSelect label="Statuses" value={status} onChange={setStatus} options={["open", "in-progress", "escalated", "resolved"]} />
          <FilterSelect label="Priorities" value={priority} onChange={setPriority} options={["High", "Normal", "Low"]} />
        </>} />
    </AppShell>
  );
}
