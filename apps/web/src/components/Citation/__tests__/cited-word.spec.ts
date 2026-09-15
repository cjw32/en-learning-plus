import { reactive } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/apis/word-book", () => ({ getCitedWord: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => route }));
import { getCitedWord } from "@/apis/word-book";
import CitedWord from "../CitedWord.vue";
const route = reactive({ query: { citation: "a" as string | string[] } });
const result = (id: string) =>
  ({
    success: true,
    data: { word: { wordId: id, word: id }, forms: [], examples: [] },
  }) as any;
beforeEach(() => {
  vi.resetAllMocks();
  route.query.citation = "a";
});
describe("citation changes", () => {
  it("ignores a slow result after another citation is selected", async () => {
    let resolve!: (r: any) => void;
    vi.mocked(getCitedWord)
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(result("b"));
    const wrapper = mount(CitedWord);
    route.query.citation = "b";
    await flushPromises();
    resolve(result("a"));
    await flushPromises();
    expect(wrapper.find("h3").text()).toBe("b");
    wrapper.unmount();
  });
  it("rejects multiple or malformed locator values before issuing a lookup", async () => {
    route.query.citation = ["a", "b"];
    const wrapper = mount(CitedWord);
    await flushPromises();
    expect(wrapper.text()).toContain("引用地址无效");
    expect(getCitedWord).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
