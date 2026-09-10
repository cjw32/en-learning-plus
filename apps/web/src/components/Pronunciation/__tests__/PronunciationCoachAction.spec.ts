import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PronunciationCoachAction from "../PronunciationCoachAction.vue";
import { createCoachConversation, createCoachRequest } from "@/apis/coach";

const push = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/apis/coach", () => ({
  createCoachConversation: vi.fn(),
  createCoachRequest: vi.fn(),
}));

describe("PronunciationCoachAction", () => {
  beforeEach(() => {
    vi.mocked(createCoachConversation).mockResolvedValue({
      data: { id: "conversation_00001" },
    } as never);
    vi.mocked(createCoachRequest).mockResolvedValue({
      data: {
        requestId: "request_00001",
        conversationId: "conversation_00001",
        status: "QUEUED",
        streamUrl: "/ai/v1/coach/requests/request_00001/events",
        traceId: "trace_request_00001",
      },
    } as never);
  });

  it("creates a labeled Coach activity and sends only the assessment id as context", async () => {
    const wrapper = mount(PronunciationCoachAction, {
      props: { assessmentId: "assessment_00001", enabled: true },
    });

    expect(wrapper.text()).toContain("新建一条 Coach 活动");
    expect(wrapper.text()).toContain("不会读取录音");
    await wrapper.get("button").trigger("click");

    expect(createCoachConversation).toHaveBeenCalledWith(
      { title: "发音评测后续练习" },
      expect.stringMatching(/^pronunciation-coach-/),
    );
    expect(createCoachRequest).toHaveBeenCalledWith(
      "conversation_00001",
      { type: "RECOMMENDATION", assessmentId: "assessment_00001" },
      expect.stringMatching(/^pronunciation-recommendation-/),
    );
    expect(push).toHaveBeenCalledWith({
      name: "personalized-coach",
      query: {
        conversationId: "conversation_00001",
        requestId: "request_00001",
      },
    });
  });

  it("keeps the learner on the result when the summary/source is unavailable", async () => {
    vi.mocked(createCoachRequest).mockRejectedValueOnce(new Error("not found"));
    const wrapper = mount(PronunciationCoachAction, {
      props: { assessmentId: "assessment_00001", enabled: true },
    });

    await wrapper.get("button").trigger("click");

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "评测或来源暂不可用",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("makes no request while the rollout gate is closed", async () => {
    const wrapper = mount(PronunciationCoachAction, {
      props: { assessmentId: "assessment_00001", enabled: false },
    });

    expect(wrapper.find("button").exists()).toBe(false);
    expect(createCoachRequest).not.toHaveBeenCalled();
  });
});
