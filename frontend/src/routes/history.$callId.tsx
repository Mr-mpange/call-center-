import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Check,
  CheckCircle2,
  Download,
  FileAudio,
  Lock,
  Pause,
  Play,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Panel, PageHeader, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  canAccessTenant,
  canCorrectTranscript,
  canDownloadRecording,
  getCallDetail,
  toCallDetail,
  isCallOutcome,
  loadCallArtifacts,
  type ArtifactKind,
  type ArtifactRole,
  type CallArtifacts,
  type CallDetail,
  type CallNote,
  type FollowUpTask,
  type TranscriptSegment,
} from "@/lib/call-artifacts";
import { fmtDuration, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiGet, apiPatch, apiPost, apiPostAudio, useApiResource } from "@/lib/api";
import type { CallRecord } from "@/lib/domain-types";

export const Route = createFileRoute("/history/$callId")({
  head: () => ({ meta: [{ title: "Call details" }] }),
  component: CallDetailPage,
});

function currentTenantId() {
  if (typeof window === "undefined") return "workspace";
  try { return String(JSON.parse(window.localStorage.getItem("mpange.auth.user") ?? "null")?.tenantId ?? "workspace"); } catch { return "workspace"; }
}

function displayCustomer(value: string) {
  return !value || /^unknown caller$/i.test(value) ? "Customer" : value;
}

const waveformBars = [22, 34, 48, 30, 62, 42, 76, 52, 30, 68, 44, 82, 56, 34, 70, 46, 28, 58, 76, 40, 24, 50, 66, 36, 54, 78, 44, 30, 62, 48, 72, 38, 26, 56, 68, 42];

const transcriptPreview: TranscriptSegment[] = [
  { id: "preview-1", speaker: "customer", atSec: 0, text: "Hello, I would like to check the status of my request.", language: "English", confidence: 0.98 },
  { id: "preview-2", speaker: "agent", atSec: 4, text: "Certainly. Let me look up your account and help you with that.", language: "English", confidence: 0.97 },
  { id: "preview-3", speaker: "customer", atSec: 10, text: "Thank you. I submitted it yesterday.", language: "English", confidence: 0.95 },
];

function currentArtifactRole(): ArtifactRole {
  if (typeof window === "undefined") return "agent";
  try {
    const role = JSON.parse(window.localStorage.getItem("mpange.auth.user") ?? "null")?.role;
    return role === "Org Admin" ? "admin" : role === "Supervisor" ? "supervisor" : "agent";
  } catch { return "agent"; }
}

function useCallArtifacts(call: CallDetail, initial?: CallArtifacts) {
  const [artifacts, setArtifacts] = useState<CallArtifacts>(() => initial ?? loadCallArtifacts(call));

  useEffect(() => {
    setArtifacts(initial ?? loadCallArtifacts(call));
  }, [call, initial]);

  const update = useCallback((patch: (current: CallArtifacts) => CallArtifacts) => {
    setArtifacts((current) => patch(current));
  }, []);

  const retry = useCallback(
    (kind: ArtifactKind) => {
      const operationId = `${call.tenantId}:${call.id}:${kind}`;
      let accepted = false;
      setArtifacts((current) => {
        const record = current[kind];
        if (record.status === "queued" || record.status === "processing" || record.status === "ready") {
          return current;
        }
        accepted = true;
        const next: CallArtifacts = {
          ...current,
          [kind]: { ...record, status: "queued", message: `Queued job ${operationId}`, updatedAt: new Date().toISOString() },
        };
        return next;
      });
      if (!accepted) return;
      const endpoint = kind === "transcription" ? `calls/${call.id}/transcription-jobs` : kind === "summarization" ? `calls/${call.id}/summary-jobs` : `calls/${call.id}/recording-url`;
      void (kind === "recording" ? apiGet<{ url?: string; summary?: CallArtifacts["summarization"]["summary"] }>(endpoint) : apiPost<{ summary?: CallArtifacts["summarization"]["summary"] }>(endpoint, {})).then((response) => {
        setArtifacts((current) => ({
          ...current,
          [kind]: {
            ...current[kind],
            status: "ready",
            ...(kind === "recording" ? { url: response.url ?? null } : {}),
            ...(kind === "summarization" && response.summary ? { summary: response.summary } : {}),
            message: "Provider confirmed this artifact.",
            updatedAt: new Date().toISOString(),
          },
        }));
      }).catch((error) => {
        setArtifacts((current) => ({ ...current, [kind]: { ...current[kind], status: "unavailable", message: error instanceof Error ? error.message : "Provider unavailable", updatedAt: new Date().toISOString() } }));
      });
    },
    [call.id, call.tenantId],
  );

  const addNote = useCallback((body: string) => {
    void apiPost<{ note: CallNote }>(`calls/${call.id}/notes`, { body }).then((response) => {
      update((current) => ({ ...current, notes: [response.note, ...current.notes] }));
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Note was not saved"));
  }, [call.id, update]);

  const setOutcome = useCallback((outcome: CallArtifacts["confirmedOutcome"]) => {
    if (!isCallOutcome(outcome)) return;
    void apiPatch(`calls/${call.id}/outcome`, { outcome }).then(() => update((current) => ({ ...current, confirmedOutcome: outcome }))).catch((error) => toast.error(error instanceof Error ? error.message : "Outcome was not saved"));
  }, [call.id, update]);

  const createTask = useCallback((taskId: string) => {
    const task = artifacts.tasks.find((item) => item.id === taskId);
    if (!task || task.reviewStatus === "created") return;
    const reviewedAt = new Date().toISOString();
    void apiPost<{ task: FollowUpTask }>(`calls/${call.id}/tasks`, { suggestionId: task.suggestionId ?? task.id, title: task.title, reviewed: true, reviewedAt })
      .then((response) => update((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === taskId ? response.task : item) })))
      .catch((error) => toast.error(error instanceof Error ? error.message : "Task was not saved"));
  }, [artifacts.tasks, call.id, update]);

  const correctSegment = useCallback((segmentId: string, correctedText: string) => {
    update((current) => {
      const segment = current.transcription.segments.find((item) => item.id === segmentId);
      if (!segment || !correctedText.trim()) return current;
      const correction = {
        id: `${call.id}-correction-${Date.now()}`,
        segmentId,
        originalText: segment.text,
        correctedText: correctedText.trim(),
        author: "Current reviewer",
        createdAt: new Date().toISOString(),
      };
      return {
        ...current,
        transcription: {
          ...current.transcription,
          segments: current.transcription.segments.map((item) => item.id === segmentId ? { ...item, text: correctedText.trim(), confidence: 1 } : item),
        },
        corrections: [correction, ...current.corrections],
      };
    });
  }, [call.id, update]);

  return { artifacts, retry, addNote, setOutcome, createTask, correctSegment };
}

function SummaryTab({ call, artifacts }: { call: CallDetail; artifacts: CallArtifacts }) {
  const customer = displayCustomer(call.caller);
  const agent = call.agent || "Unassigned";
  const queue = call.queue || "General";
  const summary = artifacts.summarization.summary;
  const summaryText = summary.summary || summary.reason;
  const hasSummary = artifacts.summarization.status === "ready" && Boolean(summaryText && summaryText !== "Not established.");
  const [draftTranscript, setDraftTranscript] = useState("CUSTOMER: Habari, nataka kufuatilia ombi nililowasilisha jana.\nAGENT: Nitaangalia rekodi yako na kukupa mrejesho wa maendeleo.\nCUSTOMER: Asante, nitangoja mrejesho wenu.");
  const [previewSummary, setPreviewSummary] = useState<CallArtifacts["summarization"]["summary"] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);
  const [summaryLanguage, setSummaryLanguage] = useState("auto");

  useEffect(() => () => { if (localAudioUrl) URL.revokeObjectURL(localAudioUrl); }, [localAudioUrl]);

  function generatePreview() {
    if (!draftTranscript.trim()) return;
    setGenerating(true);
    void apiPost<{ summary: CallArtifacts["summarization"]["summary"] }>(`calls/${call.id}/summary-preview`, { transcript: draftTranscript, languageHint: summaryLanguage })
      .then((response) => setPreviewSummary(response.summary))
      .catch((error) => toast.error(error instanceof Error ? error.message : "AI summary could not be generated"))
      .finally(() => setGenerating(false));
  }
  function generateAudioPreview() {
    if (!audioFile) return;
    setGenerating(true);
    void apiPostAudio<{ summary: CallArtifacts["summarization"]["summary"] }>(`calls/${call.id}/summary-preview-audio`, audioFile, summaryLanguage)
      .then((response) => setPreviewSummary(response.summary))
      .catch((error) => toast.error(error instanceof Error ? error.message : "AI audio summary could not be generated"))
      .finally(() => setGenerating(false));
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
        {[
          ["Customer", customer, UserRound],
          ["Agent", agent, UserRound],
          ["Direction", call.direction, FileAudio],
          ["Outcome", call.outcome, CheckCircle2],
        ].map(([label, value, Icon]) => {
          const ItemIcon = Icon as typeof UserRound;
          return <div key={String(label)} className="surface-raised min-w-0 rounded-[18px] p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><ItemIcon className="h-3.5 w-3.5 shrink-0" />{label}</div><p className="mt-2 break-words text-sm font-semibold capitalize">{String(value)}</p></div>;
        })}
      </div>
      <div className="surface-recessed grid grid-cols-[repeat(auto-fit,minmax(115px,1fr))] gap-4 rounded-[18px] p-4 text-sm">
        {[['Customer phone', call.phone || "Not established"], ["Queue", queue], ["Date", call.at ? fmtTime(call.at) : "Not established"], ["Duration", call.durationSec ? fmtDuration(call.durationSec) : "Not established"], ["Language", call.language || "Auto-detect"]].map(([label, value]) => <div key={label} className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>)}
      </div>
      <Panel title="AI Summary">
        {(previewSummary || hasSummary) && <div className="surface-recessed rounded-[16px] p-4 text-sm leading-6">{previewSummary?.summary || summaryText}</div>}
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <Textarea value={draftTranscript} onChange={(event) => setDraftTranscript(event.target.value)} placeholder="Paste a transcript here…" aria-label="Transcript for temporary AI summary" className="min-h-28 text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={generatePreview} disabled={generating || !draftTranscript.trim()}><Sparkles className="h-3.5 w-3.5" />{generating ? "Generating…" : "Generate AI Summary"}</Button>
            <select value={summaryLanguage} onChange={(event) => setSummaryLanguage(event.target.value)} aria-label="Summary language" className="soft-filter h-9 rounded-xl px-2 text-xs"><option value="auto">Auto language</option><option value="organization-default">Organization default</option><option value="agent-preference">Agent preference</option><option value="kiswahili">Summarize in Kiswahili</option><option value="english">Summarize in English</option><option value="mixed">Keep mixed language</option></select>
            <Input type="file" accept="audio/*" aria-label="Attach temporary audio file" className="h-9 max-w-xs text-xs" onChange={(event) => { const file = event.target.files?.[0] ?? null; setAudioFile(file); if (file) setLocalAudioUrl(URL.createObjectURL(file)); }} />
            {audioFile && <Button size="sm" onClick={generateAudioPreview} disabled={generating}><Sparkles className="h-3.5 w-3.5" />{generating ? "Transcribing…" : "Summarize uploaded audio"}</Button>}
          </div>
          {localAudioUrl && <audio controls src={localAudioUrl} className="h-9 w-full" />}
        </div>
      </Panel>
    </div>
  );
}

function TranscriptText({ segment }: { segment: TranscriptSegment }) {
  const uncertainWords = segment.uncertainWords ?? [];
  if (!uncertainWords.length) return <>{segment.text}</>;
  const escaped = uncertainWords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  return <>{segment.text.split(pattern).map((part, index) => uncertainWords.some((word) => word.toLowerCase() === part.toLowerCase()) ? <mark key={`${segment.id}-${index}`} className="rounded bg-warning/20 px-0.5 text-foreground underline decoration-dashed decoration-warning underline-offset-2" title="Uncertain transcript word">{part}</mark> : <span key={`${segment.id}-${index}`}>{part}</span>)}</>;
}

function RecordingTranscriptTab({ artifacts, onCorrect }: { artifacts: CallArtifacts; onCorrect: (segmentId: string, text: string) => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState("1");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const role = currentArtifactRole();
  const canDownload = canDownloadRecording(role);
  const canEdit = canCorrectTranscript(role);

  useEffect(() => {
    if (artifacts.recording.status !== "ready" || !artifacts.recording.url) return;
    setAudioUrl(artifacts.recording.url);
    return () => {
      setAudioUrl(null);
    };
  }, [artifacts.callId, artifacts.recording.source, artifacts.recording.status, artifacts.recording.url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = Number(speed);
  }, [speed]);

  const segments = artifacts.transcription.segments;
  const isPreview = !(artifacts.transcription.status === "ready" && segments.length);
  const displayedSegments = isPreview ? transcriptPreview : segments;
  const activeSegment = [...artifacts.transcription.segments].reverse().find((segment) => currentTime >= segment.atSec) ?? null;
  const seek = (atSec: number) => { if (audioRef.current) { audioRef.current.currentTime = atSec; setCurrentTime(atSec); } };

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); } else { void audioRef.current.play(); setPlaying(true); }
  }

  return (
    <div className="space-y-4">
      {artifacts.recording.status === "ready" && audioUrl ? (
        <Panel title="Recording" action={<StatusBadge status={artifacts.recording.source === "browser" ? "Browser recording" : "Provider recording"} />}>
          <audio ref={audioRef} src={audioUrl} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="sr-only" />
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Button size="icon" onClick={togglePlay} aria-label={playing ? "Pause recorded call" : "Listen to recorded call"} title={playing ? "Pause recorded call" : "Listen to recorded call"}>{playing ? <Pause /> : <Play />}</Button>
              <div className={cn("recording-waveform", playing && "is-playing")} aria-label={playing ? "Recording is playing" : "Recording paused"} role="img">
                {waveformBars.map((height, index) => <span key={index} style={{ height: `${height}%`, animationDelay: `${index * 35}ms` }} />)}
              </div>
              <span className="font-mono text-xs text-muted-foreground">{fmtDuration(Math.floor(currentTime))} / {fmtDuration(Math.floor(duration || artifacts.recording.durationSec || 0))}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2"><input type="range" min="0" max={duration || artifacts.recording.durationSec || 0} step="0.1" value={Math.min(currentTime, duration || artifacts.recording.durationSec || 0)} onChange={(event) => seek(Number(event.target.value))} aria-label="Seek recording" className="soft-range min-w-[160px] flex-1" /><select value={speed} onChange={(event) => setSpeed(event.target.value)} aria-label="Playback speed" className="soft-filter h-9 rounded-xl px-2 text-xs"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>{canDownload ? <Button size="sm" variant="outline" onClick={() => { const link = document.createElement("a"); link.href = audioUrl; link.download = `call-${artifacts.callId}.${artifacts.recording.source === "browser" ? "webm" : "wav"}`; link.click(); toast.success("Recording download started"); }}><Download className="h-3.5 w-3.5" />Download</Button> : <Button size="sm" variant="outline" disabled title="Export call recordings permission required"><Lock className="h-3.5 w-3.5" />Download restricted</Button>}</div>
            <p className="text-xs text-muted-foreground">Recording playback is available only when the authorized provider returns a protected media URL.</p>
          </div>
        </Panel>
      ) : (
        <Panel title="Recording preview">
          <div className="flex items-center gap-3" aria-label="Recording waveform preview">
            <Button size="icon" disabled aria-label="Recording preview"><Play /></Button>
            <div className="recording-waveform is-playing" aria-hidden="true">
              {waveformBars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
            </div>
            <span className="font-mono text-xs text-muted-foreground">00:00 / 00:00</span>
          </div>
        </Panel>
      )}
      <Panel title="Transcript">
        {(
          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {isPreview && <p className="mb-2 text-xs text-muted-foreground">Example transcript preview</p>}
            {displayedSegments.map((segment) => (
              <div key={segment.id} className={cn("group flex gap-3 rounded-[16px] p-3 transition-colors", activeSegment?.id === segment.id ? "surface-recessed text-accent-foreground" : "surface-flat")}>
                <button type="button" onClick={() => seek(segment.atSec)} className="mt-0.5 w-12 shrink-0 text-left font-mono text-[11px] text-muted-foreground hover:text-primary" aria-label={`Seek to ${segment.atSec} seconds`}>{fmtDuration(segment.atSec)}</button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold capitalize">{segment.speaker}</span><StatusBadge status={segment.language} />{segment.confidence !== null && segment.confidence < 0.9 && <span title="Uncertain word detected" className="text-[11px] text-warning">Review uncertainty</span>}</div>
                  {editing === segment.id ? <div className="mt-2 flex gap-2"><Input value={editText} onChange={(event) => setEditText(event.target.value)} autoFocus aria-label="Correct transcript text" /><Button size="sm" onClick={() => { onCorrect(segment.id, editText); setEditing(null); }}><Check className="h-3.5 w-3.5" />Save correction</Button></div> : <p className="mt-1 text-sm leading-6"><TranscriptText segment={segment} /></p>}
                </div>
                {!isPreview && canEdit && editing !== segment.id && <Button size="sm" variant="ghost" onClick={() => { setEditing(segment.id); setEditText(segment.text); }}>Correct</Button>}
              </div>
            ))}
          </div>
        )}
        {artifacts.corrections.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{artifacts.corrections.length} correction{artifacts.corrections.length === 1 ? "" : "s"} saved with original text preserved in the edit history.</p>}
      </Panel>
    </div>
  );
}

function TaskReview({ tasks, onCreate }: { tasks: FollowUpTask[]; onCreate: (taskId: string) => void }) {
  const [reviewing, setReviewing] = useState<string | null>(null);
  const task = tasks.find((item) => item.id === reviewing) ?? null;
  return <div className="space-y-3">{tasks.length ? tasks.map((item) => <div key={item.id} className="surface-recessed rounded-[16px] p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><p className="text-sm font-medium">{item.title}</p><StatusBadge status={item.reviewStatus === "created" ? "created" : "needs review"} /></div><p className="mt-1 text-xs text-muted-foreground">Assignee: {item.assignee ?? "Not established"} · Due: {item.dueDate ?? "Not established"}</p><p className="mt-1 text-xs text-muted-foreground">Customer linked: {item.customerId ?? "Not established"} · Case: {item.caseId ?? "Not established"}</p></div>{item.reviewStatus === "created" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Button size="sm" variant="outline" onClick={() => setReviewing(item.id)}>Review suggestion</Button>}</div></div>) : <p className="text-sm text-muted-foreground">No follow-up tasks are available for this call yet.</p>}{task && <div className="surface-raised rounded-[16px] p-4"><p className="text-sm font-semibold">Review before creating task</p><p className="mt-2 text-sm">{task.title}</p><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><div><dt className="text-muted-foreground">Assignee</dt><dd className="mt-1 font-medium">{task.assignee ?? "Not established"}</dd></div><div><dt className="text-muted-foreground">Due date</dt><dd className="mt-1 font-medium">{task.dueDate ?? "Not established"}</dd></div><div><dt className="text-muted-foreground">External action</dt><dd className="mt-1 font-medium">None until confirmed</dd></div></dl><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => { onCreate(task.id); setReviewing(null); toast.success("Task created from reviewed suggestion"); }}><Check className="h-3.5 w-3.5" />Confirm & create task</Button><Button size="sm" variant="ghost" onClick={() => setReviewing(null)}>Cancel</Button></div></div>}</div>;
}

function NotesTasksTab({ call, artifacts, addNote, setOutcome, createTask }: { call: CallDetail; artifacts: CallArtifacts; addNote: (body: string) => void; setOutcome: (outcome: CallArtifacts["confirmedOutcome"]) => void; createTask: (taskId: string) => void }) {
  const [note, setNote] = useState("");
  const [outcome, setLocalOutcome] = useState(artifacts.confirmedOutcome);
  const customer = displayCustomer(call.caller);
  return <div className="grid gap-4 xl:grid-cols-[1fr_1fr]"><Panel title="Notes & confirmed outcome"><div className="space-y-4"><div><label htmlFor="call-outcome" className="text-xs font-medium">Call outcome</label><div className="mt-1 flex gap-2"><select id="call-outcome" value={outcome} onChange={(event) => setLocalOutcome(isCallOutcome(event.target.value) ? event.target.value : "Not established")} className="soft-filter h-9 flex-1 rounded-xl px-3 text-sm"><option value="Not established">Not established</option>{["resolved", "missed", "abandoned", "escalated", "voicemail"].map((value) => <option key={value} value={value}>{value}</option>)}</select><Button size="sm" onClick={() => { setOutcome(outcome); toast.success("Outcome confirmed"); }}><Check className="h-3.5 w-3.5" />Confirm</Button></div></div><div><label htmlFor="call-note" className="text-xs font-medium">Agent note</label><Textarea id="call-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a factual call note…" className="mt-1 min-h-28" /></div><Button onClick={() => { if (!note.trim()) return; addNote(note.trim()); setNote(""); toast.success("Note saved"); }}><Plus className="h-4 w-4" />Add note</Button>{artifacts.notes.length > 0 && <div className="space-y-2 border-t border-border/60 pt-3">{artifacts.notes.map((item) => <div key={item.id} className="surface-recessed rounded-[14px] p-3"><p className="text-sm">{item.body}</p><p className="mt-1 text-[11px] text-muted-foreground">{item.author} · {fmtTime(item.createdAt)}</p></div>)}</div>}</div></Panel><Panel title={artifacts.tasks.length ? "Suggested follow-up tasks" : "Follow-up tasks"} action={artifacts.tasks.length ? <StatusBadge status="Review required" /> : undefined}>{artifacts.tasks.length > 0 && <p className="mb-3 text-xs text-muted-foreground">Review a suggestion before creating a task.</p>}<TaskReview tasks={artifacts.tasks} onCreate={createTask} />{artifacts.tasks.length > 0 && <div className="mt-4 text-xs text-muted-foreground">Call: {call.id} · Customer: {customer}</div>}</Panel></div>;
}

function CallDetailPage() {
  const { callId } = Route.useParams();
  const navigate = useNavigate();
  const { value: response, loading, error } = useApiResource<{ call?: CallRecord; artifacts?: CallArtifacts } | null>(`calls/${callId}`, null);
  const call = useMemo(() => response?.call ? toCallDetail(response.call) : getCallDetail(callId), [callId, response]);
  const { artifacts, correctSegment } = useCallArtifacts(call, response?.artifacts);
  const authorized = canAccessTenant(currentTenantId(), call.tenantId);
  const close = () => void navigate({ to: "/history" });
  const sheet = (content: ReactNode) => <Sheet open onOpenChange={(open) => { if (!open) close(); }}><SheetContent side="right" className="w-full sm:max-w-[720px] overflow-y-auto p-0"><SheetHeader className="sr-only"><SheetTitle>Call details</SheetTitle><SheetDescription>Review the call record, protected artifacts, and follow-up work.</SheetDescription></SheetHeader><div className="min-h-full p-5 pt-12 sm:p-7">{content}</div></SheetContent></Sheet>;

  if (loading) return sheet(<Panel title="Call details"><p className="text-sm text-muted-foreground">Loading persisted call data…</p></Panel>);
  if (error || !response?.call) return sheet(<Panel title="Call details"><p className="text-sm text-muted-foreground">{error ?? "Call not found."}</p></Panel>);

  if (!authorized) {
    return sheet(<Panel title="Access denied"><p className="text-sm text-muted-foreground">This call belongs to another tenant or is not authorized for the current workspace.</p></Panel>);
  }

  return sheet(<><PageHeader title="Call details" description="Call information, recording and transcript." /><div className="space-y-4"><SummaryTab call={call} artifacts={artifacts} /><RecordingTranscriptTab artifacts={artifacts} onCorrect={correctSegment} /></div></>);
}
