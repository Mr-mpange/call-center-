import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, BadgeCheck, Phone, PhoneCall, PhoneIncoming, Plus, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { Panel, StatusBadge } from "@/components/kit";
import { usePhone } from "@/components/phone/PhoneProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  groupReady, MAX_FORWARD_NUMBERS, memberError, MIN_FORWARD_NUMBERS, runHunt,
  type ForwardGroup, type ForwardMember, type HuntStep, type MemberState, type RingStrategy,
} from "@/lib/ivr";
import { isDialable } from "@/lib/phone";
import { cn } from "@/lib/utils";

const STRATEGIES: { id: RingStrategy; title: string; body: string }[] = [
  { id: "sequential", title: "One by one", body: "Ring phone 1, then 2, then 3… until someone free answers." },
  { id: "simultaneous", title: "All at once", body: "Every phone rings together. First to pick up gets the call." },
  { id: "round-robin", title: "Take turns", body: "Start with the phone after the one that answered last, to share calls fairly." },
];
const STATE_LABEL: Record<MemberState, string> = { available: "Free", busy: "Busy", "no-answer": "Doesn't answer" };
const RESULT: Record<HuntStep["result"], { text: string; tone: string }> = {
  answered: { text: "Answered", tone: "success" }, busy: { text: "Busy, skipped", tone: "warning" },
  "no-answer": { text: "No answer", tone: "neutral" }, off: { text: "Switched off", tone: "neutral" },
};

interface Props { groups: ForwardGroup[]; setGroups: (fn: (g: ForwardGroup[]) => ForwardGroup[]) => void }

export function Forwarding({ groups, setGroups }: Props) {
  const phone = usePhone();
  const [selId, setSelId] = useState(groups[0]?.id ?? "");
  const [connectOpen, setConnectOpen] = useState(false);
  const [name, setName] = useState("");
  const [num, setNum] = useState("");
  const [run, setRun] = useState<{ caller: string; steps: HuntStep[]; shown: number; ringing: string[]; done: boolean; answeredBy: ForwardMember | null } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const g = groups.find((x) => x.id === selId) ?? groups[0];
  if (!g) return null;
  const on = g.members.filter((m) => m.enabled).length;
  const ready = groupReady(g);
  const patch = (p: Partial<ForwardGroup>) => setGroups((all) => all.map((x) => (x.id === g.id ? { ...x, ...p } : x)));
  const patchMember = (id: string, p: Partial<ForwardMember>) => patch({ members: g.members.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= g.members.length) return;
    const list = [...g.members];
    [list[i], list[j]] = [list[j]!, list[i]!];
    patch({ members: list });
  };

  function addMember() {
    const err = memberError(g!.members, num);
    if (err) { toast.error(err); return; }
    patch({ members: [...g!.members, { id: `m${Date.now().toString(36)}`, name: name.trim() || num, number: num.trim(), enabled: true, state: "available" }] });
    setName(""); setNum("");
  }

  function testCall() {
    if (!ready) { toast.error(`Switch on at least ${MIN_FORWARD_NUMBERS} phones first`, { description: `${on} of ${MIN_FORWARD_NUMBERS} are on.` }); return; }
    timers.current.forEach(clearTimeout); timers.current = [];
    const caller = { name: "Test caller", phone: "" };
    const result = runHunt(g!);
    const step = 1100;
    setRun({ caller: caller.name, steps: result.steps, shown: 0, ringing: [], done: false, answeredBy: null });
    const finish = () => {
      setRun((r) => r && { ...r, done: true, ringing: [], answeredBy: result.answeredBy, shown: result.steps.length });
      const by = result.answeredBy;
      if (!by) {
        toast.warning("Nobody was free", { description: g!.fallback === "voicemail" ? "The caller was sent to voicemail." : g!.fallback === "queue" ? "The caller was put in the General queue." : "The call was ended politely." });
        return;
      }
      patch({ lastAnsweredId: by.id });
      if (by.isSoftphone) toast.info("The configured softphone will receive incoming calls from the voice provider.");
      else toast.info(`${by.name} is the selected forwarding target for this test.`);
    };
    if (g!.strategy === "simultaneous") {
      setRun((r) => r && { ...r, ringing: result.steps.filter((s) => s.result !== "off").map((s) => s.member.id) });
      timers.current.push(window.setTimeout(finish, step * 2));
      return;
    }
    result.steps.forEach((s, i) => {
      timers.current.push(window.setTimeout(() => setRun((r) => r && { ...r, ringing: s.result === "off" ? [] : [s.member.id], shown: i }), i * step));
    });
    timers.current.push(window.setTimeout(finish, result.steps.length * step));
  }

  const stepFor = (id: string) => {
    if (!run) return null;
    const i = run.steps.findIndex((s) => s.member.id === id);
    if (i < 0) return null;
    if (run.done || i < run.shown) return run.steps[i]!;
    return null;
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      <div className="space-y-3">
        <Button className="w-full" onClick={() => setConnectOpen(true)}><Plus className="h-4 w-4" />Connect your own number</Button>
        {groups.map((x) => {
          const n = x.members.filter((m) => m.enabled).length;
          return (
            <button key={x.id} type="button" onClick={() => { setSelId(x.id); setRun(null); }}
              className={cn("soft-card w-full rounded-[16px] border-0 p-3 text-left transition", x.id === g.id ? "surface-recessed text-accent-foreground" : "")}>
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{x.name}</span>
                <StatusBadge status={groupReady(x) ? "active" : "draft"} />
              </span>
              <span className="mt-1 block font-mono text-sm">{x.ownNumber}</span>
              <span className="mt-2 block text-xs text-muted-foreground">Forwards to {n} phone{n === 1 ? "" : "s"} · {STRATEGIES.find((s) => s.id === x.strategy)!.title.toLowerCase()}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        <Panel title={`${g.name} · ${g.ownNumber}`} action={g.verified ? <span className="inline-flex items-center gap-1 text-xs text-success"><BadgeCheck className="h-3.5 w-3.5" />Number verified</span> : null}>
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex justify-between text-xs"><span className="font-medium">Phones switched on</span><span className="font-mono">{on} / {MIN_FORWARD_NUMBERS} minimum</span></div>
              <Progress value={Math.min(100, (on / MIN_FORWARD_NUMBERS) * 100)} className="h-2" />
              {!ready && <p className="mt-1.5 text-xs text-destructive">Add or switch on {Math.max(0, MIN_FORWARD_NUMBERS - on)} more phone{MIN_FORWARD_NUMBERS - on === 1 ? "" : "s"} so calls can always find someone.</p>}
            </div>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="How phones ring">
              {STRATEGIES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={g.strategy === s.id} onClick={() => patch({ strategy: s.id })}
                  className={cn("soft-card rounded-[16px] border-0 p-3 text-left transition", g.strategy === s.id ? "surface-recessed text-accent-foreground" : "hover:text-foreground")}>
                  <span className="block text-sm font-semibold">{s.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.body}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Ring each phone for</Label>
                <Select value={String(g.ringSeconds)} onValueChange={(v) => patch({ ringSeconds: Number(v) })}>
                  <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{[10, 15, 20, 30].map((s) => <SelectItem key={s} value={String(s)}>{s} seconds</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">If nobody answers</Label>
                <Select value={g.fallback} onValueChange={(v) => patch({ fallback: v as ForwardGroup["fallback"] })}>
                  <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="voicemail">Send to voicemail</SelectItem>
                    <SelectItem value="queue">Put in General queue</SelectItem>
                    <SelectItem value="hangup">Play goodbye and end</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="ml-auto flex items-end gap-2">
                <Button variant="outline" onClick={() => phone.dial(g.ownNumber, `${g.name} line`)}><Phone className="h-4 w-4" />Call this number</Button>
                <Button onClick={testCall}><PhoneIncoming className="h-4 w-4" />Test incoming call</Button>
              </div>
            </div>
          </div>
        </Panel>

        {run && (
          <div className="rounded-lg border border-primary/30 bg-info-soft p-3 text-sm" aria-live="polite">
            <span className="font-medium">Test call from {run.caller}: </span>
            {!run.done ? "ringing phones…" : run.answeredBy ? `answered by ${run.answeredBy.name}.` : "nobody was free, the backup option was used."}
          </div>
        )}

        <Panel title={`Phones in this group (${g.members.length}/${MAX_FORWARD_NUMBERS})`}>
          <ol className="divide-y divide-border">
            {g.members.map((m, i) => {
              const st = stepFor(m.id);
              const ringing = run?.ringing.includes(m.id);
              return (
                <li key={m.id} className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 sm:grid-cols-[auto_1fr_auto_auto]", !m.enabled && "opacity-50")}>
                  <span className={cn("soft-icon relative grid h-8 w-8 place-items-center font-mono text-xs font-semibold", ringing ? "bg-success text-success-foreground" : "text-muted-foreground")}>
                    {ringing && <span className="absolute inset-0 animate-ping rounded-full bg-success/40" aria-hidden />}
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">{m.isSoftphone && <Smartphone className="h-3.5 w-3.5 text-primary" />}{m.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{m.number}</span>
                    {st && <span className="ml-2"><StatusBadge status={RESULT[st.result].text} tone={RESULT[st.result].tone as "success"} /></span>}
                    {ringing && !st && <span className="ml-2 text-xs font-medium text-success">Ringing…</span>}
                  </span>
                  <span className="hidden sm:block">
                    <Select value={m.state} onValueChange={(v) => patchMember(m.id, { state: v as MemberState })}>
                      <SelectTrigger className="h-8 w-36 text-xs" aria-label={`Test behaviour for ${m.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{(Object.keys(STATE_LABEL) as MemberState[]).map((s) => <SelectItem key={s} value={s}>When tested: {STATE_LABEL[s]}</SelectItem>)}</SelectContent>
                    </Select>
                  </span>
                  <span className="flex items-center gap-1">
                    <Switch checked={m.enabled} onCheckedChange={(v) => patchMember(m.id, { enabled: v })} aria-label={`Switch ${m.name} on or off`} />
                    <Button variant="ghost" size="sm" className="h-8 px-1.5" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${m.name} up`}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-8 px-1.5" onClick={() => move(i, 1)} disabled={i === g.members.length - 1} aria-label={`Move ${m.name} down`}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-8 px-1.5" onClick={() => phone.dial(m.number, m.name)} aria-label={`Call ${m.name}`}><PhoneCall className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-8 px-1.5" onClick={() => patch({ members: g.members.filter((x) => x.id !== m.id) })} aria-label={`Remove ${m.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </span>
                </li>
              );
            })}
          </ol>
          <form className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); addMember(); }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Asha's mobile" className="h-9 flex-1 sm:max-w-56" aria-label="Phone name" />
            <Input value={num} onChange={(e) => setNum(e.target.value)} placeholder="+255 7xx xxx xxx" inputMode="tel" className="h-9 flex-1 font-mono sm:max-w-56" aria-label="Phone number to add" />
            <Button type="submit" variant="outline" disabled={g.members.length >= MAX_FORWARD_NUMBERS}><Plus className="h-4 w-4" />Add phone</Button>
          </form>
        </Panel>
      </div>

      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} onConnected={(grp) => { setGroups((all) => [...all, grp]); setSelId(grp.id); }} />
    </div>
  );
}

function ConnectDialog({ open, onOpenChange, onConnected }: { open: boolean; onOpenChange: (v: boolean) => void; onConnected: (g: ForwardGroup) => void }) {
  const [step, setStep] = useState<"details" | "code">("details");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState("");

  useEffect(() => { if (open) { setStep("details"); setName(""); setNumber(""); setCode(""); } }, [open]);

  function sendCode() {
    if (!isDialable(number)) { toast.error("Enter a valid phone number"); return; }
    toast.info("Number verification is unavailable until the SMS verification provider is configured.");
  }
  function verify() {
    if (code.trim() !== sent) { toast.error("That code is not right"); return; }
    onConnected({
      id: `g${Date.now().toString(36)}`, name: name.trim() || "My business line", ownNumber: number.trim(), verified: true,
      strategy: "sequential", ringSeconds: 15, fallback: "voicemail", lastAnsweredId: null,
      members: [{ id: `m${Date.now().toString(36)}`, name: "My softphone (Ext 101)", number: "101", enabled: true, state: "available", isSoftphone: true }],
    });
    toast.success("Number connected", { description: `Now add at least ${MIN_FORWARD_NUMBERS - 1} more phones.` });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect your own number</DialogTitle>
          <DialogDescription>Calls to this number will be forwarded to a group of phones you choose (at least {MIN_FORWARD_NUMBERS}).</DialogDescription>
        </DialogHeader>
        {step === "details" ? (
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="cn-name">Name for this line</Label><Input id="cn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mwanza branch" /></div>
            <div className="space-y-1.5"><Label htmlFor="cn-num">Your phone number</Label><Input id="cn-num" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+255 7xx xxx xxx" inputMode="tel" className="font-mono" /></div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="cn-code">Enter the 6-digit code we sent to {number}</Label>
            <Input id="cn-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" className="font-mono tracking-[0.4em]" autoFocus />
            <button type="button" onClick={sendCode} className="text-xs text-primary hover:underline">Send a new code</button>
          </div>
        )}
        <DialogFooter>
          {step === "details"
            ? <Button onClick={sendCode}><ShieldCheck className="h-4 w-4" />Send verification code</Button>
            : <Button onClick={verify} disabled={code.length !== 6}><BadgeCheck className="h-4 w-4" />Verify and connect</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
