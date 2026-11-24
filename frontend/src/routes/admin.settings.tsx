import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { AdminShell } from "@/components/AppShell";
import { FilterSelect } from "@/components/FilterSelect";
import { PageHeader, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Queue } from "@/lib/domain-types";
import { apiPut, useApiCollection, useApiResource } from "@/lib/api";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/admin/settings")({
  head: () => pageHead("Settings", "Organization, call routing, recording and notification settings."),
  component: SettingsPage,
});

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
      <div><Label htmlFor={id} className="text-sm font-medium">{label}</Label><p className="text-xs text-muted-foreground">{hint}</p></div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

type SettingsData = {
  company: Record<string, unknown>;
  queues: Queue[];
  privacy: Record<string, unknown>;
  alerts: Record<string, boolean>;
  businessHours: Array<{ day: string; open: string; close: string }>;
};

const emptySettings: SettingsData = {
  company: {},
  queues: [],
  privacy: {},
  alerts: {},
  businessHours: [],
};

function normalizeSettings(value: SettingsData): SettingsData {
  return {
    ...emptySettings,
    ...value,
    company: value?.company && typeof value.company === "object" ? value.company : {},
    queues: Array.isArray(value?.queues) ? value.queues : [],
    privacy: value?.privacy && typeof value.privacy === "object" ? value.privacy : {},
    alerts: value?.alerts && typeof value.alerts === "object" ? value.alerts : {},
    businessHours: Array.isArray(value?.businessHours) ? value.businessHours : [],
  };
}

function SettingsPage() {
  const { value: rawSettings } = useApiResource<SettingsData>("settings", emptySettings);
  const settings = normalizeSettings(rawSettings);
  const { items: queues, setItems: setQueues } = useApiCollection<Queue>("queues", [], "queues");
  const [org, setOrg] = useState({ name: "", email: "", phone: "", city: "", language: "English", timezone: "Africa/Dar_es_Salaam" });
  const [flags, setFlags] = useState({ record: false, consent: false, dnc: false, pii: false, wrapUp: false, autoAnswer: false, aiFirst: false, smsMissed: false, emailDaily: false, slack: false, slaAlert: false, deletionRequests: false });
  const [retentionDays, setRetentionDays] = useState("0");
  useEffect(() => {
    const company = settings.company;
    const privacy = settings.privacy;
    const alerts = settings.alerts;
    setOrg({
      name: String(company.name ?? ""),
      email: String(company.email ?? ""),
      phone: String(company.phone ?? ""),
      city: String(company.city ?? ""),
      language: String(company.defaultLanguage ?? company.language ?? "English"),
      timezone: String(company.timezone ?? "Africa/Dar_es_Salaam"),
    });
    setFlags({
      record: Boolean(privacy.record ?? privacy.recordCalls ?? false),
      consent: Boolean(privacy.consent ?? privacy.recordingConsent ?? false),
      dnc: Boolean(privacy.dnc ?? privacy.doNotCall ?? false),
      pii: Boolean(privacy.pii ?? privacy.maskPii ?? false),
      wrapUp: Boolean(privacy.wrapUp ?? false),
      autoAnswer: Boolean(privacy.autoAnswer ?? false),
      aiFirst: Boolean(privacy.aiFirst ?? false),
      smsMissed: Boolean(alerts.smsMissed ?? alerts.missedCalls ?? false),
      emailDaily: Boolean(alerts.emailDaily ?? false),
      slack: Boolean(alerts.slack ?? false),
      slaAlert: Boolean(alerts.slaAlert ?? alerts.slaBreach ?? false),
      deletionRequests: Boolean(privacy.deletionRequests ?? false),
    });
    setRetentionDays(String(privacy.retentionDays ?? 0));
  }, [rawSettings]);
  const flag = (k: keyof typeof flags) => (v: boolean) => setFlags((f) => ({ ...f, [k]: v }));
  const save = async (what: string) => {
    try { await apiPut("settings", { company: org, queues, privacy: { ...settings.privacy, retentionDays: Number(retentionDays), ...flags }, alerts: flags, businessHours: settings.businessHours }); toast.success(`${what} saved`); }
    catch (error) { toast.error(error instanceof Error ? error.message : `${what} was not saved`); }
  };
  const setQ = (id: string, patch: Partial<Queue>) => setQueues((l) => l.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  return (
    <AdminShell>
      <PageHeader title="Settings" description="Company details, how calls are routed, recording rules and alerts." />
      <Tabs defaultValue="org">
        <TabsList className="flex-wrap">
          <TabsTrigger value="org">Organization</TabsTrigger>
          <TabsTrigger value="routing">Call routing</TabsTrigger>
          <TabsTrigger value="recording">Recording & privacy</TabsTrigger>
          <TabsTrigger value="notify">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="org" className="mt-4">
          <Panel title="Company details" action={<Button size="sm" onClick={() => save("Company details")}><Save className="h-3.5 w-3.5" />Save</Button>}>
            <div className="grid gap-4 sm:grid-cols-2">
              {([["name", "Company name"], ["email", "Operations email"], ["phone", "Main hotline"], ["city", "Head office city"]] as const).map(([k, l]) => (
                <div key={k} className="grid gap-1.5"><Label htmlFor={`org-${k}`}>{l}</Label><Input id={`org-${k}`} value={org[k]} readOnly={k === "email"} aria-readonly={k === "email"} onChange={(e) => { if (k !== "email") setOrg({ ...org, [k]: e.target.value }); }} /><p className="text-xs text-muted-foreground">{k === "email" ? "Managed from the organization owner account." : ""}</p></div>
              ))}
              <div className="grid gap-1.5"><Label>Default language</Label><FilterSelect label="Language" value={org.language} onChange={(v) => setOrg({ ...org, language: v })} options={["Kiswahili", "English"]} includeAll={false} className="w-full" /></div>
              <div className="grid gap-1.5"><Label>Time zone</Label><Input value={org.timezone} readOnly /></div>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="routing" className="mt-4 space-y-4">
          <Panel title="Queues" action={<Button size="sm" onClick={() => save("Queue settings")}><Save className="h-3.5 w-3.5" />Save</Button>}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Queue</TableHead><TableHead>Priority</TableHead><TableHead>Answer within (sec)</TableHead><TableHead>If nobody answers</TableHead></TableRow></TableHeader>
                <TableBody>
                  {queues.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-medium">{q.name}</TableCell>
                      <TableCell><FilterSelect label="Priority" value={q.priority} onChange={(v) => setQ(q.id, { priority: v as Queue["priority"] })} options={["High", "Normal", "Low"]} includeAll={false} className="w-28" /></TableCell>
                      <TableCell><Input type="number" min={10} className="h-9 w-24 font-mono" value={q.slaTargetSec} onChange={(e) => setQ(q.id, { slaTargetSec: Number(e.target.value) || 0 })} aria-label={`${q.name} answer target`} /></TableCell>
                      <TableCell><FilterSelect label="Overflow" value={q.overflowTo} onChange={(v) => setQ(q.id, { overflowTo: v })} options={["General", "Voicemail", "Callback list"]} includeAll={false} className="w-36" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Opening hours">
              <ul className="space-y-2 text-sm">
                {settings.businessHours.map((h) => <li key={h.day} className="flex justify-between"><span>{h.day}</span><span className="font-mono text-xs">{h.open} – {h.close}</span></li>)}
                {settings.businessHours.length === 0 && <li className="text-sm text-muted-foreground">Opening hours are not configured.</li>}
              </ul>
            </Panel>
            <Panel title="Routing rules">
              <Toggle id="aiFirst" label="AI assistant answers first" hint="Simple questions are solved before a caller waits for an agent." checked={flags.aiFirst} onChange={flag("aiFirst")} />
              <Toggle id="wrapUp" label="Wrap-up time after each call" hint="Agents get 30 seconds to finish notes before the next call." checked={flags.wrapUp} onChange={flag("wrapUp")} />
              <Toggle id="autoAnswer" label="Auto-answer for agents" hint="Calls connect without the agent pressing answer." checked={flags.autoAnswer} onChange={flag("autoAnswer")} />
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="recording" className="mt-4">
          <Panel title="Recording & privacy" action={<Button size="sm" onClick={() => save("Privacy settings")}><Save className="h-3.5 w-3.5" />Save</Button>}>
            <Toggle id="record" label="Record calls" hint="Calls are recorded for quality and training." checked={flags.record} onChange={flag("record")} />
            <Toggle id="consent" label="Ask for consent first" hint="Callers hear a short notice and can say no to recording." checked={flags.consent} onChange={flag("consent")} />
            <Toggle id="dnc" label="Respect the do-not-call list" hint="Campaigns skip customers who asked not to be called." checked={flags.dnc} onChange={flag("dnc")} />
            <Toggle id="pii" label="Hide card and ID numbers in transcripts" hint="Sensitive numbers are masked automatically." checked={flags.pii} onChange={flag("pii")} />
            <div className="grid gap-1.5 border-b border-border py-3"><Label htmlFor="recording-retention">Retention period (days)</Label><Input id="recording-retention" type="number" min={1} value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} className="max-w-40" /><p className="text-xs text-muted-foreground">The server must enforce retention, deletion, and legal holds for recordings, transcripts, and summaries.</p></div>
            <Toggle id="deletionRequests" label="Allow authorized deletion requests" hint="Deletion requires server-side policy checks and an audit event." checked={flags.deletionRequests} onChange={flag("deletionRequests")} />
          </Panel>
        </TabsContent>

        <TabsContent value="notify" className="mt-4">
          <Panel title="Alerts" action={<Button size="sm" onClick={() => save("Alert settings")}><Save className="h-3.5 w-3.5" />Save</Button>}>
            <Toggle id="smsMissed" label="SMS customers after a missed call" hint="“Samahani tumekosa simu yako, tutakupigia tena.”" checked={flags.smsMissed} onChange={flag("smsMissed")} />
            <Toggle id="slaAlert" label="Warn supervisors when a queue is too slow" hint="Alert when callers wait longer than the target." checked={flags.slaAlert} onChange={flag("slaAlert")} />
            <Toggle id="emailDaily" label="Daily summary email" hint="Sent to managers every evening at 20:00." checked={flags.emailDaily} onChange={flag("emailDaily")} />
            <Toggle id="slack" label="Slack alerts" hint="Post urgent alerts to a Slack channel." checked={flags.slack} onChange={flag("slack")} />
          </Panel>
        </TabsContent>
      </Tabs>
    </AdminShell>
  );
}
