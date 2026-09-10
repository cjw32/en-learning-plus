import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PronunciationAssessmentResult from "../PronunciationAssessmentResult.vue";

const result = (confidence = 0.9, confidenceTier = "RELIABLE") => ({
  schemaVersion: "pronunciation-result.v1",
  assessmentId: "assessment_1",
  referenceText: "hello brave quiet lost unsure",
  recognizedText: "hello extra brave quiet unsure",
  scores: {
    overall: 82,
    accuracy: 80,
    completeness: 78,
    fluency: 76,
    prosody: null,
  },
  confidence,
  confidenceTier,
  words: [
    {
      sequence: 0,
      targetPosition: 0,
      word: "hello",
      normalizedWord: "hello",
      startMs: 0,
      endMs: 200,
      score: 95,
      status: "correct",
      feedback: null,
    },
    {
      sequence: 1,
      targetPosition: null,
      word: "extra",
      normalizedWord: "extra",
      startMs: 210,
      endMs: 300,
      score: 70,
      status: "inserted",
      feedback: "多读了这个词",
    },
    {
      sequence: 2,
      targetPosition: 1,
      word: "brave",
      normalizedWord: "brave",
      startMs: 310,
      endMs: 500,
      score: 60,
      status: "mispronounced",
      feedback: "请注意元音",
    },
    {
      sequence: 3,
      targetPosition: 2,
      word: "quiet",
      normalizedWord: "quiet",
      startMs: 510,
      endMs: 700,
      score: 80,
      status: "uncertain",
      feedback: "结果仅供参考",
    },
    {
      sequence: 4,
      targetPosition: 3,
      word: "lost",
      normalizedWord: "lost",
      startMs: null,
      endMs: null,
      score: null,
      status: "omitted",
      feedback: "漏读",
    },
  ],
  summary: "整体清晰，请继续练习。",
  suggestions: ["注意漏读词。"],
  nextAction: "review",
  provider: "fake",
  modelVersion: "fake-v1",
  learningUpdate: {
    status: "FAILED",
    changedItems: [],
    message: "学习进度暂未保存。",
  },
  audio: { available: true, expiresAt: "2026-09-11T00:00:00.000Z" },
  versions: {
    providerAdapter: "a1",
    providerApi: "p1",
    normalization: "n1",
    alignment: "al1",
    assessmentRule: "r1",
    confidencePolicy: "c1",
    learningMapping: "l1",
    scheduler: "s1",
    budget: "b1",
    price: "price1",
  },
  traceId: "trace_1",
});

describe("PronunciationAssessmentResult", () => {
  it("renders every word state with text labels and semantic score output", () => {
    const wrapper = mount(PronunciationAssessmentResult, {
      props: { result: result() },
    });
    for (const label of ["正确", "误读", "漏读", "多读", "不确定"]) {
      expect(wrapper.text()).toContain(label);
    }
    expect(wrapper.get('[role="progressbar"]').attributes()).toMatchObject({
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "82",
    });
  });

  it("shows null prosody, confidence meaning and learning-write disclosure", () => {
    const wrapper = mount(PronunciationAssessmentResult, {
      props: { result: result() },
    });
    expect(wrapper.text()).toContain("韵律评分暂不可用");
    expect(wrapper.text()).toContain("结果可靠");
    expect(wrapper.text()).toContain("学习进度暂未保存");

    const reference = mount(PronunciationAssessmentResult, {
      props: { result: result(0.7, "REFERENCE_ONLY") },
    });
    expect(reference.text()).toContain("仅供参考");
  });

  it("emits seek only for valid timestamped words using keyboard or click", async () => {
    const wrapper = mount(PronunciationAssessmentResult, {
      props: { result: result() },
    });
    await wrapper.get('[data-word-sequence="0"]').trigger("keydown.enter");
    expect(wrapper.emitted("seek")).toEqual([[0]]);
    expect(
      wrapper.get('[data-word-sequence="4"]').attributes("aria-disabled"),
    ).toBe("true");
    await wrapper.get('[data-word-sequence="4"]').trigger("click");
    expect(wrapper.emitted("seek")).toHaveLength(1);
  });
});
