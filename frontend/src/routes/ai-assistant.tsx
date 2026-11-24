import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Bot, Languages, Send, Sparkles, UserRound, Workflow, Zap, PhoneCall } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { KpiCard, PageHeader, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { fmtDuration, fmtTime } from "@/lib/format";
import type { CallRecord, Intent } from "@/lib/domain-types";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo";
import { apiPost, useApiResource } from "@/lib/api";

export const Route = createFileRoute("/ai-assistant")({
  head: () => pageHead("AI Assistant", "Kiswahili and English AI assistant: test conversations and manage what it can answer."),
  component: AiPage,
});

interface Msg { who: "user" | "bot"; text: string; intent?: string | undefined }

const promptSuggestions = ["Habari, nimetozwa mara mbili kwenye ankara", "What is my balance?", "Mtandao haifanyi kazi tangu jana", "I want to speak to a person"];

const emptyAssistant = { intents: [] as Intent[], calls: [] as CallRecord[] };

function AiPage() {
  const { value: assistant } = useApiResource("ai-assistant", emptyAssistant);
  const list = assistant.intents;
  const calls = assistant.calls;
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [msgs, setMsgs] = useState<Msg[]>([{ who: "bot", text: "The assistant is connected to the workspace AI service. Ask a question to begin." }]);
  const [input, setInput] = useState("");
  const [callSummaries, setCallSummaries] = useState<Record<string, string>>({});
  const [summarizingCall, setSummarizingCall] = useState<string | null>(null);
  const [showAllCalls, setShowAllCalls] = useState(false);
  const total = list.reduce((s, i) => s + i.calls, 0);
  const auto = list.reduce((s, i) => s + i.automated, 0);

  async function ask(text: string) {
    if (!text.trim()) return;
    const question = text.trim();
    setMsgs((m) => [...m, { who: "user", text: question }]);
    setInput("");
    try { const response = await apiPost<{ answer?: string; data?: { answer?: string } }>("ai/ask", { question }); setMsgs((m) => [...m, { who: "bot", text: response.answer ?? response.data?.answer ?? "No answer was returned by the AI service." }]); }
    catch (error) { toast.error(error instanceof Error ? error.message : "AI service is unavailable"); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); ask(input); };

  async function train(i: Intent) {
    try { await apiPost("ai/train", i); toast.success(`Training queued for “${i.name}”`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Training was not queued"); }
  }

  async function summarizePersistedCall(call: CallRecord) {
    setSummarizingCall(call.id);
    try {
      const response = await apiPost<{ summary?: { summary?: string; reason?: string } }>(`calls/${call.id}/summary-jobs`, {});
      const text = response.summary?.summary || response.summary?.reason || "No summary was returned by the AI service.";
      setCallSummaries((previous) => ({ ...previous, [call.id]: text }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI summary could not be generated");
    } finally {
      setSummarizingCall(null);
    }
  }

  const columns: Column<Intent>[] = [
    { id: "name", header: "Customer need", sortValue: (i) => i.name, cell: (i) => <span><span className="block font-medium">{i.name}</span><span className="text-[11px] italic text-muted-foreground">“{i.example}”</span></span> },
    { id: "calls", header: "Calls", className: "text-right", cell: (i) => <span className="font-mono">{i.calls}</span>, sortValue: (i) => i.calls },
    { id: "auto", header: "Solved by AI", sortValue: (i) => i.automated / i.calls, cell: (i) => {
      const pct = Math.round((i.automated / i.calls) * 100);
      return <div className="w-32"><Progress value={pct} className="h-1.5" /><span className="font-mono text-[11px] text-muted-foreground">{i.automated} · {pct}%</span></div>;
    } },
    { id: "handoff", header: "Passes to", cell: (i) => i.handoff },
    { id: "on", header: "Active", cell: (i) => <Switch checked={enabled[i.id] ?? true} onCheckedChange={(v) => { setEnabled((e) => ({ ...e, [i.id]: v })); toast(`${i.name} ${v ? "turned on" : "turned off"}`); }} aria-label={`Turn ${i.name} on or off`} /> },
    { id: "act", header: "", className: "text-right", cell: (i) => <Button size="sm" variant="outline" onClick={() => train(i)}><Sparkles className="h-3.5 w-3.5" />Train</Button> },
  ];

  return (
    <AppShell>
      <PageHeader title="AI Assistant" description="The assistant answers callers in Kiswahili and English and passes harder cases to your agents. Try it below." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Calls the AI handled" value={total.toLocaleString()} icon={Bot} />
        <KpiCard label="Solved without an agent" value={`${total ? Math.round((auto / total) * 100) : 0}%`} icon={Zap} />
        <KpiCard label="Passed to agents" value={(total - auto).toLocaleString()} icon={Workflow} />
        <KpiCard label="Kiswahili conversations" value="—" icon={Languages} hint="Language metadata unavailable" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Try the assistant" className="lg:col-span-3">
          <div className="surface-recessed flex h-80 flex-col gap-3 overflow-y-auto rounded-[18px] p-3" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={cn("flex items-end gap-2", m.who === "user" && "flex-row-reverse")}>
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", m.who === "bot" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>
                  {m.who === "bot" ? <Bot className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                </span>
                <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", m.who === "bot" ? "soft-card rounded-bl-sm text-card-foreground" : "rounded-br-sm bg-primary text-primary-foreground")}>
                  {m.text}
                  {m.intent && <span className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Detected: {m.intent}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {promptSuggestions.map((s) => <Button key={s} size="sm" variant="outline" className="h-7 text-xs" onClick={() => ask(s)}>{s}</Button>)}
          </div>
          <form onSubmit={submit} className="mt-3 flex gap-2">
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type like a caller, in Kiswahili or English…" aria-label="Message" />
            <Button type="submit"><Send className="h-4 w-4" />Send</Button>
          </form>
        </Panel>
        <Panel title="How it decides" className="lg:col-span-2">
          <ol className="space-y-3 text-sm">
            {[
              ["Listens", "Turns the caller's speech into text in Kiswahili or English."],
              ["Understands", "Matches what the caller needs to one of the needs in the table below."],
              ["Answers or passes on", "Answers simple questions itself; sends billing, technical or sales issues to the right team."],
              ["Summarises", "Writes a short call summary for the agent and the call history."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent font-mono text-xs text-accent-foreground">{i + 1}</span>
                <span><span className="block font-medium">{t}</span><span className="text-muted-foreground">{d}</span></span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <DataTable label="What the assistant can handle" rows={list} columns={columns} rowKey={(i) => i.id}
        searchText={(i) => `${i.name} ${i.example} ${i.handoff}`} searchPlaceholder="Search needs…" />

      <Panel title="Call summaries">
        <p className="mb-3 text-xs text-muted-foreground">Summaries use the complete stored transcript and the configured AI provider.</p>
        <div className="max-h-[520px] space-y-2 overflow-y-auto">
          {(showAllCalls ? calls : calls.slice(0, 10)).map((call) => <div key={call.id} className="soft-card rounded-[16px] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{call.caller} <span className="font-normal text-muted-foreground">· {call.queue}</span></p><p className="text-xs text-muted-foreground">{fmtTime(call.at)} · {call.direction} · {fmtDuration(call.durationSec)} · {call.outcome}</p></div><Button size="sm" variant="ghost" onClick={() => void summarizePersistedCall(call)} disabled={summarizingCall === call.id}><PhoneCall className="h-3.5 w-3.5" />{summarizingCall === call.id ? "Generating…" : callSummaries[call.id] ? "Regenerate summary" : "Summarize call"}</Button></div>
            {callSummaries[call.id] && <p className="surface-flat mt-2 rounded-xl p-2 text-xs leading-relaxed">{callSummaries[call.id]}</p>}
          </div>)}
        </div>
        {calls.length > 10 && <Button className="mt-3" variant="outline" size="sm" onClick={() => setShowAllCalls((value) => !value)}>{showAllCalls ? "Show recent calls" : `Show all ${calls.length} calls`}</Button>}
      </Panel>
    </AppShell>
  );
}
