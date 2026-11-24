import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Circle,
  MicOff,
  Pause,
  Phone,
  PhoneOff,
  PhoneOutgoing,
  Repeat,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, StatusBadge } from "@/components/kit";
import { usePhone } from "@/components/phone/PhoneProvider";
import { Button } from "@/components/ui/button";
import { cleanNumber } from "@/lib/phone";
import { fmtDuration } from "@/lib/format";
import type { Contact, LiveCall } from "@/lib/domain-types";
import { cn } from "@/lib/utils";
import { apiPost, useApiCollection } from "@/lib/api";

export function LiveCalls() {
  const { items: live } = useApiCollection<LiveCall>("calls/live", [], "liveCalls");
  const { items: contacts } = useApiCollection<Contact>("contacts", [], "contacts");
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "ringing" | "active">("all");
  const list = live.filter(
    (c) =>
      filter === "all" || (filter === "ringing" ? c.status === "ringing" : c.status !== "ringing"),
  );
  const call = live.find((c) => c.id === sel) ?? live[0];
  const phone = usePhone();
  if (!call) return <AppShell><PageHeader title="Live Calls" description="Active and ringing calls across all queues." /><Panel title="Active calls"><p className="text-sm text-muted-foreground">No active calls.</p></Panel></AppShell>;
  const contact = contacts.find((item) => {
    const callDigits = call.phone.replace(/\D/g, "");
    const contactDigits = item.phone.replace(/\D/g, "");
    return callDigits === contactDigits || (callDigits.length >= 9 && contactDigits.length >= 9 && callDigits.slice(-9) === contactDigits.slice(-9));
  });
  const customerName = contact?.name || call.caller;

  const mine =
    !!phone.call &&
    phone.call.status !== "ended" &&
    cleanNumber(phone.call.number) === cleanNumber(call.phone);
  const connected = mine && phone.call?.status === "connected";
  const busyElsewhere = !!phone.call && phone.call.status !== "ended" && !mine;

  return (
    <AppShell>
      <PageHeader title="Live Calls" description="Active and ringing calls across all queues." />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Panel
          title={`Active calls (${list.length})`}
          action={
            <div className="flex gap-1" role="tablist" aria-label="Filter calls">
              {(["all", "ringing", "active"] as const).map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "soft-button rounded-xl px-2 py-1 text-xs capitalize",
                    filter === f
                      ? "surface-recessed font-medium text-accent-foreground"
                      : "bg-background text-muted-foreground",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          }
        >
          <ul className="divide-y divide-border" role="listbox" aria-label="Calls">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  role="option"
                  aria-selected={sel === c.id}
                  onClick={() => setSel(c.id)}
                  className={cn(
                    "soft-nav-item grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors",
                    sel === c.id && "surface-recessed text-accent-foreground",
                  )}
                >
                  <span className="soft-icon h-9 w-9">
                    {c.direction === "inbound" ? (
                      <ArrowDownLeft className="h-4 w-4 text-primary" aria-label="Inbound" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-chart-2" aria-label="Outbound" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{contacts.find((item) => {
                      const callDigits = c.phone.replace(/\D/g, "");
                      const contactDigits = item.phone.replace(/\D/g, "");
                      return callDigits === contactDigits || (callDigits.length >= 9 && contactDigits.length >= 9 && callDigits.slice(-9) === contactDigits.slice(-9));
                    })?.name || c.caller}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.queue} · {c.agentId ?? "Unassigned"}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <StatusBadge status={c.status} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.status === "ringing"
                        ? `waiting ${fmtDuration(c.waitSec)}`
                        : fmtDuration(c.durationSec)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Call detail">
          <div className="space-y-4">
            <div>
              <p className="text-lg font-semibold">{customerName}</p>
              <p className="font-mono text-sm text-muted-foreground">{call.phone}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Direction", call.direction],
                ["Queue", call.queue],
                ["Agent", call.agentId ?? "Unassigned"],
                ["Language", call.language],
                ["Duration", fmtDuration(call.durationSec)],
                ["Wait", fmtDuration(call.waitSec)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium capitalize">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="surface-recessed rounded-xl p-3 text-sm">
              <p className="text-xs font-medium text-accent-foreground">
                AI-detected intent
              </p>
              <p className="mt-0.5">{call.intent}</p>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Call controls</p>
              <div className="grid grid-cols-3 gap-2">
                {call.status === "ringing" || (!mine && call.direction === "inbound") ? (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={mine}
                    onClick={() => phone.takeCall(call.phone, customerName)}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Answer
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={mine}
                    onClick={() => phone.dial(call.phone, customerName)}
                  >
                    <PhoneOutgoing className="h-3.5 w-3.5" />
                    Call
                  </Button>
                )}
                <Button
                  variant={phone.call?.held && connected ? "secondary" : "outline"}
                  size="sm"
                  className="w-full"
                  disabled={!connected}
                  onClick={() => phone.toggle("held")}
                >
                  <Pause className="h-3.5 w-3.5" />
                  {phone.call?.held && connected ? "Resume" : "Hold"}
                </Button>
                <Button
                  variant={phone.call?.muted && connected ? "secondary" : "outline"}
                  size="sm"
                  className="w-full"
                  disabled={!connected}
                  onClick={() => phone.toggle("muted")}
                >
                  <MicOff className="h-3.5 w-3.5" />
                  {phone.call?.muted && connected ? "Unmute" : "Mute"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={!connected}
                  onClick={() => phone.transfer(`${call.queue} queue`)}
                >
                  <Repeat className="h-3.5 w-3.5" />
                  Transfer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={!connected}
                  onClick={() => {
                    phone.transfer("Supervisor");
                    toast.info(`${customerName} escalated to a supervisor`);
                  }}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Escalate
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  disabled={!mine}
                  onClick={phone.hangup}
                >
                  <PhoneOff className="h-3.5 w-3.5" />
                  End call
                </Button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Circle
                  className={cn(
                    "h-2.5 w-2.5",
                    connected ? "fill-success text-success" : "text-muted-foreground",
                  )}
                />
                {connected
                  ? `You are on this call · ${fmtDuration(phone.elapsed)}`
                  : mine
                    ? "Connecting on your softphone…"
                    : busyElsewhere
                      ? "Finish your current call before taking this one."
                      : "Answer or call to handle this caller on your softphone."}
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
