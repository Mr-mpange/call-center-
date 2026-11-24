import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Calendar,
  CreditCard,
  Database,
  Bell,
  MessageSquare,
  Phone,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { AdminShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { PageHeader, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Integration, WebhookEvent } from "@/lib/domain-types";
import { fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { apiPatch, apiPost, useApiCollection } from "@/lib/api";

export const Route = createFileRoute("/integrations")({
  head: () =>
    pageHead("Integrations", "Phone lines, SMS, WhatsApp, AI, payments and CRM connections."),
  component: IntegrationsPage,
});

const icons: Record<string, LucideIcon> = {
  Telephony: Phone,
  Messaging: MessageSquare,
  AI: Bot,
  Payments: CreditCard,
  CRM: Database,
  Calendar,
  Notifications: Bell,
};

function IntegrationsPage() {
  const { items: list, setItems: setList } = useApiCollection<Integration>("integrations", [], "integrations");
  const { items: webhookEvents } = useApiCollection<WebhookEvent>("webhooks", [], "events");
  const [code, setCode] = useState("all");
  const rows = webhookEvents.filter(
    (w) => code === "all" || (code === "success" ? w.code < 300 : w.code >= 300),
  );
  const update = (id: string, patch: Partial<Integration>) =>
    setList((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function reconnect(i: Integration) {
    try { await apiPost(`integrations/${i.id}/reconnect`); } catch (error) { toast.error(error instanceof Error ? error.message : "Integration was not reconnected"); return; }
    update(i.id, {
      status: "connected",
      lastSync: new Date().toISOString(),
      detail: "Reconnected just now",
    });
    toast.success(`${i.name} reconnected`);
  }
  async function toggle(i: Integration, on: boolean) {
    try { await apiPatch(`integrations/${i.id}`, { status: on ? "connected" : "disabled", detail: on ? "Enabled just now" : "Not enabled" }); } catch (error) { toast.error(error instanceof Error ? error.message : "Integration state was not saved"); return; }
    update(
      i.id,
      on
        ? { status: "connected", lastSync: new Date().toISOString(), detail: "Enabled just now" }
        : { status: "disabled", detail: "Not enabled" },
    );
    toast(`${i.name} ${on ? "turned on" : "turned off"}`);
  }

  const columns: Column<WebhookEvent>[] = [
    {
      id: "event",
      header: "Event",
      cell: (w) => <span className="font-mono text-xs">{w.event}</span>,
      sortValue: (w) => w.event,
    },
    {
      id: "endpoint",
      header: "Sent to",
      cell: (w) => (
        <span className="block max-w-[260px] truncate text-xs text-muted-foreground">
          {w.endpoint}
        </span>
      ),
    },
    {
      id: "code",
      header: "Result",
      cell: (w) => (
        <StatusBadge
          status={w.code < 300 ? `${w.code} OK` : `${w.code} failed`}
          tone={w.code < 300 ? "success" : "danger"}
        />
      ),
      sortValue: (w) => w.code,
    },
    {
      id: "ms",
      header: "Time",
      className: "text-right",
      cell: (w) => <span className="font-mono text-xs">{w.ms} ms</span>,
      sortValue: (w) => w.ms,
    },
    {
      id: "at",
      header: "When",
      cell: (w) => <span className="font-mono text-xs">{fmtTime(w.at)}</span>,
      sortValue: (w) => w.at,
    },
    {
      id: "act",
      header: "",
      className: "text-right",
      cell: (w) =>
        w.code >= 300 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => toast.info("Webhook retry is unavailable until a delivery worker is configured")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        ) : null,
    },
  ];

  return (
    <AdminShell>
      <PageHeader
        title="Integrations"
        description="The services your call center is connected to, and whether they are working."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {list.map((i) => {
          const Icon = icons[i.category] ?? Database;
          return (
            <div key={i.id} className="soft-card flex flex-col rounded-[18px] p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="soft-icon h-9 w-9 text-accent-foreground">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <Switch
                  checked={i.status !== "disabled"}
                  onCheckedChange={(v) => toggle(i, v)}
                  aria-label={`Turn ${i.name} on or off`}
                />
              </div>
              <p className="mt-3 font-medium">{i.name}</p>
              <p className="text-xs text-muted-foreground">{i.category}</p>
              <p className="mt-2 flex-1 text-xs">{i.detail}</p>
              <div className="mt-3 flex items-center justify-between">
                <StatusBadge status={i.status} />
                {i.status === "error" ? (
                  <Button size="sm" onClick={() => reconnect(i)}>
                    Reconnect
                  </Button>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {i.lastSync ? `synced ${fmtTime(i.lastSync)}` : "—"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <DataTable
        label="Recent events sent to other systems"
        rows={rows}
        columns={columns}
        rowKey={(w) => w.id}
        searchText={(w) => `${w.event} ${w.endpoint} ${w.code}`}
        searchPlaceholder="Search events…"
        toolbar={
          <FilterSelect
            label="Results"
            value={code}
            onChange={setCode}
            options={["success", "failed"]}
          />
        }
      />
    </AdminShell>
  );
}
