import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { CreditCard, Download, MessageSquare, Timer, Users } from "lucide-react";
import { AdminShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { EmptyState, KpiCard, PageHeader, Panel, PrintButton, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { Invoice } from "@/lib/domain-types";
import { fmtTzs } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { apiPost, useApiCollection } from "@/lib/api";
import { downloadText, toCsv } from "@/lib/table";

export const Route = createFileRoute("/admin/billing")({
  head: () => pageHead("Billing", "Monthly invoices, call minutes, SMS and agent seats."),
  component: BillingPage,
});

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" };

function BillingPage() {
  const { items: list } = useApiCollection<Invoice>("invoices", [], "invoices");
  const current = list[0];
  const usage = list.slice(0, 6).reverse().map((v) => ({ month: v.period.slice(0, 3), minutes: v.minutes, sms: v.sms }));
  async function pay(invoice: Invoice) {
    try { await apiPost("billing/checkout", { invoiceId: invoice.id }); toast.success("Payment checkout created"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Payment could not be started"); }
  }
  function exportInvoice(invoice: Invoice) {
    downloadText(`${invoice.id}.csv`, toCsv(
      ["Invoice", "Period", "Minutes", "SMS", "Seats", "Amount", "Currency", "Status"],
      [[invoice.id, invoice.period, invoice.minutes, invoice.sms, invoice.seats, invoice.amount, invoice.currency, invoice.status]],
    ));
  }
  const columns: Column<Invoice>[] = [
    { id: "id", header: "Invoice", cell: (v) => <span className="font-mono text-xs">{v.id}</span>, sortValue: (v) => v.id },
    { id: "period", header: "Month", cell: (v) => v.period },
    { id: "minutes", header: "Minutes", className: "text-right", cell: (v) => <span className="font-mono text-xs">{v.minutes.toLocaleString()}</span>, sortValue: (v) => v.minutes },
    { id: "sms", header: "SMS", className: "text-right", cell: (v) => <span className="font-mono text-xs">{v.sms.toLocaleString()}</span>, sortValue: (v) => v.sms },
    { id: "seats", header: "Seats", className: "text-right", cell: (v) => <span className="font-mono text-xs">{v.seats}</span>, sortValue: (v) => v.seats },
    { id: "amount", header: "Amount", className: "text-right", cell: (v) => <span className="font-mono text-xs font-medium">{fmtTzs(v.amount)}</span>, sortValue: (v) => v.amount },
    { id: "status", header: "Status", cell: (v) => <StatusBadge status={v.status} />, sortValue: (v) => v.status },
    { id: "act", header: "", className: "text-right", cell: (v) => (
      <div className="flex justify-end gap-1">
        {v.status !== "paid" && <Button size="sm" variant="outline" onClick={() => pay(v)}>Pay</Button>}
        <Button size="sm" variant="ghost" onClick={() => exportInvoice(v)} aria-label={`Download ${v.id}`}><Download className="h-3.5 w-3.5" /></Button>
      </div>
    ) },
  ];

  if (!current) return <AdminShell><PageHeader title="Billing" description="What you used each month and what you owe." /><EmptyState title="No billing records" description="Invoices will appear here when billing data is connected." /></AdminShell>;

  return (
    <AdminShell>
      <PageHeader title="Billing" description="What you used each month and what you owe." actions={<><PrintButton label="Print statement" /><Button variant="outline" onClick={() => pay(current)}><CreditCard className="h-4 w-4" />Pay {fmtTzs(current.amount)}</Button></>} />
      <section data-print-only className="hidden">
        <h2 className="mb-3 text-base font-semibold">Current invoice statement</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr><th className="py-1.5 text-left font-medium">Invoice</th><td className="py-1.5">{current.id}</td><th className="py-1.5 pl-6 text-left font-medium">Billing period</th><td className="py-1.5">{current.period}</td></tr>
            <tr><th className="py-1.5 text-left font-medium">Status</th><td className="py-1.5 capitalize">{current.status}</td><th className="py-1.5 pl-6 text-left font-medium">Amount</th><td className="py-1.5 font-semibold">{fmtTzs(current.amount)}</td></tr>
            <tr><th className="py-1.5 text-left font-medium">Call minutes</th><td className="py-1.5">{current.minutes.toLocaleString()}</td><th className="py-1.5 pl-6 text-left font-medium">SMS sent</th><td className="py-1.5">{current.sms.toLocaleString()}</td></tr>
            <tr><th className="py-1.5 text-left font-medium">Agent seats</th><td className="py-1.5">{current.seats}</td><th className="py-1.5 pl-6 text-left font-medium">Company</th><td className="py-1.5">MPANGE Communications Ltd</td></tr>
          </tbody>
        </table>
      </section>
      <div data-print-hide className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="This month's bill" value={fmtTzs(current.amount)} icon={CreditCard} hint={current.period} />
        <KpiCard label="Call minutes" value={current.minutes.toLocaleString()} icon={Timer} />
        <KpiCard label="SMS sent" value={current.sms.toLocaleString()} icon={MessageSquare} />
        <KpiCard label="Agent seats" value={String(current.seats)} icon={Users} />
      </div>
      <div data-print-hide>
        <Panel title="Usage, last 6 months">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={usage}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={44} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="minutes" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sms" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <DataTable label="Invoices" rows={list} columns={columns} rowKey={(v) => v.id} searchText={(v) => `${v.id} ${v.period} ${v.status}`} searchPlaceholder="Search invoices…" />
    </AdminShell>
  );
}
