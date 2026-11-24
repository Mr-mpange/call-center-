import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Coffee,
  Headphones,
  Pencil,
  PhoneCall,
  Plus,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { KpiCard, PageHeader, Panel, PrintButton, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDuration } from "@/lib/format";
import type { Agent, AgentStatus } from "@/lib/domain-types";
import { initials } from "@/lib/phone";
import { apiDelete, apiPatch, apiPost, extractData, useApiCollection } from "@/lib/api";

const statuses: AgentStatus[] = ["available", "on-call", "break", "offline"];

export function AgentsPage() {
  const { items: list, setItems: setList } = useApiCollection<Agent>("agents", [], "agents");
  const [status, setStatus] = useState("all");
  const [team, setTeam] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [form, setForm] = useState({
    name: "",
    team: "General",
    role: "Agent" as Agent["role"],
    languages: "Kiswahili, English",
    voicemail: "",
  });
  const teams = [...new Set(list.map((a) => a.team))];
  const rows = list.filter((a) => matches(a.status, status) && matches(a.team, team));
  const count = (s: AgentStatus) => list.filter((a) => a.status === s).length;

  async function setAgentStatus(a: Agent, s: AgentStatus) {
    try {
      await apiPost(`agents/${a.id}/status`, { status: s });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agent status was not saved");
      return;
    }
    setList((l) => l.map((x) => (x.id === a.id ? { ...x, status: s } : x)));
    toast.success(`${a.name} is now ${s.replace("-", " ")}`);
  }

  async function addAgent(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    const languages = form.languages
      .split(",")
      .map((language) => language.trim())
      .filter(Boolean);
    const candidate: Agent = {
      id: `a${Date.now()}`,
      name,
      team: form.team.trim() || "General",
      role: form.role,
      status: "available",
      callsToday: 0,
      avgHandle: 0,
      languages,
      voicemail: form.voicemail.trim() || undefined,
    };
    try {
      const response = await apiPost<{ data?: Agent; agent?: Agent }>("agents", candidate);
      setList((current) => [extractData(response, "agent", candidate), ...current]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agent was not saved");
      return;
    }
    setForm({
      name: "",
      team: "General",
      role: "Agent",
      languages: "Kiswahili, English",
      voicemail: "",
    });
    setAddOpen(false);
    toast.success(`${name} added to agents`);
  }

  function openEditAgent(agent: Agent) {
    setEditing(agent);
    setForm({
      name: agent.name,
      team: agent.team,
      role: agent.role,
      languages: agent.languages.join(", "),
      voicemail: agent.voicemail ?? "",
    });
  }

  async function saveAgent(event: FormEvent) {
    event.preventDefault();
    if (!editing || !form.name.trim()) return;
    const updated = {
      ...editing,
      name: form.name.trim(),
      team: form.team.trim() || "General",
      role: form.role,
      languages: form.languages
        .split(",")
        .map((language) => language.trim())
        .filter(Boolean),
      voicemail: form.voicemail.trim() || undefined,
    };
    try {
      await apiPatch(`agents/${editing.id}`, updated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agent was not saved");
      return;
    }
    setList((current) => current.map((agent) => (agent.id === editing.id ? updated : agent)));
    setEditing(null);
    setForm({
      name: "",
      team: "General",
      role: "Agent",
      languages: "Kiswahili, English",
      voicemail: "",
    });
    toast.success(`${updated.name} updated`);
  }

  async function deleteAgent() {
    if (!deleteTarget) return;
    try {
      await apiDelete(`agents/${deleteTarget.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agent was not deleted");
      return;
    }
    setList((current) => current.filter((agent) => agent.id !== deleteTarget.id));
    toast.success(`${deleteTarget.name} deleted`);
    setDeleteTarget(null);
  }

  const columns: Column<Agent>[] = [
    {
      id: "name",
      header: "Agent",
      sortValue: (a) => a.name,
      cell: (a) => (
        <span className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {initials(a.name)}
          </span>
          <span>
            <span className="block font-medium">{a.name}</span>
            <span className="text-[11px] text-muted-foreground">{a.role}</span>
          </span>
        </span>
      ),
    },
    { id: "team", header: "Team", cell: (a) => a.team, sortValue: (a) => a.team },
    {
      id: "status",
      header: "Status",
      cell: (a) => <StatusBadge status={a.status} />,
      sortValue: (a) => a.status,
    },
    {
      id: "voicemail",
      header: "Voicemail",
      cell: (a) => (
        <span className="flex flex-col gap-0.5">
          <StatusBadge status={a.voicemail ? "configured" : "not configured"} />
          {a.voicemail && (
            <span className="font-mono text-[11px] text-muted-foreground">{a.voicemail}</span>
          )}
        </span>
      ),
      sortValue: (a) => a.voicemail || "",
    },
    {
      id: "langs",
      header: "Languages",
      cell: (a) => <span className="text-xs">{a.languages.join(", ")}</span>,
    },
    {
      id: "calls",
      header: "Calls today",
      className: "text-right",
      cell: (a) => <span className="font-mono">{a.callsToday}</span>,
      sortValue: (a) => a.callsToday,
    },
    {
      id: "aht",
      header: "Avg handle",
      className: "text-right",
      cell: (a) => <span className="font-mono text-xs">{fmtDuration(a.avgHandle)}</span>,
      sortValue: (a) => a.avgHandle,
    },
    {
      id: "csat",
      header: "CSAT",
      className: "text-right",
      cell: (a) => (
        <span className="font-mono text-xs">
          {typeof (a as Agent & { csat?: number }).csat === "number"
            ? (a as Agent & { csat: number }).csat.toFixed(1)
            : "—"}
        </span>
      ),
      sortValue: (a) => (a as Agent & { csat?: number }).csat ?? 0,
    },
    {
      id: "act",
      header: "",
      className: "text-right",
      cell: (a) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => openEditAgent(a)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeleteTarget(a)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Set status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {statuses
                .filter((s) => s !== a.status)
                .map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setAgentStatus(a, s)}
                    className="capitalize"
                  >
                    {s.replace("-", " ")}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Agents & Teams"
        description="See who is free, who is on a call and how each team is doing today."
        actions={
          <>
            <PrintButton />
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add agent
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Available" value={String(count("available"))} icon={UserCheck} />
        <KpiCard label="On a call" value={String(count("on-call"))} icon={PhoneCall} />
        <KpiCard label="On break" value={String(count("break"))} icon={Coffee} />
        <KpiCard label="Offline" value={String(count("offline"))} icon={UserX} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {teams.map((t) => {
          const members = list.filter((a) => a.team === t);
          const busy = members.filter((a) => a.status === "on-call").length;
          const calls = members.reduce((s, a) => s + a.callsToday, 0);
          return (
            <Panel
              key={t}
              title={t}
              action={<Headphones className="h-4 w-4 text-muted-foreground" aria-hidden />}
            >
              <div className="flex items-end justify-between">
                <div>
                  <p className="font-display text-2xl font-semibold">{members.length}</p>
                  <p className="text-xs text-muted-foreground">agents</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>
                    <span className="font-mono text-foreground">{busy}</span> on calls
                  </p>
                  <p>
                    <span className="font-mono text-foreground">{calls}</span> calls today
                  </p>
                </div>
              </div>
              <div className="mt-3 flex -space-x-2">
                {members.map((a) => (
                  <span
                    key={a.id}
                    title={a.name}
                    className="soft-icon h-7 w-7 text-[10px] font-semibold"
                  >
                    {initials(a.name)}
                  </span>
                ))}
              </div>
            </Panel>
          );
        })}
      </div>
      <DataTable
        label="Agents"
        rows={rows}
        columns={columns}
        rowKey={(a) => a.id}
        searchText={(a) =>
          `${a.name} ${a.team} ${a.role} ${a.languages.join(" ")} ${a.voicemail ?? ""}`
        }
        searchPlaceholder="Search agents…"
        toolbar={
          <>
            <FilterSelect label="Statuses" value={status} onChange={setStatus} options={statuses} />
            <FilterSelect label="Teams" value={team} onChange={setTeam} options={teams} />
          </>
        }
      />
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add agent</DialogTitle>
          </DialogHeader>
          <form id="add-agent" onSubmit={addAgent} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="agent-name">Full name</Label>
              <Input
                id="agent-name"
                autoFocus
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="agent-team">Team</Label>
              <select
                id="agent-team"
                className="soft-input h-9 rounded-xl border-0 bg-background px-3 text-sm"
                value={form.team}
                onChange={(event) => setForm({ ...form, team: event.target.value })}
              >
                {teams.map((agentTeam) => (
                  <option key={agentTeam} value={agentTeam}>
                    {agentTeam}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="agent-role">Role</Label>
              <select
                id="agent-role"
                className="soft-input h-9 rounded-xl border-0 bg-background px-3 text-sm"
                value="Agent"
                disabled
              >
                <option>Agent</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="agent-languages">Languages</Label>
              <Input
                id="agent-languages"
                value={form.languages}
                onChange={(event) => setForm({ ...form, languages: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Separate languages with commas.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="agent-voicemail">Voicemail destination</Label>
              <Input
                id="agent-voicemail"
                value={form.voicemail}
                onChange={(event) => setForm({ ...form, voicemail: event.target.value })}
                placeholder="Optional phone number or mailbox"
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="add-agent">
              Add agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setForm({
              name: "",
              team: "General",
              role: "Agent",
              languages: "Kiswahili, English",
              voicemail: "",
            });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit agent</DialogTitle>
          </DialogHeader>
          <form id="edit-agent" onSubmit={saveAgent} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-agent-name">Full name</Label>
              <Input
                id="edit-agent-name"
                autoFocus
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-agent-team">Team</Label>
              <select
                id="edit-agent-team"
                className="soft-input h-9 rounded-xl border-0 bg-background px-3 text-sm"
                value={form.team}
                onChange={(event) => setForm({ ...form, team: event.target.value })}
              >
                {[...new Set([...teams, form.team])].map((agentTeam) => (
                  <option key={agentTeam} value={agentTeam}>
                    {agentTeam}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-agent-role">Role</Label>
              <select
                id="edit-agent-role"
                className="soft-input h-9 rounded-xl border-0 bg-background px-3 text-sm"
                value="Agent"
                disabled
              >
                <option>Agent</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-agent-languages">Languages</Label>
              <Input
                id="edit-agent-languages"
                value={form.languages}
                onChange={(event) => setForm({ ...form, languages: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">Separate languages with commas.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-agent-voicemail">Voicemail destination</Label>
              <Input
                id="edit-agent-voicemail"
                value={form.voicemail}
                onChange={(event) => setForm({ ...form, voicemail: event.target.value })}
                placeholder="Optional phone number or mailbox"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-agent-status">Status</Label>
              <select
                id="edit-agent-status"
                className="soft-input h-9 rounded-xl border-0 bg-background px-3 text-sm"
                value={editing?.status ?? "available"}
                onChange={(event) =>
                  setEditing((current) =>
                    current ? { ...current, status: event.target.value as AgentStatus } : current,
                  )
                }
              >
                {statuses.map((agentStatus) => (
                  <option key={agentStatus} value={agentStatus}>
                    {agentStatus.replace("-", " ")}
                  </option>
                ))}
              </select>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="edit-agent">
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete agent?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.name} will be removed from the agent list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteAgent}>
              Delete agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
