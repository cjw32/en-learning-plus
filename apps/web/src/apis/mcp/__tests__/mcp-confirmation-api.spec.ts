import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/router", () => ({ default: { replace: vi.fn() } }));
vi.mock("element-plus", () => ({ ElMessage: { error: vi.fn() } }));
vi.mock("@/apis/auth", () => ({ refreshTokenApi: vi.fn() }));

import { aiApi } from "@/apis";
import {
  decideMcpWriteConfirmation,
  getMcpWriteConfirmation,
  McpConfirmationClientError,
} from "@/apis/mcp";
import { useUserStore } from "@/stores/user";

const selector = "R4nd0m-opaque-selector-with-enough-entropy_0001";
const digest = "a".repeat(64);
const view = Object.freeze({
  schemaVersion: "en-learning.mcp.confirmation.v1",
  status: "pending",
  clientDisplayName: "Example Learning Client",
  toolName: "submit_answer",
  exercise: { title: "Meeting practice", itemCount: 1, version: "exercise.v1" },
  operationSummary: {
    answerCount: 1,
    willSaveAttempt: true,
    willUpdateMastery: true,
    willUpdateReviewSchedule: true,
  },
  operationSummaryDigest: digest,
  expiresAt: "2026-09-11T08:05:00.000Z",
  retryInstruction: "After confirming, retry the original MCP call.",
});

function response(
  config: InternalAxiosRequestConfig,
  data: unknown,
): AxiosResponse {
  return { config, data, status: 200, statusText: "OK", headers: {} };
}

describe("MCP confirmation Web API boundary", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useUserStore().setUser({
      id: "learner_confirmation_web",
      name: "Learner",
      phone: "10000000000",
      wordNumber: 0,
      dayNumber: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      token: { accessToken: "web-access", refreshToken: "web-refresh" },
    });
    document.cookie = "mcp_confirmation_csrf=csrf-fixture-token; Path=/";
  });

  it("loads and strictly parses an answer-free confirmation view", async () => {
    aiApi.defaults.adapter = (async (config) => response(config, view)) as AxiosAdapter;

    await expect(getMcpWriteConfirmation(selector)).resolves.toEqual(view);

    aiApi.defaults.adapter = (async (config) =>
      response(config, { ...view, accessToken: "private" })) as AxiosAdapter;
    await expect(getMcpWriteConfirmation(selector)).rejects.toEqual(
      new McpConfirmationClientError("INVALID_RESPONSE"),
    );
  });

  it("sends only the digest-bound decision and CSRF header", async () => {
    let captured: InternalAxiosRequestConfig | undefined;
    aiApi.defaults.adapter = (async (config) => {
      captured = config;
      return response(config, {
        schemaVersion: "en-learning.mcp.confirmation.v1",
        status: "confirmed",
        writeExecuted: false,
        nextAction: "retry_original_mcp_call",
      });
    }) as AxiosAdapter;

    await decideMcpWriteConfirmation(selector, {
      schemaVersion: "en-learning.mcp.confirmation.v1",
      decision: "confirm",
      operationSummaryDigest: digest,
    });

    expect(captured?.url).toBe(`/mcp/confirmations/${selector}`);
    expect(captured?.headers["X-MCP-CSRF-Token"]).toBe("csrf-fixture-token");
    expect(JSON.parse(String(captured?.data))).toEqual({
      schemaVersion: "en-learning.mcp.confirmation.v1",
      decision: "confirm",
      operationSummaryDigest: digest,
    });
    expect(String(captured?.data)).not.toMatch(
      /answer|accessToken|redirect|userId/iu,
    );
  });

  it("rejects invalid selectors and unsafe decision fields before HTTP", async () => {
    const adapter = vi.fn();
    aiApi.defaults.adapter = adapter as AxiosAdapter;

    await expect(getMcpWriteConfirmation("https://attacker.invalid")).rejects.toEqual(
      new McpConfirmationClientError("INVALID_SELECTOR"),
    );
    await expect(
      decideMcpWriteConfirmation(selector, {
        schemaVersion: "en-learning.mcp.confirmation.v1",
        decision: "confirm",
        operationSummaryDigest: digest,
        redirectUrl: "https://attacker.invalid",
      } as never),
    ).rejects.toBeTruthy();
    expect(adapter).not.toHaveBeenCalled();
  });
});
