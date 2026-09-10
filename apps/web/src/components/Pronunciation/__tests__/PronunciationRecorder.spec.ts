import { computed, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recorder = {
  state: ref("idle"),
  elapsedMs: ref(0),
  level: ref(0),
  recording: ref<null | {
    blob: Blob;
    objectUrl: string;
    mimeType: string;
    durationMs: number;
  }>(null),
  canStart: computed(() => true),
  start: vi.fn(),
  stop: vi.fn(),
  deleteRecording: vi.fn(),
  dispose: vi.fn(),
};

vi.mock("@/hooks/usePronunciationRecorder", () => ({
  usePronunciationRecorder: () => recorder,
}));

import PronunciationRecorder from "../PronunciationRecorder.vue";

async function mountWithRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: PronunciationRecorder },
      { path: "/away", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  return {
    router,
    wrapper: mount(
      { template: "<router-view />" },
      { global: { plugins: [router] } },
    ),
  };
}

describe("PronunciationRecorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorder.state.value = "idle";
    recorder.elapsedMs.value = 0;
    recorder.level.value = 0;
    recorder.recording.value = null;
  });

  it("discloses permission purpose before an explicit recording action", async () => {
    const { wrapper } = await mountWithRouter();
    expect(wrapper.text()).toContain("麦克风");
    expect(wrapper.text()).toContain("仅在你点击开始后");
    expect(recorder.start).not.toHaveBeenCalled();
    await wrapper.get('[data-test="recorder-start"]').trigger("click");
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["recording", "正在录音"],
    ["permission_denied", "未获得麦克风权限"],
    ["no_device", "未检测到麦克风"],
    ["interrupted", "录音已中断"],
    ["unsupported", "当前浏览器不支持录音"],
  ])(
    "labels %s with visible text rather than color alone",
    async (state, label) => {
      recorder.state.value = state;
      const { wrapper } = await mountWithRouter();
      expect(wrapper.text()).toContain(label);
      expect(wrapper.get('[role="status"]').text()).toContain(label);
    },
  );

  it("has no pause control and offers stop during continuous recording", async () => {
    recorder.state.value = "recording";
    const { wrapper } = await mountWithRouter();
    expect(wrapper.text()).not.toContain("暂停");
    await wrapper.get('[data-test="recorder-stop"]').trigger("click");
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("renders local playback plus explicit delete and re-record controls", async () => {
    recorder.state.value = "preview";
    recorder.recording.value = {
      blob: new Blob(["voice"], { type: "audio/webm" }),
      objectUrl: "blob:local-preview",
      mimeType: "audio/webm",
      durationMs: 1_000,
    };
    const { wrapper } = await mountWithRouter();
    expect(wrapper.get("audio").attributes("src")).toBe("blob:local-preview");
    await wrapper.get('[data-test="recorder-delete"]').trigger("click");
    expect(recorder.deleteRecording).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-test="recorder-rerecord"]').trigger("click");
    expect(recorder.deleteRecording).toHaveBeenCalledTimes(2);
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });

  it("asks before destructive navigation while audio is active", async () => {
    recorder.state.value = "recording";
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { router } = await mountWithRouter();
    await router.push("/away");
    expect(confirm).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/");
    confirm.mockRestore();
  });
});
