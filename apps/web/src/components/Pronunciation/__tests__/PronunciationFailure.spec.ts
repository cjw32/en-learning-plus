import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import {
  toPronunciationStoreError,
  type PronunciationStoreError,
} from "@/stores/pronunciation";
import PronunciationFailure from "../PronunciationFailure.vue";

describe("PronunciationFailure", () => {
  it.each([
    ["BROWSER_UNSUPPORTED", "BROWSER", "浏览器", false],
    ["MICROPHONE_PERMISSION_DENIED", "DEVICE", "麦克风", false],
    ["UPLOAD_FAILED", "UPLOAD", "上传", true],
    ["AUDIO_LOW_VOLUME", "AUDIO", "音量", true],
    ["QUEUE_UNAVAILABLE", "QUEUE", "排队", true],
    ["RATE_LIMITED", "GOVERNANCE", "稍后", true],
    ["PROVIDER_TIMEOUT", "PROVIDER", "超时", true],
    ["LEARNING_WRITE_FAILED", "LEARNING", "学习进度", true],
  ])(
    "maps %s to an actionable %s message",
    (code, category, text, retryable) => {
      const error = toPronunciationStoreError({
        code: 503,
        error: {
          code,
          category,
          message: "internal host=/private/object key=secret stack trace",
          retryable,
          retryAfterSeconds: code === "RATE_LIMITED" ? 60 : null,
          assessmentId: "assessment-1",
          traceId: "trace-1",
        },
      });
      expect(error).toMatchObject({ code, category, retryable });
      expect(error.message).toContain(text);
      expect(error.message).not.toMatch(
        /internal|private|secret|stack|assessment-1|trace-1/i,
      );
    },
  );

  it("renders a retry action only for safe retryable failures", async () => {
    const retryable: PronunciationStoreError = {
      code: "PROVIDER_TIMEOUT",
      category: "PROVIDER",
      message: "评测服务响应超时，请稍后重试。",
      retryable: true,
      retryAfterSeconds: 2,
    };
    const wrapper = mount(PronunciationFailure, {
      props: { error: retryable },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain("2 秒");
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);

    await wrapper.setProps({
      error: {
        ...retryable,
        code: "BROWSER_UNSUPPORTED",
        category: "BROWSER",
        retryable: false,
        retryAfterSeconds: null,
      },
    });
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("fails closed on malformed network errors without echoing payloads", () => {
    const error = toPronunciationStoreError({
      response: {
        data: {
          message: "subscription-secret /Users/name/private.wav",
          stack: "raw stack",
        },
      },
    });
    expect(error).toEqual({
      code: "INTERNAL_ERROR",
      category: "GOVERNANCE",
      message: "评测暂时不可用，请稍后重试。",
      retryable: true,
      retryAfterSeconds: null,
    });
  });
});
