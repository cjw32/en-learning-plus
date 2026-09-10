import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiApi } from "@/apis";
import {
  PronunciationUploadValidationError,
  uploadPronunciationAudio,
  validatePronunciationAudioForUpload,
} from "@/apis/pronunciation";
import { usePronunciationStore } from "@/stores/pronunciation";

const MiB = 1024 * 1024;

function response(
  config: InternalAxiosRequestConfig,
  data: unknown,
): AxiosResponse {
  return { config, data, status: 200, statusText: "OK", headers: {} };
}

function resource() {
  return {
    code: 200,
    data: {
      assessmentId: "assessment_1",
      status: "AUDIO_VALIDATING",
      exerciseType: "WORD",
      locale: "en-US",
      referenceText: "hello",
      retryOfAssessmentId: null,
      result: null,
      diagnostic: null,
      learningWriteStatus: "NOT_ELIGIBLE",
      audio: { status: "VALIDATING", available: false, expiresAt: null },
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:01.000Z",
      traceId: "trace_1",
    },
  };
}

describe("pronunciation upload boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
  });

  it.each([
    [499, 1, "AUDIO_TOO_SHORT"],
    [30_001, 1, "AUDIO_TOO_LONG"],
    [500, 8 * MiB + 1, "AUDIO_TOO_LARGE"],
  ])(
    "rejects duration %d and size %d locally with %s before network admission",
    async (durationMs, size, code) => {
      const adapter = vi.fn();
      aiApi.defaults.adapter = adapter as AxiosAdapter;
      await expect(
        uploadPronunciationAudio(
          "assessment_1",
          new Blob([new Uint8Array(size)], { type: "audio/webm" }),
          "upload-key-000001",
          { durationMs },
        ),
      ).rejects.toEqual(new PronunciationUploadValidationError(code as never));
      expect(adapter).not.toHaveBeenCalled();
    },
  );

  it.each([
    [500, 1],
    [30_000, 8 * MiB],
  ])("accepts the exact %d ms / %d byte boundary", (durationMs, size) => {
    expect(() =>
      validatePronunciationAudioForUpload(
        new Blob([new Uint8Array(size)], { type: "audio/webm" }),
        durationMs,
      ),
    ).not.toThrow();
  });

  it("sets a hard 30-second upload timeout and forwards cancellation", async () => {
    let captured: InternalAxiosRequestConfig | undefined;
    aiApi.defaults.adapter = (async (config) => {
      captured = config;
      return response(config, resource());
    }) as AxiosAdapter;
    const cancellation = new AbortController();
    await uploadPronunciationAudio(
      "assessment_1",
      new Blob(["voice"], { type: "audio/webm" }),
      "upload-key-000001",
      { durationMs: 1_000, signal: cancellation.signal },
    );
    expect(captured?.timeout).toBe(30_000);
    expect(captured?.signal).toBe(cancellation.signal);
  });

  it("keeps local audio available for retry after an offline upload failure", async () => {
    aiApi.defaults.adapter = vi
      .fn()
      .mockRejectedValue(new Error("Network Error")) as AxiosAdapter;
    const store = usePronunciationStore();
    const blob = new Blob(["voice"], { type: "audio/webm" });
    store.setLocalRecording(blob, "blob:https://app.local/retry", 1_000);
    await expect(
      uploadPronunciationAudio("assessment_1", blob, "upload-key-000001", {
        durationMs: 1_000,
      }),
    ).rejects.toThrow("Network Error");
    expect(store.getLocalRecording()).toMatchObject({
      blob,
      objectUrl: "blob:https://app.local/retry",
      durationMs: 1_000,
    });
  });
});
