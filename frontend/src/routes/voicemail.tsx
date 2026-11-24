import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, MailOpen, Pause, Phone, Play, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { FilterSelect, matches } from "@/components/FilterSelect";
import { KpiCard, PageHeader, StatusBadge } from "@/components/kit";
import { usePhone } from "@/components/phone/PhoneProvider";
import { Button } from "@/components/ui/button";
import type { Voicemail } from "@/lib/domain-types";
import { fmtDuration, fmtTime } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { apiDelete, apiPost, useApiCollection } from "@/lib/api";

export const Route = createFileRoute("/voicemail")({
  head: () => pageHead("Voicemail", "Voicemail inbox with automatic transcripts."),
  component: VoicemailPage,
});

function VoicemailPage() {
  const phone = usePhone();
  const { items: list, setItems: setList } = useApiCollection<Voicemail>("voicemails", [], "voicemails");
  const [queue, setQueue] = useState("all");
  const [playing, setPlaying] = useState<string | null>(null);
  const rows = list.filter((v) => matches(v.queue, queue));

  async function play(v: Voicemail) {
    try { await apiPost(`voicemails/${v.id}/read`); } catch (error) { toast.error(error instanceof Error ? error.message : "Voicemail state was not saved"); return; }
    setPlaying((p) => (p === v.id ? null : v.id));
    setList((l) => l.map((x) => (x.id === v.id ? { ...x, heard: true } : x)));
  }

  const columns: Column<Voicemail>[] = [
    { id: "play", header: "", cell: (v) => (
      <button onClick={() => play(v)} aria-label={playing === v.id ? "Pause" : "Play voicemail"} className="grid h-8 w-8 place-items-center rounded-full bg-accent text-accent-foreground hover:opacity-80">
        {playing === v.id ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
    ) },
    { id: "from", header: "From", cell: (v) => <span><span className={v.heard ? "block" : "block font-semibold"}>{v.from}</span><span className="font-mono text-[11px] text-muted-foreground">{v.phone}</span></span>, sortValue: (v) => v.from },
    { id: "transcript", header: "Transcript", className: "max-w-[360px]", cell: (v) => <span className="line-clamp-2 text-muted-foreground">{v.transcript}</span> },
    { id: "queue", header: "Queue", cell: (v) => v.queue, sortValue: (v) => v.queue },
    { id: "len", header: "Length", cell: (v) => <span className="font-mono text-xs">{fmtDuration(v.durationSec)}</span>, sortValue: (v) => v.durationSec },
    { id: "at", header: "Received", cell: (v) => <span className="font-mono text-xs">{fmtTime(v.at)}</span>, sortValue: (v) => v.at },
    { id: "state", header: "State", cell: (v) => <StatusBadge status={v.heard ? "heard" : "new"} /> },
    { id: "act", header: "", className: "text-right", cell: (v) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => phone.dial(v.phone, v.from)}><Phone className="h-3.5 w-3.5" /> Call back</Button>
        <Button size="sm" variant="ghost" aria-label="Delete voicemail" onClick={async () => { try { await apiDelete(`voicemails/${v.id}`); } catch (error) { toast.error(error instanceof Error ? error.message : "Voicemail was not deleted"); return; } setList((l) => l.filter((x) => x.id !== v.id)); toast("Voicemail deleted"); }}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    ) },
  ];

  return (
    <AppShell>
      <PageHeader title="Voicemail" description="Messages left after hours or when queues were full, with automatic transcripts." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="New" value={String(list.filter((v) => !v.heard).length)} icon={Mail} />
        <KpiCard label="Listened" value={String(list.filter((v) => v.heard).length)} icon={MailOpen} />
        <KpiCard label="Avg length" value={fmtDuration(Math.round(list.reduce((s, v) => s + v.durationSec, 0) / Math.max(1, list.length)))} icon={Play} />
        <KpiCard label="Returned within 2h" value="—" icon={Phone} hint="Not calculated" />
      </div>
      <DataTable label="Voicemail" rows={rows} columns={columns} rowKey={(v) => v.id}
        searchText={(v) => `${v.from} ${v.phone} ${v.transcript}`} searchPlaceholder="Search caller or transcript…"
        toolbar={<FilterSelect label="Queues" value={queue} onChange={setQueue} options={["Billing", "Technical", "Sales", "General"]} />} />
    </AppShell>
  );
}
