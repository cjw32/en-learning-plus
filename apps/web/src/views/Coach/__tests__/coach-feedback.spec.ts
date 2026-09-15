import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/apis/coach", () => ({ upsertCoachFeedback: vi.fn() }));
import { upsertCoachFeedback } from "@/apis/coach";
import CoachFeedback from "../components/CoachFeedback.vue";
describe("Coach answer feedback", () => {
  it("edits saved feedback and reuses the same key after a failed save", async () => {
    vi.mocked(upsertCoachFeedback)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        data: {
          rating: "DOWN",
          category: "TOO_HARD",
          comment: "Please simplify",
        },
      } as any);
    const wrapper = mount(CoachFeedback, {
      props: {
        requestId: "owned-request",
        feedback: { rating: "UP", comment: null, category: null },
      },
    });
    await wrapper.get("button").trigger("click");
    await wrapper.get('input[value="DOWN"]').setValue(true);
    await wrapper.get("select").setValue("TOO_HARD");
    await wrapper.get("textarea").setValue("Please simplify");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("保存失败");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const calls = vi.mocked(upsertCoachFeedback).mock.calls;
    expect(calls[0]).toEqual([
      "owned-request",
      { rating: "DOWN", category: "TOO_HARD", comment: "Please simplify" },
      expect.any(String),
    ]);
    expect(calls[1]?.[2]).toBe(calls[0]?.[2]);
    expect(wrapper.emitted("saved")).toHaveLength(1);
    wrapper.unmount();
  });
});
