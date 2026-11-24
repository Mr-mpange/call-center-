import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Save, Trash2, UserPlus } from "lucide-react";
import { AdminShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { PageHeader, Panel, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { rolePermissions } from "@/lib/permissions";
import type { AppUser } from "@/lib/domain-types";
import { fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { apiDelete, apiPatch, apiPost, apiPut, extractData, useApiCollection } from "@/lib/api";

export const Route = createFileRoute("/admin/users")({
  head: () => pageHead("Users & Roles", "Invite people, set their role and see what each role can do."),
  component: UsersPage,
});

const roles: AppUser["role"][] = ["Org Admin", "Supervisor", "Agent"];
type RolePermission = (typeof rolePermissions)[number];
type PermissionRole = Exclude<keyof RolePermission, "perm">;
const roleKey: Record<AppUser["role"], PermissionRole> = { "Org Admin": "admin", Supervisor: "supervisor", Agent: "agent" };

function UsersPage() {
  const { items: permissions, setItems: setPermissions } = useApiCollection<RolePermission>("role-permissions", [], "rolePermissions");
  const { items: list, setItems: setList } = useApiCollection<AppUser>("users", [], "users");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "Agent" as AppUser["role"], team: "General" });
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "Agent" as AppUser["role"], team: "General" });
  const rows = list.filter((u) => matches(u.role, role) && matches(u.status, status));

  async function invite() {
    if (!form.name.trim() || !form.email.includes("@")) { toast.error("Enter a name and a valid email"); return; }
    const candidate: AppUser = { id: `u${Date.now()}`, name: form.name.trim(), email: form.email.trim(), role: form.role, team: form.team, status: "invited", lastLogin: "", mfa: false };
    let created: AppUser;
    try { const response = await apiPost<{ data?: AppUser; user?: AppUser }>("users", candidate); created = extractData(response, "user", candidate); setList((l) => [created, ...l]); } catch (error) { toast.error(error instanceof Error ? error.message : "Invitation was not saved"); return; }
    setOpen(false);
    setForm({ name: "", email: "", role: "Agent", team: "General" });
    try {
      await apiPost(`users/${created.id}/invite`);
      toast.success(`Invitation sent to ${created.email}`);
    } catch (error) {
      toast.warning(`User record created for ${created.email}`, { description: error instanceof Error ? error.message : "Email delivery is unavailable." });
    }
  }
  async function resendInvite(user: AppUser) {
    try {
      await apiPost(`users/${user.id}/invite`);
      toast.success(`Invitation sent to ${user.email}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invitation delivery is unavailable");
    }
  }
  const toggleStatus = async (u: AppUser) => {
    const s = u.status === "disabled" ? "active" : "disabled";
    try { await apiPatch(`users/${u.id}`, { status: s }); } catch (error) { toast.error(error instanceof Error ? error.message : "User status was not saved"); return; }
    setList((l) => l.map((x) => (x.id === u.id ? { ...x, status: s } : x)));
    toast(`${u.name} ${s === "active" ? "re-activated" : "disabled"}`);
  };

  function startEdit(user: AppUser) {
    setEditing(user);
    setEditForm({ name: user.name, email: user.email, role: user.role, team: user.team });
  }

  async function saveEdit() {
    if (!editing || !editForm.name.trim() || !editForm.email.includes("@")) {
      toast.error("Enter a name and valid email");
      return;
    }
    const updated = { ...editing, name: editForm.name.trim(), email: editForm.email.trim(), role: editForm.role, team: editForm.team.trim() || "General" };
    try { await apiPatch(`users/${editing.id}`, updated); } catch (error) { toast.error(error instanceof Error ? error.message : "User was not saved"); return; }
    setList((current) => current.map((user) => user.id === editing.id ? updated : user));
    setEditing(null);
    toast.success(`${updated.name} updated`);
  }

  async function deleteUser() {
    if (!deleteTarget) return;
    try { await apiDelete(`users/${deleteTarget.id}`); } catch (error) { toast.error(error instanceof Error ? error.message : "User was not deleted"); return; }
    setList((current) => current.filter((user) => user.id !== deleteTarget.id));
    toast.success(`${deleteTarget.name} deleted`);
    setDeleteTarget(null);
  }

  const columns: Column<AppUser>[] = [
    { id: "name", header: "User", sortValue: (u) => u.name, cell: (u) => <span><span className="block font-medium">{u.name}</span><span className="text-[11px] text-muted-foreground">{u.email}</span></span> },
    { id: "role", header: "Role", sortValue: (u) => u.role, cell: (u) => <StatusBadge status={u.role} tone="neutral" /> },
    { id: "team", header: "Team", cell: (u) => u.team, sortValue: (u) => u.team },
    { id: "status", header: "Status", cell: (u) => <StatusBadge status={u.status} />, sortValue: (u) => u.status },
    { id: "mfa", header: "2-step login", cell: (u) => <StatusBadge status={u.mfa ? "on" : "off"} /> },
    { id: "last", header: "Last sign-in", cell: (u) => <span className="font-mono text-xs">{u.lastLogin ? fmtTime(u.lastLogin) : "—"}</span>, sortValue: (u) => u.lastLogin },
    { id: "act", header: "Actions", className: "text-right", cell: (u) => (
      <div className="flex justify-end gap-1">
        {u.status === "invited" ? <Button size="sm" variant="outline" onClick={() => void resendInvite(u)}>Resend</Button> : <Button size="sm" variant="outline" onClick={() => toggleStatus(u)}>{u.status === "disabled" ? "Enable" : "Disable"}</Button>}
        <Button size="sm" variant="outline" onClick={() => startEdit(u)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
        <Button size="sm" variant="outline" onClick={() => setDeleteTarget(u)} aria-label={`Delete ${u.name}`}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
      </div>
    ) },
  ];

  async function savePermissions() {
    try {
      await apiPut("settings", { rolePermissions: permissions });
      toast.success("Role permissions saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save permissions");
    }
  }

  return (
    <AdminShell>
      <PageHeader title="Users & Roles" description="Who can sign in and what they are allowed to do."
        actions={<Button onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" />Invite user</Button>} />
      <DataTable label="Users" rows={rows} columns={columns} rowKey={(u) => u.id}
        searchText={(u) => `${u.name} ${u.email} ${u.team}`} searchPlaceholder="Search users…"
        toolbar={<>
          <FilterSelect label="Roles" value={role} onChange={setRole} options={roles} />
          <FilterSelect label="Statuses" value={status} onChange={setStatus} options={["active", "invited", "disabled"]} />
        </>} />
      <Panel title="What each role can do" action={<Button size="sm" onClick={savePermissions}><Save className="h-4 w-4" />Save changes</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground"><th className="py-2 text-left font-medium">Permission</th>{roles.map((r) => <th key={r} className="py-2 font-medium">{r}</th>)}</tr></thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p.perm} className="border-t border-border">
                  <td className="py-2">{p.perm}</td>
                  {roles.map((role) => {
                    const key = roleKey[role];
                    return <td key={key} className="text-center"><Checkbox aria-label={`${p.perm} for ${role}`} checked={p[key]} onCheckedChange={(checked) => setPermissions((current) => current.map((item) => item.perm === p.perm ? { ...item, [key]: checked === true } : item))} /></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite user</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="un">Full name</Label><Input id="un" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ue">Email</Label><Input id="ue" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Role</Label><FilterSelect label="Role" value={form.role} onChange={(v) => setForm({ ...form, role: v as AppUser["role"] })} options={roles} includeAll={false} className="w-full" /></div>
              <div className="grid gap-1.5"><Label>Team</Label><FilterSelect label="Team" value={form.team} onChange={(v) => setForm({ ...form, team: v })} options={["Billing", "Technical", "Sales", "General"]} includeAll={false} className="w-full" /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={invite}>Send invitation</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={editing !== null} onOpenChange={(isOpen) => { if (!isOpen) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit user</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="edit-user-name">Full name</Label><Input id="edit-user-name" value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="edit-user-email">Email</Label><Input id="edit-user-email" type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>Role</Label><FilterSelect label="Role" value={editForm.role} onChange={(value) => setEditForm({ ...editForm, role: value as AppUser["role"] })} options={roles} includeAll={false} className="w-full" /></div>
              <div className="grid gap-1.5"><Label htmlFor="edit-user-team">Team</Label><Input id="edit-user-team" value={editForm.team} onChange={(event) => setEditForm({ ...editForm, team: event.target.value })} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveEdit}>Save changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteTarget !== null} onOpenChange={(isOpen) => { if (!isOpen) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete user?</DialogTitle><DialogDescription>{deleteTarget?.name} will be removed from this workspace.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" onClick={deleteUser}>Delete user</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
