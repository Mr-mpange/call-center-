import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { PageHeader, Panel, PrintButton, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtDuration } from "@/lib/format";
import type { Queue } from "@/lib/domain-types";
import { apiPatch, useApiCollection } from "@/lib/api";

export function QueuePage() {
  const { items: queues, setItems: setQueues } = useApiCollection<Queue>("queues", [], "queues");
  const { items: live } = useApiCollection("calls/live", [], "liveCalls");
  const [selId, setSelId] = useState<string | null>(null);
  const saved = queues.find((q) => q.id === selId) ?? queues[0];
  const [draft, setDraft] = useState<Queue | null>(null);
  useEffect(() => { if (saved) setDraft(saved); }, [selId, queues]);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const slaErr = !draft || draft.slaTargetSec < 10 || draft.slaTargetSec > 900;

  function pick(id: string) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    setSelId(id);
    const next = queues.find((q) => q.id === id);
    if (next) setDraft(next);
  }
  async function save() {
    try { await apiPatch(`queues/${draft.id}`, draft); } catch (error) { toast.error(error instanceof Error ? error.message : "Queue was not saved"); return; }
    setQueues((qs) => qs.map((q) => (q.id === draft.id ? draft : q)));
    toast.success(`${draft.name} updated`);
  }
  const waiting = live.filter((c) => c.status === "ringing");

  if (!saved || !draft) return <AppShell><PageHeader title="Call Queue" description="Waiting callers, priorities and routing rules." /><Panel title="Queues"><p className="text-sm text-muted-foreground">No queues configured.</p></Panel></AppShell>;

  return (
    <AppShell>
      <PageHeader
        title="Call Queue"
        description="Waiting callers, priorities and routing rules."
        actions={<PrintButton label="Print report" />}
      />
      <section data-print-only className="hidden">
        <h2 className="mb-3 text-lg font-semibold">Queue summary</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3">Queue</th>
              <th className="py-2 pr-3">Waiting</th>
              <th className="py-2 pr-3">Longest wait</th>
              <th className="py-2 pr-3">SLA target</th>
              <th className="py-2 pr-3">Priority</th>
              <th className="py-2">Overflow</th>
            </tr>
          </thead>
          <tbody>
            {queues.map((q) => (
              <tr key={q.id} className="border-b">
                <td className="py-2 pr-3 font-medium">{q.name}</td>
                <td className="py-2 pr-3">{q.waiting}</td>
                <td className="py-2 pr-3">{fmtDuration(q.longestWaitSec)}</td>
                <td className="py-2 pr-3">{fmtDuration(q.slaTargetSec)}</td>
                <td className="py-2 pr-3">{q.priority}</td>
                <td className="py-2">{q.overflowTo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div data-print-hide className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {queues.map((q) => (
          <div
            key={q.id}
            role="button"
            tabIndex={0}
            onClick={() => pick(q.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                pick(q.id);
              }
            }}
            aria-pressed={q.id === selId}
            className={`soft-card group cursor-pointer rounded-[18px] p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${q.id === selId ? "surface-recessed text-accent-foreground" : ""}`}
          >
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-muted-foreground">{q.name}</p>
              <StatusBadge
                status={q.longestWaitSec > q.slaTargetSec ? "Over SLA" : "Within SLA"}
                tone={q.longestWaitSec > q.slaTargetSec ? "danger" : "success"}
              />
            </div>
            <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-card-foreground">
              {q.waiting}
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">waiting</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Longest {fmtDuration(q.longestWaitSec)}</span>
              <span>SLA {fmtDuration(q.slaTargetSec)}</span>
            </div>
          </div>
        ))}
      </div>
      <div data-print-hide className="grid gap-4 lg:grid-cols-2">
        <Panel title="Waiting callers">
          {waiting.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody waiting.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {waiting.map((c, i) => (
                <li key={c.id} className="flex items-center justify-between py-2.5">
                  <span>
                    <span className="mr-2 font-mono text-xs text-muted-foreground">#{i + 1}</span>
                    {c.caller} <span className="text-muted-foreground">· {c.queue}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs">{fmtDuration(c.waitSec)}</span>
                    <StatusBadge status={c.waitSec > 120 ? "high" : "normal"} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title={`Configure: ${saved.name}`}
          action={
            dirty && <span className="text-xs font-medium text-warning">Unsaved changes</span>
          }
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!slaErr) save();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select
                  value={draft.priority}
                  onValueChange={(v) => setDraft({ ...draft, priority: v as Queue["priority"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["High", "Normal", "Low"].map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sla">SLA target (seconds)</Label>
                <Input
                  id="sla"
                  type="number"
                  value={draft.slaTargetSec}
                  onChange={(e) => setDraft({ ...draft, slaTargetSec: Number(e.target.value) })}
                  aria-invalid={slaErr}
                />
                {slaErr && <p className="text-xs text-destructive">Between 10 and 900 seconds.</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Overflow to</Label>
                <Select
                  value={draft.overflowTo}
                  onValueChange={(v) => setDraft({ ...draft, overflowTo: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["General", "Voicemail", "Billing", "Technical", "Sales"]
                      .filter((n) => n !== draft.name)
                      .map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Routing</Label>
                <Input
                  value="Longest idle agent"
                  disabled
                  title="Routing strategy requires backend support"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={!dirty || slaErr}>
                Save changes
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!dirty}
                onClick={() => setDraft(saved)}
              >
                Discard
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </AppShell>
  );
}
