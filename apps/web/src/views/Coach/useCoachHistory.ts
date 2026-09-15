import { computed, onBeforeUnmount, ref } from "vue";
import {
  createCoachConversation,
  deleteCoachConversation,
  deleteCoachData,
  getCoachConversation,
  listCoachConversations,
} from "@/apis/coach";
import { useCoachStore } from "@/stores/coach";

export function useCoachHistory(
  current: () => boolean,
  pending: () => boolean,
  leave: () => void,
) {
  const coach = useCoachStore();
  const loading = ref(false);
  const listing = ref(false);
  const mutating = ref(false);
  const deleted = ref(false);
  const message = ref("");
  const nextCursor = ref<string | null>(null);
  const messageCursor = ref<string | null>(null);
  let generation = 0;
  let listGeneration = 0;
  let mounted = true;
  onBeforeUnmount(() => {
    mounted = false;
    generation++;
    listGeneration++;
  });
  const valid = (epoch: number) => mounted && current() && epoch === generation;
  const busy = computed(() => loading.value || mutating.value || deleted.value);
  const key = (name: string) => `${name}-${crypto.randomUUID()}`;
  const available = () =>
    current() && !pending() && !mutating.value && !deleted.value;

  async function list(more = false) {
    if (!current() || listing.value || deleted.value) return;
    listing.value = true;
    const epoch = ++listGeneration;
    try {
      const response = await listCoachConversations({
        limit: 20,
        ...(more && nextCursor.value ? { cursor: nextCursor.value } : {}),
      });
      if (!current() || !mounted || epoch !== listGeneration) return;
      const combined = more
        ? [...coach.conversations, ...response.data.items]
        : response.data.items;
      coach.setConversations([
        ...new Map(combined.map((item) => [item.id, item])).values(),
      ]);
      nextCursor.value = response.data.nextCursor ?? null;
    } catch {
      if (current() && mounted && epoch === listGeneration)
        message.value = "会话列表读取失败，请刷新重试。";
    } finally {
      if (epoch === listGeneration) listing.value = false;
    }
  }

  async function open(id: string) {
    if (!available()) return;
    const epoch = ++generation;
    leave();
    coach.closeConversation();
    loading.value = true;
    messageCursor.value = null;
    message.value = "";
    try {
      const response = await getCoachConversation(id, { limit: 20 });
      if (!valid(epoch)) return;
      coach.openConversation(
        response.data.conversation,
        response.data.messages,
      );
      messageCursor.value = response.data.nextCursor ?? null;
    } catch {
      if (valid(epoch))
        message.value = "会话读取失败或已删除，请重新选择会话。";
    } finally {
      if (valid(epoch)) loading.value = false;
    }
  }

  async function moreMessages() {
    const id = coach.activeConversationId;
    if (!available() || loading.value || !id || !messageCursor.value) return;
    const epoch = generation;
    loading.value = true;
    try {
      const response = await getCoachConversation(id, {
        limit: 20,
        cursor: messageCursor.value,
      });
      if (!valid(epoch)) return;
      const combined = [...coach.messages, ...response.data.messages];
      coach.messages = [
        ...new Map(combined.map((item) => [item.id, item])).values(),
      ].sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      messageCursor.value = response.data.nextCursor ?? null;
    } catch {
      if (valid(epoch)) message.value = "后续消息读取失败，请重试。";
    } finally {
      if (valid(epoch)) loading.value = false;
    }
  }

  async function create(title: string) {
    if (!available() || loading.value) return;
    const epoch = ++generation;
    mutating.value = true;
    message.value = "";
    try {
      const response = await createCoachConversation(
        title.trim() ? { title: title.trim() } : {},
        key("conversation"),
      );
      if (!valid(epoch)) return false;
      listGeneration++;
      listing.value = false;
      leave();
      coach.openConversation(response.data);
      messageCursor.value = null;
      return true;
    } catch {
      if (valid(epoch)) message.value = "新建会话失败，请重试。";
    } finally {
      if (valid(epoch)) mutating.value = false;
    }
    return false;
  }

  async function remove(id: string) {
    if (!available() || loading.value) return;
    const title =
      coach.conversations.find((item) => item.id === id)?.title || "未命名会话";
    if (
      !window.confirm(
        `删除“${title}”？会话和反馈将被清除，已保存的学习记录仍保留。此操作无法撤销。`,
      )
    )
      return;
    const epoch = ++generation;
    mutating.value = true;
    try {
      await deleteCoachConversation(id, key("conversation-delete"));
      if (!valid(epoch)) return;
      listGeneration++;
      listing.value = false;
      coach.setConversations(
        coach.conversations.filter((item) => item.id !== id),
      );
      // Refresh cursors after deletion; the deleted row may have been the pagination cursor.
      nextCursor.value = null;
      if (coach.activeConversationId === id) {
        leave();
        coach.closeConversation();
        messageCursor.value = null;
      }
      message.value = "会话已隐藏，后台正在清理相关内容。";
      await list();
    } catch {
      if (valid(epoch)) message.value = "删除失败，会话仍保留，请重试。";
    } finally {
      if (valid(epoch)) mutating.value = false;
    }
  }

  async function removeAll() {
    if (!available() || loading.value) return;
    if (
      !window.confirm(
        "删除全部 Coach 数据？这会清除所有 Coach 会话、反馈、学习画像、作答及复习数据。删除期间无法使用 Coach，操作无法撤销。",
      )
    )
      return;
    const epoch = ++generation;
    mutating.value = true;
    try {
      await deleteCoachData(key("coach-data-delete"));
      if (!valid(epoch)) return;
      leave();
      listGeneration++;
      listing.value = false;
      coach.reset();
      nextCursor.value = null;
      messageCursor.value = null;
      deleted.value = true;
      message.value =
        "删除请求已受理，Coach 已暂停使用。后台将在 24 小时内完成数据清理。";
    } catch {
      if (valid(epoch)) message.value = "数据删除失败，请重试。";
    } finally {
      if (valid(epoch)) mutating.value = false;
    }
  }
  return {
    loading,
    listing,
    mutating,
    deleted,
    busy,
    message,
    nextCursor,
    messageCursor,
    list,
    open,
    moreMessages,
    create,
    remove,
    removeAll,
  };
}
