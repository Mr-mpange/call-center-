import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download } from "lucide-react";
import { AdminShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { PageHeader, PrintButton, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { AuditEntry } from "@/lib/domain-types";
import { fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { useApiCollection } from "@/lib/api";
import { downloadText, toCsv } from "@/lib/table";

export const Route = createFileRoute("/admin/audit-log")({
  head: () => pageHead("Audit Log", "Every sign-in, change and export, with who did it and when."),
  component: AuditPage,
});

function AuditPage() {
  const { items: list } = useApiCollection<AuditEntry>("audit-log", [], "auditLog");
  const [sev, setSev] = useState("all");
  const rows = list.filter((a) => matches(a.severity, sev));
  function exportAuditLog() {
    downloadText("audit-log.csv", toCsv(
      ["When", "Who", "Action", "Target", "Severity", "IP"],
      rows.map((a) => [a.at, a.user, a.action, a.target, a.severity, a.ip]),
    ));
  }
  const columns: Column<AuditEntry>[] = [
    { id: "at", header: "When", cell: (a) => <span className="font-mono text-xs">{fmtTime(a.at)}</span>, sortValue: (a) => a.at },
    { id: "user", header: "Who", cell: (a) => a.user, sortValue: (a) => a.user },
    { id: "action", header: "Action", cell: (a) => <span className="font-medium">{a.action}</span>, sortValue: (a) => a.action },
    { id: "target", header: "Details", cell: (a) => <span className="text-xs text-muted-foreground">{a.target}</span> },
    { id: "sev", header: "Importance", cell: (a) => <StatusBadge status={a.severity} />, sortValue: (a) => ["high", "normal", "low"].indexOf(a.severity) },
    { id: "ip", header: "IP address", cell: (a) => <span className="font-mono text-xs">{a.ip}</span> },
  ];
  return (
    <AdminShell>
      <PageHeader title="Audit Log" description="A record of every sign-in, settings change and download."
        actions={<><PrintButton /><Button variant="outline" onClick={exportAuditLog}><Download className="h-4 w-4" />Export</Button></>} />
      <DataTable label="Audit log" rows={rows} columns={columns} rowKey={(a) => a.id}
        searchText={(a) => `${a.user} ${a.action} ${a.target} ${a.ip}`} searchPlaceholder="Search the log…"
        toolbar={<FilterSelect label="Importance" value={sev} onChange={setSev} options={["high", "normal", "low"]} />} />
    </AdminShell>
  );
}
