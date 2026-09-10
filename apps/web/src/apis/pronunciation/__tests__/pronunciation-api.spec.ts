import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiApi } from "@/apis";
import {
  cancelPronunciationAssessment,
  pollPronunciationAssessment,
  PronunciationPollingError,
  submitAndPollPronunciationAssessment,
  submitPronunciationAssessment,
} from "@/apis/pronunciation";

function resource(status: string) {
  return {
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
  };
}

function response(
  config: InternalAxiosRequestConfig,
  data: unknown,
): AxiosResponse {
  return { config, data, status: 200, statusText: "OK", headers: {} };
}

describe("pronunciation API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
  });

  it("submits once, then polls the durable 202 resource until terminal", async () => {
    const statuses = ["QUEUED", "PROCESSING", "COMPLETED"];
    const calls: Array<{ method?: string; url?: string; key?: unknown }> = [];
    aiApi.defaults.adapter = (async (config) => {
      calls.push({
        method: config.method,
        url: config.url,
        key: config.headers["Idempotency-Key"],
      });
      const status = config.method === "post" ? "QUEUED" : statuses.shift();
      return response(config, {
        code: config.method === "post" ? 202 : 200,
        data: resource(status!),
      });
    }) as AxiosAdapter;

    await expect(
      submitAndPollPronunciationAssessment(
        "assessment_1",
        "submit-key-000001",
        { intervalMs: 100, sleep: async () => {} },
      ),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    expect(calls).toEqual([
      {
        method: "post",
        url: "/pronunciation/assessments/assessment_1/submit",
        key: "submit-key-000001",
      },
      {
        method: "get",
        url: "/pronunciation/assessments/assessment_1",
        key: undefined,
      },
      {
        method: "get",
        url: "/pronunciation/assessments/assessment_1",
        key: undefined,
      },
      {
        method: "get",
        url: "/pronunciation/assessments/assessment_1",
        key: undefined,
      },
    ]);
  });

  it("sends cancellation as an idempotent mutation", async () => {
    let captured: InternalAxiosRequestConfig | undefined;
    aiApi.defaults.adapter = (async (config) => {
      captured = config;
      return response(config, { code: 200, data: resource("CANCELLED") });
    }) as AxiosAdapter;
    await expect(
      cancelPronunciationAssessment("assessment_1", "cancel-key-000001"),
    ).resolves.toMatchObject({ data: { status: "CANCELLED" } });
    expect(captured?.url).toBe(
      "/pronunciation/assessments/assessment_1/cancel",
    );
    expect(captured?.headers["Idempotency-Key"]).toBe("cancel-key-000001");
  });

  it("stops polling on AbortSignal without another request", async () => {
    let calls = 0;
    const abort = new AbortController();
    aiApi.defaults.adapter = (async (config) => {
      calls += 1;
      abort.abort();
      return response(config, { code: 200, data: resource("PROCESSING") });
    }) as AxiosAdapter;
    await expect(
      pollPronunciationAssessment("assessment_1", {
        signal: abort.signal,
        intervalMs: 100,
        sleep: async () => {},
      }),
    ).rejects.toEqual(new PronunciationPollingError("CANCELLED"));
    expect(calls).toBe(1);
  });

  it("fails with a bounded timeout and does not poll indefinitely", async () => {
    let now = 0;
    let calls = 0;
    aiApi.defaults.adapter = (async (config) => {
      calls += 1;
      return response(config, { code: 200, data: resource("PROCESSING") });
    }) as AxiosAdapter;
    await expect(
      pollPronunciationAssessment("assessment_1", {
        intervalMs: 100,
        maxWaitMs: 250,
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    ).rejects.toEqual(new PronunciationPollingError("REQUEST_TIMEOUT"));
    expect(calls).toBe(4);
  });

  it("replays mutations with the caller-provided key and rejects partial resources", async () => {
    const keys: unknown[] = [];
    let malformed = false;
    aiApi.defaults.adapter = (async (config) => {
      keys.push(config.headers["Idempotency-Key"]);
      return response(config, {
        code: 202,
        data: malformed
          ? { assessmentId: "assessment_1", status: "QUEUED" }
          : resource("QUEUED"),
      });
    }) as AxiosAdapter;
    await submitPronunciationAssessment("assessment_1", "same-key-00000001");
    await submitPronunciationAssessment("assessment_1", "same-key-00000001");
    expect(keys).toEqual(["same-key-00000001", "same-key-00000001"]);
    malformed = true;
    await expect(
      submitPronunciationAssessment("assessment_1", "same-key-00000001"),
    ).rejects.toBeTruthy();
  });
});
