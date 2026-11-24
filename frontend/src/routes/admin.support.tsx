import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/AppShell";
import { PageHeader, Panel, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, extractData, useApiCollection } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";

type SupportTicket = {
  id: string;
  subject: string;
  body?: string;
  status: string;
  opened?: string;
  openedAt?: string;
  deliveryStatus?: string;
};

export const Route = createFileRoute("/admin/support")({
  head: () => pageHead("Support", "Send a support request to the MPANGE platform team."),
  component: SupportPage,
});

function SupportPage() {
  const { items: tickets, setItems: setTickets } = useApiCollection<SupportTicket>("support", [], "support");
  const [form, setForm] = useState({ subject: "", body: "" });
  const [sending, setSending] = useState(false);

  async function sendRequest() {
    const subject = form.subject.trim();
    const body = form.body.trim();
    if (!subject) { toast.error("Add a subject"); return; }
    if (!body) { toast.error("Describe what you need help with"); return; }
    setSending(true);
    try {
      const response = await apiPost<{ data?: SupportTicket; ticket?: SupportTicket }>("support/contact-platform", { subject, body });
      const ticket = extractData(response, "ticket");
      if (ticket) setTickets((current) => [ticket, ...current]);
      setForm({ subject: "", body: "" });
      toast.success("Support request sent to the platform team");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Support request could not be sent");
    } finally {
      setSending(false);
    }
  }

  return (
    <AdminShell>
      <PageHeader title="Support" description="Email the MPANGE platform team about your organization, account, or service." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <Panel title="Send a support request">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="support-subject">Subject</Label>
              <Input id="support-subject" maxLength={160} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="What do you need help with?" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="support-message">Message</Label>
              <Textarea id="support-message" rows={9} maxLength={10000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="Describe the issue, question, or request." />
            </div>
            <Button className="w-fit" onClick={sendRequest} disabled={sending}><Send className="h-4 w-4" />{sending ? "Sending…" : "Email platform support"}</Button>
          </div>
        </Panel>

        <Panel title="Previous requests">
          {tickets.length ? <ul className="space-y-3">
            {tickets.map((ticket) => <li key={ticket.id} className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{ticket.subject}</p><p className="font-mono text-[11px] text-muted-foreground">{ticket.id} · {fmtTime(ticket.openedAt ?? ticket.opened ?? "")}</p></div>
              <StatusBadge status={ticket.deliveryStatus === "failed" ? "delivery failed" : ticket.status} />
            </li>)}
          </ul> : <p className="text-sm text-muted-foreground">No support requests yet.</p>}
        </Panel>
      </div>
    </AdminShell>
  );
}
