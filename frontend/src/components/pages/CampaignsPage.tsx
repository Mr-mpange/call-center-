import { useState } from "react";
import { toast } from "sonner";
import { Megaphone, PhoneOutgoing, Plus, Target, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { KpiCard, PageHeader, PrintButton, StatusBadge } from "@/components/kit";
import { usePhone } from "@/components/phone/PhoneProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { Campaign, CampaignStatus, Contact } from "@/lib/domain-types";
import { apiPatch, apiPost, extractData, useApiCollection } from "@/lib/api";

const types: Campaign["type"][] = ["Outbound calls", "Survey", "Reminder"];

export function CampaignsPage() {
  const phone = usePhone();
  const { items: list, setItems: setList } = useApiCollection<Campaign>("campaigns", [], "campaigns");
  const { items: contacts } = useApiCollection<Contact>("contacts", [], "contacts");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "Outbound calls" as Campaign["type"],
    queue: "Sales",
    contacts: "100",
  });
  const rows = list.filter((c) => matches(c.status, status) && matches(c.type, type));
  const running = list.filter((c) => c.status === "running");
  const reached = list.reduce((s, c) => s + c.reached, 0);
  const conv = list.reduce((s, c) => s + c.conversions, 0);

  async function setCampaign(c: Campaign, s: CampaignStatus) {
    try { await apiPost(`campaigns/${c.id}/${s === "paused" ? "pause" : "resume"}`); } catch (error) { toast.error(error instanceof Error ? error.message : "Campaign status was not saved"); return; }
    setList((l) => l.map((x) => (x.id === c.id ? { ...x, status: s } : x)));
    toast.success(`"${c.name}" is now ${s}`);
  }
  async function dialNext(c: Campaign) {
    const callable = contacts.filter((x) => !x.doNotCall);
    const target = callable[c.reached % Math.max(callable.length, 1)];
    if (!target) { toast.error("No callable contacts are available"); return; }
    try {
      if (!await phone.dial(target.phone, target.name)) return;
      const reachedCount = Math.min(c.contacts, c.reached + 1);
      await apiPatch(`campaigns/${c.id}`, { reached: reachedCount });
      setList((l) => l.map((x) => (x.id === c.id ? { ...x, reached: reachedCount } : x)));
    } catch (error) { toast.error(error instanceof Error ? error.message : "The outbound call was not started"); }
  }
  async function create() {
    if (!form.name.trim()) {
      toast.error("Give the campaign a name");
      return;
    }
    const n = Math.max(0, Number(form.contacts) || 0);
    const candidate: Campaign = {
        id: `cp${Date.now()}`,
        name: form.name.trim(),
        type: form.type,
        status: "draft",
        queue: form.queue,
        contacts: n,
        reached: 0,
        conversions: 0,
        start: new Date().toISOString().slice(0, 10),
        owner: "You",
      };
    try {
      const response = await apiPost<{ data?: Campaign; campaign?: Campaign }>("campaigns", candidate);
      setList((l) => [extractData(response, "campaign", candidate), ...l]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Campaign was not saved"); return; }
    setOpen(false);
    setForm({ name: "", type: "Outbound calls", queue: "Sales", contacts: "100" });
    toast.success("Campaign saved as draft");
  }

  const columns: Column<Campaign>[] = [
    {
      id: "name",
      header: "Campaign",
      sortValue: (c) => c.name,
      cell: (c) => (
        <span>
          <span className="block font-medium">{c.name}</span>
          <span className="text-[11px] text-muted-foreground">
            {c.type} · {c.queue} · {c.owner}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (c) => <StatusBadge status={c.status} />,
      sortValue: (c) => c.status,
    },
    {
      id: "progress",
      header: "Reached",
      sortValue: (c) => (c.contacts ? c.reached / c.contacts : 0),
      cell: (c) => {
        const pct = c.contacts ? Math.round((c.reached / c.contacts) * 100) : 0;
        return (
          <div className="w-36">
            <Progress value={pct} className="h-1.5" />
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {c.reached}/{c.contacts} · {pct}%
            </p>
          </div>
        );
      },
    },
    {
      id: "conv",
      header: "Success",
      className: "text-right",
      sortValue: (c) => c.conversions,
      cell: (c) => (
        <span className="font-mono text-xs">
          {c.conversions}
          {c.reached ? ` (${Math.round((c.conversions / c.reached) * 100)}%)` : ""}
        </span>
      ),
    },
    {
      id: "start",
      header: "Start",
      cell: (c) => <span className="font-mono text-xs">{c.start}</span>,
      sortValue: (c) => c.start,
    },
    {
      id: "act",
      header: "",
      className: "text-right",
      cell: (c) => (
        <div className="flex justify-end gap-1">
          {c.status === "running" && (
            <Button size="sm" onClick={() => dialNext(c)}>
              <PhoneOutgoing className="h-3.5 w-3.5" />
              Call next
            </Button>
          )}
          {c.status === "running" && (
            <Button size="sm" variant="outline" onClick={() => setCampaign(c, "paused")}>
              Pause
            </Button>
          )}
          {(c.status === "paused" || c.status === "scheduled" || c.status === "draft") && (
            <Button size="sm" variant="outline" onClick={() => setCampaign(c, "running")}>
              {c.status === "paused" ? "Resume" : "Start"}
            </Button>
          )}
          {c.status === "completed" && (
            <span className="text-xs text-muted-foreground">Finished</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Campaigns"
        description="Call lists, payment reminders and surveys. Press “Call next” to dial the next customer on the phone."
        actions={
          <>
            <PrintButton />
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              New campaign
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Running now" value={String(running.length)} icon={Megaphone} />
        <KpiCard
          label="Customers in lists"
          value={list.reduce((s, c) => s + c.contacts, 0).toLocaleString()}
          icon={Users}
        />
        <KpiCard label="Reached" value={reached.toLocaleString()} icon={PhoneOutgoing} />
        <KpiCard
          label="Success rate"
          value={`${reached ? Math.round((conv / reached) * 100) : 0}%`}
          icon={Target}
        />
      </div>
      <DataTable
        label="Campaigns"
        rows={rows}
        columns={columns}
        rowKey={(c) => c.id}
        searchText={(c) => `${c.name} ${c.owner} ${c.queue}`}
        searchPlaceholder="Search campaigns…"
        toolbar={
          <>
            <FilterSelect
              label="Statuses"
              value={status}
              onChange={setStatus}
              options={["running", "paused", "scheduled", "completed", "draft"]}
            />
            <FilterSelect label="Types" value={type} onChange={setType} options={types} />
          </>
        }
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cname">Name</Label>
              <Input
                id="cname"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Dodoma renewal calls"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Type</Label>
                <FilterSelect
                  label="Type"
                  value={form.type}
                  onChange={(v) => setForm({ ...form, type: v as Campaign["type"] })}
                  options={types}
                  includeAll={false}
                  className="w-full"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Team</Label>
                <FilterSelect
                  label="Team"
                  value={form.queue}
                  onChange={(v) => setForm({ ...form, queue: v })}
                  options={["Sales", "Billing", "Technical", "General"]}
                  includeAll={false}
                  className="w-full"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ccount">Number of customers</Label>
              <Input
                id="ccount"
                type="number"
                min={0}
                value={form.contacts}
                onChange={(e) => setForm({ ...form, contacts: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create}>Save draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
