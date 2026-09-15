import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia, disposePinia } from "pinia";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/apis/coach", () => ({
  createCoachConversation: vi.fn(),
  deleteCoachConversation: vi.fn(),
  deleteCoachData: vi.fn(),
  getCoachConversation: vi.fn(),
  listCoachConversations: vi.fn(),
  getCoachCitation: vi.fn(),
}));
import * as api from "@/apis/coach";
import { useCoachStore } from "@/stores/coach";
import { useCoachHistory } from "../useCoachHistory";
const conv = (id: string) =>
  ({
    id,
    title: id,
    status: "ACTIVE",
    lastActivityAt: "2026-09-15T00:00:00Z",
    createdAt: "2026-09-15T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
  }) as any;
const message = (id: string) =>
  ({
    id,
    role: "USER",
    content: id,
    structuredResult: null,
    createdAt: `2026-09-15T00:00:0${id.slice(-1)}Z`,
  }) as any;
let pinia: ReturnType<typeof createPinia>,
  wrapper: ReturnType<typeof mount>,
  history: ReturnType<typeof useCoachHistory>;
let current: boolean, pending: boolean;
beforeEach(() => {
  vi.resetAllMocks();
  current = true;
  pending = false;
  pinia = createPinia();
  setActivePinia(pinia);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(api.listCoachConversations).mockResolvedValue({
    data: { items: [], nextCursor: null },
  } as any);
  wrapper = mount(
    defineComponent({
      setup() {
        history = useCoachHistory(
          () => current,
          () => pending,
          vi.fn(),
        );
        return () => h("div");
      },
    }),
    { global: { plugins: [pinia] } },
  );
});
afterEach(() => {
  wrapper.unmount();
  disposePinia(pinia);
  vi.restoreAllMocks();
});
describe("Coach history management", () => {
  it("ignores an older conversation response after a newer selection", async () => {
    let resolve!: (v: any) => void;
    vi.mocked(api.getCoachConversation)
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce({
        data: {
          conversation: conv("b"),
          messages: [message("m2")],
          nextCursor: null,
        },
      } as any);
    const old = history.open("a");
    await history.open("b");
    resolve({
      data: {
        conversation: conv("a"),
        messages: [message("m1")],
        nextCursor: "old",
      },
    });
    await old;
    expect(useCoachStore().activeConversationId).toBe("b");
    expect(useCoachStore().messages[0]?.id).toBe("m2");
    expect(history.messageCursor.value).toBeNull();
  });
  it("pages conversations and messages without duplicates and supports read retry", async () => {
    vi.mocked(api.listCoachConversations)
      .mockResolvedValueOnce({
        data: { items: [conv("a")], nextCursor: "a" },
      } as any)
      .mockResolvedValueOnce({
        data: { items: [conv("a"), conv("b")], nextCursor: null },
      } as any);
    await history.list();
    await history.list(true);
    expect(api.listCoachConversations).toHaveBeenLastCalledWith({
      limit: 20,
      cursor: "a",
    });
    expect(useCoachStore().conversations.map((c) => c.id)).toEqual(["a", "b"]);
    vi.mocked(api.getCoachConversation)
      .mockResolvedValueOnce({
        data: {
          conversation: conv("a"),
          messages: [message("m1")],
          nextCursor: "m1",
        },
      } as any)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        data: {
          conversation: conv("a"),
          messages: [message("m1"), message("m2")],
          nextCursor: null,
        },
      } as any);
    await history.open("a");
    await history.moreMessages();
    expect(history.messageCursor.value).toBe("m1");
    expect(history.message.value).toContain("失败");
    await history.moreMessages();
    expect(useCoachStore().messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
  it("creates a conversation and clears previous stream, retry and exercise state", async () => {
    const store = useCoachStore();
    store.openConversation(conv("a"));
    store.beginStream("old-request");
    store.submissionPending = true;
    store.provisionalText = "old";
    store.error = { code: "NETWORK_ERROR", message: "old", retryable: true };
    vi.mocked(api.createCoachConversation).mockResolvedValue({
      data: conv("b"),
    } as any);
    expect(await history.create(" Topic ")).toBe(true);
    expect(api.createCoachConversation).toHaveBeenCalledWith(
      { title: "Topic" },
      expect.any(String),
    );
    expect(store.activeRequestId).toBeNull();
    expect(store.streamState).toBe("idle");
    expect(store.submissionPending).toBe(false);
    expect(store.error).toBeNull();
  });
  it("preserves a conversation on failed deletion, then removes and clears it on retry", async () => {
    const store = useCoachStore();
    store.openConversation(conv("a"), [message("m1")]);
    vi.mocked(api.deleteCoachConversation)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { status: "ACCEPTED" } } as any);
    await history.remove("a");
    expect(store.activeConversationId).toBe("a");
    expect(store.messages).toHaveLength(1);
    await history.remove("a");
    expect(store.activeConversationId).toBeNull();
    expect(store.messages).toEqual([]);
  });
  it("requires explicit confirmation and clears all state only after deletion is accepted", async () => {
    const store = useCoachStore();
    store.openConversation(conv("a"), [message("m1")]);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await history.removeAll();
    expect(api.deleteCoachData).not.toHaveBeenCalled();
    vi.mocked(api.deleteCoachData)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { status: "ACCEPTED" } } as any);
    await history.removeAll();
    expect(store.messages).toHaveLength(1);
    expect(history.deleted.value).toBe(false);
    await history.removeAll();
    expect(store.messages).toEqual([]);
    expect(history.busy.value).toBe(true);
  });
  it("blocks management while streaming and ignores results after account change", async () => {
    pending = true;
    await history.create("blocked");
    await history.open("a");
    await history.remove("a");
    await history.removeAll();
    expect(api.createCoachConversation).not.toHaveBeenCalled();
    expect(api.getCoachConversation).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    pending = false;
    let resolve!: (v: any) => void;
    vi.mocked(api.getCoachConversation).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const operation = history.open("a");
    current = false;
    resolve({ data: { conversation: conv("a"), messages: [message("m1")] } });
    await operation;
    expect(useCoachStore().messages).toEqual([]);
  });
});
