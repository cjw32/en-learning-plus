import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { usePronunciationStore } from "../pronunciation";

const resource = (status = "AUDIO_READY") => ({
  assessmentId: "assessment_1",
  status,
  exerciseType: "WORD",
  locale: "en-US",
  referenceText: "hello",
  retryOfAssessmentId: null,
  result: null,
  diagnostic: null,
  learningWriteStatus: "NOT_ELIGIBLE",
  audio: { status: "READY", available: true, expiresAt: null },
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:01.000Z",
  traceId: "trace_1",
});

describe("pronunciation store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it.each([
    ["CREATED", "created"],
    ["AUDIO_VALIDATING", "validating_audio"],
    ["AUDIO_READY", "ready"],
    ["QUEUED", "queued"],
    ["PROCESSING", "processing"],
    ["COMPLETED", "completed"],
    ["REFERENCE_ONLY", "reference_only"],
    ["UNRECOGNIZABLE", "unrecognizable"],
    ["REJECTED", "rejected"],
    ["CANCELLED", "cancelled"],
    ["TIMED_OUT", "timed_out"],
    ["FAILED", "failed"],
  ])("maps %s to the distinct UI state %s", (serverStatus, uiState) => {
    const store = usePronunciationStore();
    expect(store.acceptAssessment(resource(serverStatus))).toBe(true);
    expect(store.uiState).toBe(uiState);
  });

  it("rejects an untrusted result instead of rendering partial scores", () => {
    const store = usePronunciationStore();
    expect(
      store.acceptAssessment({
        ...resource("COMPLETED"),
        result: { scores: { overall: 101 } },
      }),
    ).toBe(false);
    expect(store.error?.code).toBe("VALIDATION_FAILED");
    expect(store.assessment).toBeNull();
  });

  it("keeps recording Blob and object URL outside persisted Pinia state", () => {
    const store = usePronunciationStore();
    const blob = new Blob(["voice"], { type: "audio/webm" });
    store.setLocalRecording(blob, "blob:https://app.local/private-recording");
    expect(Object.keys(store.$state)).not.toEqual(
      expect.arrayContaining(["recordingBlob", "recordingObjectUrl"]),
    );
    expect(JSON.stringify(store.$state)).not.toContain("blob:");
    store.clearLocalRecording();
  });

  it("discloses failed learning writes without discarding a valid result", () => {
    const store = usePronunciationStore();
    expect(
      store.acceptAssessment({
        ...resource("COMPLETED"),
        learningWriteStatus: "FAILED",
      }),
    ).toBe(true);
    expect(store.learningDisclosure).toContain("学习进度");
  });
});
