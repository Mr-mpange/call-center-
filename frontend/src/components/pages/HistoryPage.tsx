import { Link, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { KpiCard, PageHeader, PrintButton, StatusBadge } from "@/components/kit";
import { usePhone } from "@/components/phone/PhoneProvider";
import { Button } from "@/components/ui/button";
import { fmtDuration, fmtTime } from "@/lib/format";
import type { CallRecord } from "@/lib/domain-types";
import { downloadText, toCsv } from "@/lib/table";
import { useApiCollection } from "@/lib/api";

export function HistoryPage() {
  const { q, direction } = useSearch({ strict: false }) as {
    q?: string;
    direction?: "inbound" | "outbound";
  };
  const phone = usePhone();
  const { items: backendCalls } = useApiCollection<CallRecord>("calls", [], "calls");
  const [dir, setDir] = useState(direction ?? "all");
  const [outcome, setOutcome] = useState("all");
  useEffect(() => setDir(direction ?? "all"), [direction]);

  const all = useMemo<CallRecord[]>(
    () => backendCalls,
    [backendCalls],
  );

  const rows = all.filter((c) => matches(c.direction, dir) && matches(c.outcome, outcome));
  const inbound = all.filter((c) => c.direction === "inbound").length;
  const missed = all.filter((c) => c.outcome === "missed" || c.outcome === "abandoned").length;
  const displayCustomer = (value: string | undefined) => value && !/^unknown caller$/i.test(value) ? value : "Customer";

  const columns: Column<CallRecord>[] = [
    {
      id: "id",
      header: "Call ID",
      cell: (c) => (
        <span className="font-mono text-xs text-muted-foreground">{c.id.slice(0, 8)}</span>
      ),
    },
    {
      id: "at",
      header: "Time",
      cell: (c) => <span className="font-mono text-xs">{fmtTime(c.at)}</span>,
      sortValue: (c) => c.at,
    },
    {
      id: "caller",
      header: "Customer",
      cell: (c) => (
        <span>
          <span className="block font-medium">{displayCustomer(c.caller)}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{c.phone}</span>
        </span>
      ),
      sortValue: (c) => c.caller,
    },
    { id: "dir", header: "Type", cell: (c) => <StatusBadge status={c.direction} /> },
    { id: "queue", header: "Queue", cell: (c) => c.queue || "General", sortValue: (c) => c.queue || "General" },
    { id: "agent", header: "Agent", cell: (c) => c.agent || "Unassigned", sortValue: (c) => c.agent || "Unassigned" },
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
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            asChild
            aria-label={`Open details for ${displayCustomer(c.caller)}`}
            title="View call details"
          >
            <Link
              to="/history/$callId"
              params={{ callId: c.id }}
              onClick={(e) => e.stopPropagation()}
            >
              <Eye className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              phone.dial(c.phone, c.caller);
            }}
            aria-label={`Call ${displayCustomer(c.caller)}`}
          >
            <Phone className="h-3.5 w-3.5" /> Call
          </Button>
        </div>
      ),
    },
  ];

  function exportCsv() {
    downloadText(
      "call-history.csv",
      toCsv(
        ["Time", "Customer", "Phone", "Type", "Queue", "Agent", "Duration (s)", "Outcome"],
        rows.map((c) => [
          c.at,
          displayCustomer(c.caller),
          c.phone,
          c.direction,
          c.queue || "General",
          c.agent || "Unassigned",
          c.durationSec,
          c.outcome,
        ]),
      ),
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Call History"
        description="Every inbound and outbound call, including calls made from your softphone."
        actions={
          <>
            <PrintButton label="Print report" />
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </>
        }
      />
      <section data-print-only className="hidden">
        <h2 className="mb-2 text-base font-semibold">Call summary</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b">
              <th className="py-1.5 text-left font-medium">Total calls</th>
              <td className="py-1.5 text-right">{all.length}</td>
              <th className="py-1.5 pl-6 text-left font-medium">Inbound</th>
              <td className="py-1.5 text-right">{inbound}</td>
            </tr>
            <tr className="border-b">
              <th className="py-1.5 text-left font-medium">Outbound</th>
              <td className="py-1.5 text-right">{all.length - inbound}</td>
              <th className="py-1.5 pl-6 text-left font-medium">Missed / abandoned</th>
              <td className="py-1.5 text-right">{missed}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <div data-print-hide className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total calls"
          value={String(all.length)}
          icon={Phone}
          hint="last 2 days"
        />
        <KpiCard label="Inbound" value={String(inbound)} icon={PhoneIncoming} />
        <KpiCard label="Outbound" value={String(all.length - inbound)} icon={PhoneOutgoing} />
        <KpiCard
          label="Missed / abandoned"
          value={String(missed)}
          icon={PhoneMissed}
          goodWhen="down"
        />
      </div>
      <DataTable
        label="Call history"
        rows={rows}
        columns={columns}
        rowKey={(c) => c.id}
        initialQuery={q}
        searchText={(c) => `${c.caller} ${c.phone} ${c.agent} ${c.queue} ${c.id}`}
        searchPlaceholder="Search customer, number, agent…"
        toolbar={
          <>
            <FilterSelect
              label="Types"
              value={dir}
              onChange={setDir}
              options={["inbound", "outbound"]}
            />
            <FilterSelect
              label="Outcomes"
              value={outcome}
              onChange={setOutcome}
              options={["resolved", "missed", "abandoned", "escalated", "voicemail"]}
            />
          </>
        }
      />
    </AppShell>
  );
}
