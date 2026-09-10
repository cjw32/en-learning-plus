import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PronunciationHistory from "../PronunciationHistory.vue";
import {
  deletePronunciationAssessment,
  deletePronunciationAudio,
  getPronunciationAudio,
  listPronunciationAssessments,
} from "@/apis/pronunciation";

vi.mock("@/apis/pronunciation", () => ({
  listPronunciationAssessments: vi.fn(),
  getPronunciationAudio: vi.fn(),
  deletePronunciationAudio: vi.fn(),
  deletePronunciationAssessment: vi.fn(),
}));

const item = {
  assessmentId: "assessment_00001",
  status: "COMPLETED",
  exerciseType: "WORD",
  locale: "en-US",
  referenceText: "hello",
  retryOfAssessmentId: null,
  result: null,
  diagnostic: null,
  learningWriteStatus: "SAVED",
  audio: {
    status: "READY",
    available: true,
    expiresAt: "2026-09-11T00:00:00.000Z",
  },
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  traceId: "trace_00001",
};

describe("PronunciationHistory", () => {
  beforeEach(() => {
    vi.mocked(listPronunciationAssessments).mockResolvedValue({
      code: 200,
      data: { items: [structuredClone(item)], nextCursor: null },
    } as never);
    vi.mocked(getPronunciationAudio).mockResolvedValue(
      new Blob(["wav"], { type: "audio/wav" }),
    );
    vi.mocked(deletePronunciationAudio).mockResolvedValue({
      data: { deletionId: "delete_1" },
    } as never);
    vi.mocked(deletePronunciationAssessment).mockResolvedValue({
      data: { deletionId: "delete_2" },
    } as never);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned-audio");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("plays through an authenticated Blob request and revokes the object URL", async () => {
    const wrapper = mount(PronunciationHistory);
    await vi.waitFor(() => expect(wrapper.text()).toContain("hello"));
    await wrapper.get('[data-action="play"]').trigger("click");
    expect(getPronunciationAudio).toHaveBeenCalledWith("assessment_00001");
    expect(wrapper.get("audio").attributes("src")).toBe("blob:owned-audio");
    wrapper.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owned-audio");
  });

  it("distinguishes audio-only deletion from full assessment deletion", async () => {
    const wrapper = mount(PronunciationHistory);
    await vi.waitFor(() => expect(wrapper.text()).toContain("hello"));

    await wrapper.get('[data-action="delete-audio"]').trigger("click");
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("保留评测结果"),
    );
    expect(deletePronunciationAudio).toHaveBeenCalledWith(
      "assessment_00001",
      expect.stringMatching(/^pronunciation-delete-audio-/),
    );
    expect(wrapper.text()).toContain("录音已撤销");
    expect(wrapper.text()).toContain("hello");

    await wrapper.get('[data-action="delete-assessment"]').trigger("click");
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("学习影响"),
    );
    expect(deletePronunciationAssessment).toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("hello");
  });

  it("does nothing when destructive confirmation is declined", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const wrapper = mount(PronunciationHistory);
    await vi.waitFor(() => expect(wrapper.text()).toContain("hello"));
    await wrapper.get('[data-action="delete-assessment"]').trigger("click");
    expect(deletePronunciationAssessment).not.toHaveBeenCalled();
  });
});
