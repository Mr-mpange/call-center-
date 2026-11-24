import { useState, type FormEvent } from "react";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { Ban, Phone, Plus, ShieldCheck, UserRound, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { KpiCard, PageHeader, StatusBadge } from "@/components/kit";
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
import { initials, isDialable } from "@/lib/phone";
import { fmtTime } from "@/lib/format";
import type { Contact } from "@/lib/domain-types";
import { apiPost, extractData, useApiCollection } from "@/lib/api";

export function ContactsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const canManageContacts = pathname === "/admin/contacts";
  const phone = usePhone();
  const { items: list, setItems: setList } = useApiCollection<Contact>("contacts", [], "contacts");
  const [city, setCity] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    company: "",
    city: "Dar es Salaam",
  });
  const cities = [...new Set(list.map((c) => c.city))];
  const rows = list.filter((c) => matches(c.city, city));
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = list.filter((c) => Date.parse(c.lastContact) >= weekStart).length;
  const phoneErr = form.phone !== "" && !isDialable(form.phone);

  const columns: Column<Contact>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (c) => c.name,
      cell: (c) => (
        <span className="flex items-center gap-2.5">
          <span className="soft-icon h-8 w-8 text-[11px] font-semibold text-accent-foreground">
            {initials(c.name)}
          </span>
          <span>
            <span className="block font-medium">{c.name}</span>
            <span className="text-[11px] text-muted-foreground">{c.email}</span>
          </span>
        </span>
      ),
    },
    {
      id: "phone",
      header: "Phone",
      cell: (c) => <span className="font-mono text-xs">{c.phone}</span>,
    },
    { id: "company", header: "Company", cell: (c) => c.company, sortValue: (c) => c.company },
    { id: "city", header: "City", cell: (c) => c.city, sortValue: (c) => c.city },
    {
      id: "calls",
      header: "Calls",
      cell: (c) => <span className="font-mono">{c.totalCalls}</span>,
      sortValue: (c) => c.totalCalls,
    },
    {
      id: "last",
      header: "Last contact",
      cell: (c) => <span className="font-mono text-xs">{fmtTime(c.lastContact)}</span>,
      sortValue: (c) => c.lastContact,
    },
    {
      id: "consent",
      header: "Consent",
      cell: (c) =>
        c.doNotCall ? (
          <StatusBadge status="do not call" />
        ) : (
          <StatusBadge status={c.consent ? "consented" : "no consent"} />
        ),
    },
    {
      id: "act",
      header: "",
      className: "text-right",
      cell: (c) => (
        <Button
          size="sm"
          variant="ghost"
          disabled={c.doNotCall}
          title={c.doNotCall ? "Customer is on the do-not-call list" : undefined}
          onClick={() => phone.dial(c.phone, c.name)}
          aria-label={`Call ${c.name}`}
        >
          <Phone className="h-3.5 w-3.5" /> Call
        </Button>
      ),
    },
  ];

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !isDialable(form.phone)) return;
    const candidate: Contact = { id: `p${Date.now()}`, ...form, lastContact: new Date().toISOString(), totalCalls: 0, doNotCall: false, consent: true, notes: "" };
    try {
      const response = await apiPost<{ data?: Contact; contact?: Contact }>("contacts", candidate);
      setList((l) => [extractData(response, "contact", candidate), ...l]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Contact was not saved");
      return;
    }
    toast.success(`${form.name} added to contacts`);
    setForm({ name: "", phone: "", email: "", company: "", city: "Dar es Salaam" });
    setOpen(false);
  }

  return (
    <AppShell>
      <PageHeader
        title="Contacts"
        description={canManageContacts ? "Customer records, consent and quick dialing." : "Customers are matched from the reached caller number."}
        actions={canManageContacts ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add contact
          </Button>
        ) : undefined}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total contacts"
          value={String(list.length)}
          icon={Users}
          hint="this month"
        />
        <KpiCard label="New this week" value={String(newThisWeek)} icon={UserRound} />
        <KpiCard
          label="With consent"
          value={String(list.filter((c) => c.consent).length)}
          icon={ShieldCheck}
        />
        <KpiCard
          label="Do not call"
          value={String(list.filter((c) => c.doNotCall).length)}
          icon={Ban}
        />
      </div>
      <DataTable
        label="Contacts"
        rows={rows}
        columns={columns}
        rowKey={(c) => c.id}
        searchText={(c) => `${c.name} ${c.phone} ${c.email} ${c.company}`}
        searchPlaceholder="Search name, phone, company…"
        toolbar={<FilterSelect label="Cities" value={city} onChange={setCity} options={cities} />}
      />
      {canManageContacts && <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add contact</DialogTitle>
          </DialogHeader>
          <form id="add-contact" onSubmit={add} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-name">Full name</Label>
              <Input
                id="c-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone</Label>
              <Input
                id="c-phone"
                required
                placeholder="+255 7xx xxx xxx"
                value={form.phone}
                aria-invalid={phoneErr}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              {phoneErr && <p className="text-xs text-destructive">Enter a valid phone number.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input
                id="c-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-co">Company</Label>
              <Input
                id="c-co"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-city">City</Label>
              <Input
                id="c-city"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="add-contact">
              Save contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </AppShell>
  );
}
