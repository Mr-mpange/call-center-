import { describe, expect, it } from "vitest";
import { canAccessTenant, canCorrectTranscript, canDownloadRecording, getCallDetail, loadCallArtifacts, toCallDetail } from "@/lib/call-artifacts";

describe("call artifact workflow", () => {
  it("starts unavailable when no provider artifact exists", () => {
    const call = getCallDetail("call-1");
    const artifacts = loadCallArtifacts(call);
    expect(artifacts.recording.status).toBe("unavailable");
    expect(artifacts.transcription.segments).toEqual([]);
    expect(artifacts.summarization.summary.reason).toBe("Not established.");
  });

  it("maps persisted call records without fabricating details", () => {
    const call = toCallDetail({ id: "call-1", at: "2026-11-06T10:00:00.000Z", caller: "Caller", phone: "+255700000000", agent: "Agent", direction: "inbound", queue: "Billing", durationSec: 30, outcome: "resolved", summary: "Recorded call" });
    expect(call.tenantId).toBe("workspace");
  });

  it("keeps tenant and role checks explicit", () => {
    expect(canAccessTenant("workspace", "workspace")).toBe(true);
    expect(canAccessTenant("workspace", "other")).toBe(false);
    expect(canDownloadRecording("agent")).toBe(false);
    expect(canDownloadRecording("admin")).toBe(true);
    expect(canCorrectTranscript("supervisor")).toBe(true);
    expect(canCorrectTranscript("agent")).toBe(false);
  });
});
