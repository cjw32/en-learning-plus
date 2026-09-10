import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PronunciationLearningUpdate from "../PronunciationLearningUpdate.vue";

const change = {
  targetPosition: 0,
  word: "hello",
  previousReviewState: "NEW" as const,
  nextReviewState: "REVIEW" as const,
  nextReviewAt: "2026-09-11T00:00:00.000Z",
};

describe("PronunciationLearningUpdate", () => {
  it.each([
    ["PROPOSED", "尚未写入"],
    ["SAVED", "已更新"],
    ["NOT_ELIGIBLE", "不会修改"],
    ["FAILED", "暂未保存"],
  ] as const)("labels %s without overstating persistence", (status, text) => {
    const wrapper = mount(PronunciationLearningUpdate, {
      props: {
        update: {
          status,
          changedItems:
            status === "PROPOSED" || status === "SAVED" ? [change] : [],
        },
      },
    });
    expect(wrapper.get('[role="status"]').text()).toContain(text);
    expect(wrapper.text()).not.toContain(
      status === "PROPOSED" || status === "FAILED"
        ? "学习进度已更新"
        : "__never__",
    );
  });

  it("shows state transitions and an accessible next-review time only when proposed or saved", () => {
    const wrapper = mount(PronunciationLearningUpdate, {
      props: {
        update: { status: "SAVED", changedItems: [change] },
      },
    });
    expect(wrapper.text()).toContain("hello");
    expect(wrapper.text()).toContain("NEW → REVIEW");
    expect(wrapper.get("time").attributes("datetime")).toBe(
      "2026-09-11T00:00:00.000Z",
    );
  });
});
