// Compatibility boundary for older callers. Call sessions and recordings are
// owned by the authenticated backend/provider; this module never persists
// operational data in browser storage.

export interface LocalCallSession {
  id: string;
  number: string;
  name: string | null;
  direction: "inbound" | "outbound";
  at: number;
  durationSec: number;
  outcome: "completed" | "missed" | "declined" | "cancelled" | "transferred";
}

export interface LocalRecordingMeta {
  callId: string;
  mimeType: string;
  durationSec: number;
  size: number;
  createdAt: string;
}

interface StoredRecording extends LocalRecordingMeta { blob: Blob }

export function saveLocalCallSession(_session: LocalCallSession) {}
export function getLocalCallSession(_callId: string) { return null }
export function getLocalCallHistory() { return [] }
export function getLocalCallRecordingMeta(_callId: string): LocalRecordingMeta | null { return null }
export async function saveLocalCallRecording(_recording: { callId: string; blob: Blob; durationSec: number }) { return null }
export async function getLocalCallRecording(_callId: string): Promise<StoredRecording | null> { return null }
