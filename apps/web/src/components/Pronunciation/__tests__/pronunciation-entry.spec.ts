import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/apis/pronunciation", () => ({
  createPronunciationAssessment: vi.fn(),
  cancelPronunciationAssessment: vi.fn(),
  getPronunciationAssessment: vi.fn(),
  retryPronunciationAssessment: vi.fn(),
  submitAndPollPronunciationAssessment: vi.fn(),
  uploadPronunciationAudio: vi.fn(),
}));

import {
  createPronunciationAssessment,
  submitAndPollPronunciationAssessment,
  uploadPronunciationAudio,
} from "@/apis/pronunciation";
import PronunciationEntry from "../PronunciationEntry.vue";

const assessment = {
  assessmentId: "assessment_1",
  status: "CREATED",
  exerciseType: "WORD",
  locale: "en-US",
  referenceText: "hello",
  retryOfAssessmentId: null,
  result: null,
  diagnostic: null,
  learningWriteStatus: "NOT_ELIGIBLE",
  audio: { status: "MISSING", available: false, expiresAt: null },
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  traceId: "assessment_1",
} as const;

describe("PronunciationEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createPronunciationAssessment).mockResolvedValue({
      code: 201,
      data: assessment,
    });
    vi.mocked(uploadPronunciationAudio).mockResolvedValue({
      code: 200,
      data: {
        ...assessment,
        status: "AUDIO_READY",
        audio: {
          status: "READY",
          available: true,
          expiresAt: "2026-09-11T00:00:00.000Z",
        },
      },
    });
    vi.mocked(submitAndPollPronunciationAssessment).mockResolvedValue({
      ...assessment,
      status: "CANCELLED",
      diagnostic: {
        code: "CANCELLED",
        message: "评测已取消。",
        retryable: false,
      },
    });
  });

  it("makes zero request and renders no control while the capture gate is off", async () => {
    const wrapper = mount(PronunciationEntry, {
      props: {
        enabled: false,
        target: { sourceType: "WORD_BOOK", wordId: "word_1" },
      },
    });
    expect(wrapper.find("button").exists()).toBe(false);
    await wrapper.trigger("click");
    expect(createPronunciationAssessment).not.toHaveBeenCalled();
  });

  it("creates a WordBook assessment without sending display text as authority", async () => {
    const wrapper = mount(PronunciationEntry, {
      props: {
        enabled: true,
        target: { sourceType: "WORD_BOOK", wordId: "word_1" },
      },
    });
    await wrapper.get("button").trigger("click");
    expect(createPronunciationAssessment).toHaveBeenCalledWith(
      {
        locale: "en-US",
        target: { sourceType: "WORD_BOOK", wordId: "word_1" },
      },
      expect.stringMatching(/^pronunciation-create-/),
    );
    expect(wrapper.emitted("created")).toEqual([[assessment]]);
  });

  it.each([
    {
      sourceType: "COURSE_WORD" as const,
      courseId: "course_1",
      wordId: "word_1",
    },
    {
      sourceType: "RAG_CITATION" as const,
      citationId: "citation_1",
      selection: { start: 0, end: 5 },
    },
  ])(
    "keeps $sourceType hidden without its separate runtime approval",
    (target) => {
      const wrapper = mount(PronunciationEntry, {
        props: { enabled: true, target },
      });
      expect(wrapper.find("button").exists()).toBe(false);
      expect(createPronunciationAssessment).not.toHaveBeenCalled();
    },
  );

  it("supports an owned Coach item using opaque server identities", async () => {
    const target = {
      sourceType: "COACH_EXERCISE" as const,
      coachRequestId: "request_1",
      exerciseId: "exercise_1",
      itemId: "item_1",
    };
    const wrapper = mount(PronunciationEntry, {
      props: { enabled: true, target },
    });
    await wrapper.get("button").trigger("click");
    expect(createPronunciationAssessment).toHaveBeenCalledWith(
      { locale: "en-US", target },
      expect.any(String),
    );
  });

  it("connects recording, upload, submit, polling and terminal feedback", async () => {
    const recording = {
      blob: new Blob(["voice"], { type: "audio/webm" }),
      objectUrl: "blob:recording",
      mimeType: "audio/webm",
      durationMs: 1_000,
    };
    const wrapper = mount(PronunciationEntry, {
      props: {
        enabled: true,
        target: { sourceType: "WORD_BOOK", wordId: "word_1" },
      },
      global: {
        stubs: {
          PronunciationRecorder: {
            emits: ["ready"],
            setup(_props: unknown, { emit }: { emit: Function }) {
              return { ready: () => emit("ready", recording) };
            },
            template: '<button data-test="recording-ready" @click="ready" />',
          },
        },
      },
    });

    await wrapper.get(".pronunciation-entry__button").trigger("click");
    await wrapper.get('[data-test="recording-ready"]').trigger("click");
    await flushPromises();

    expect(uploadPronunciationAudio).toHaveBeenCalledWith(
      "assessment_1",
      recording.blob,
      expect.stringMatching(/^pronunciation-upload-/),
      expect.objectContaining({ durationMs: 1_000 }),
    );
    expect(submitAndPollPronunciationAssessment).toHaveBeenCalledWith(
      "assessment_1",
      expect.stringMatching(/^pronunciation-submit-/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.text()).toContain("评测已取消");
  });
});
