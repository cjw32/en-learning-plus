import { defineComponent, h, reactive } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia, disposePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/apis/learn", () => ({ getStudyStats: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => route }));
import { getStudyStats } from "@/apis/learn";
import { useUserStore } from "@/stores/user";
import { useStudyStats } from "../useStudyStats";
import { notifyStudyProgress } from "@/session/study-progress";
const route = reactive({ fullPath: "/words" });
const result = (dayNumber: number) =>
  ({
    success: true,
    data: { dayNumber, wordNumber: 10, checkedInToday: true },
  }) as any;
let pinia: ReturnType<typeof createPinia>,
  wrapper: ReturnType<typeof mount>,
  stats: ReturnType<typeof useStudyStats>;
function start() {
  wrapper = mount(
    defineComponent({
      setup() {
        stats = useStudyStats();
        return () => h("div");
      },
    }),
    { global: { plugins: [pinia] } },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  useUserStore().setUser({ id: "a", dayNumber: 0, wordNumber: 0 } as any);
});
afterEach(() => {
  wrapper?.unmount();
  disposePinia(pinia);
});
describe("saved study progress refresh", () => {
  it("loads saved totals and refreshes after learning completion", async () => {
    vi.mocked(getStudyStats)
      .mockResolvedValueOnce(result(1))
      .mockResolvedValueOnce(result(2));
    start();
    await flushPromises();
    expect(useUserStore().user?.dayNumber).toBe(1);
    notifyStudyProgress();
    await flushPromises();
    expect(useUserStore().user?.dayNumber).toBe(2);
    expect(stats.checkedInToday.value).toBe(true);
  });
  it("ignores a delayed response from the previous account", async () => {
    let resolve!: (value: any) => void;
    vi.mocked(getStudyStats)
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(result(2));
    start();
    useUserStore().setUser({ id: "b", dayNumber: 0, wordNumber: 0 } as any);
    await flushPromises();
    resolve(result(99));
    await flushPromises();
    expect(useUserStore().user?.dayNumber).toBe(2);
  });
  it("preserves totals on failure and removes event listeners on unmount", async () => {
    vi.mocked(getStudyStats).mockRejectedValue(new Error("offline"));
    start();
    await flushPromises();
    expect(useUserStore().user?.dayNumber).toBe(0);
    wrapper.unmount();
    notifyStudyProgress();
    await flushPromises();
    expect(getStudyStats).toHaveBeenCalledTimes(1);
  });
});
