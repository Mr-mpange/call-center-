import type { CallOutcome, CallRecord } from "@/lib/domain-types";

export type ArtifactStatus = "queued" | "processing" | "ready" | "unavailable" | "failed";
export type ArtifactKind = "recording" | "transcription" | "summarization";
export type ArtifactRole = "agent" | "supervisor" | "admin";
export type TranscriptSpeaker = "customer" | "agent";
export type TranscriptLanguage = "Kiswahili" | "English" | "Mixed" | "Not established";

export interface TranscriptSegment { id: string; speaker: TranscriptSpeaker; atSec: number; text: string; language: TranscriptLanguage; confidence: number | null; uncertainWords?: string[] }
export interface CallSummary { summary: string; reason: string; discussion: string[]; resolution: string; unresolved: string[]; nextSteps: string[]; suggestions: string[] }
export interface CallDetail { id: string; tenantId: string; tenantName?: string; businessId?: string; caller: string; phone: string; agent: string; direction: "inbound" | "outbound" | "Not established"; queue: string; at: string; durationSec: number; outcome: CallOutcome | "Not established"; summary: string; customerId: string | null; caseId: string | null; language: TranscriptLanguage }
export interface ArtifactRecord { status: ArtifactStatus; message?: string; provider?: string; source?: "provider" | "gemini" | "backend" | "not-configured" | "browser"; url?: string | null; sourceUrl?: string | null; updatedAt: string }
export interface CallNote { id: string; body: string; author: string; createdAt: string }
export interface FollowUpTask { id: string; title: string; assignee: string | null; dueDate: string | null; customerId: string | null; caseId: string | null; source: "confirmed" | "suggested"; reviewStatus: "suggested" | "created"; createdAt?: string }
export interface TranscriptCorrection { id: string; segmentId: string; originalText: string; correctedText: string; author: string; createdAt: string }
export interface CallArtifacts { tenantId: string; callId: string; recording: ArtifactRecord & { durationSec: number }; transcription: ArtifactRecord & { language: TranscriptLanguage; segments: TranscriptSegment[] }; summarization: ArtifactRecord & { summary: CallSummary }; notes: CallNote[]; tasks: FollowUpTask[]; corrections: TranscriptCorrection[]; confirmedOutcome: CallOutcome | "Not established" }

export const artifactInfrastructure = {
  configured: false,
  requiredSetup: [
    "A server-side call recording provider and object storage bucket.",
    "A transcription provider configured for English, Kiswahili, and mixed-language audio.",
    "Server endpoints that authorize tenant-scoped artifact reads and issue short-lived recording URLs.",
    "A queue/worker for idempotent recording, transcription, and summarization jobs.",
  ],
} as const;

export function toCallDetail(call: CallRecord): CallDetail {
  const enriched = call as CallRecord & { tenantId?: string; customerId?: string | null; caseId?: string | null; language?: TranscriptLanguage };
  return { ...call, tenantId: String(enriched.tenantId ?? "workspace"), customerId: enriched.customerId ?? null, caseId: enriched.caseId ?? null, language: enriched.language ?? "Not established" } as CallDetail;
}

export function getCallDetail(callId: string): CallDetail {
  return { id: callId, tenantId: "workspace", caller: "Not established", phone: "Not established", agent: "Not established", direction: "Not established", queue: "Not established", at: "", durationSec: 0, outcome: "Not established", summary: "Not established.", customerId: null, caseId: null, language: "Not established" };
}

const emptySummary = (): CallSummary => ({ summary: "Not established.", reason: "Not established.", discussion: [], resolution: "Not established.", unresolved: [], nextSteps: [], suggestions: [] });

export function loadCallArtifacts(call: CallDetail): CallArtifacts {
  const timestamp = new Date().toISOString();
  return {
    tenantId: call.tenantId,
    callId: call.id,
    recording: { status: "unavailable", source: "not-configured", message: "Recording storage is not configured for this organization.", durationSec: call.durationSec, updatedAt: timestamp },
    transcription: { status: "unavailable", source: "not-configured", message: "Transcription service is not configured for this organization.", language: call.language, segments: [], updatedAt: timestamp },
    summarization: { status: "unavailable", message: "No summarization provider is configured.", source: "not-configured", summary: emptySummary(), updatedAt: timestamp },
    notes: [], tasks: [], corrections: [], confirmedOutcome: call.outcome,
  };
}

// Kept as a compatibility boundary for callers while persistence is owned by the API.
export function saveCallArtifacts(_artifacts: CallArtifacts) {}
export function canAccessTenant(tenantId: string, recordTenantId: string) { return tenantId === recordTenantId; }
export function canDownloadRecording(role: ArtifactRole) { return role === "admin"; }
export function canCorrectTranscript(role: ArtifactRole) { return role === "supervisor" || role === "admin"; }
export function formatArtifactStatus(status: ArtifactStatus) { return status === "unavailable" ? "Unavailable" : status.charAt(0).toUpperCase() + status.slice(1); }
export function isCallOutcome(value: string): value is CallOutcome { return ["resolved", "missed", "abandoned", "escalated", "voicemail"].includes(value); }
