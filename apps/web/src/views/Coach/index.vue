<template>
  <main
    class="mx-auto grid w-full max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[280px_1fr]"
  >
    <aside class="space-y-5">
      <section
        class="rounded-2xl border border-slate-200 bg-white p-4"
        aria-labelledby="coach-history-title"
      >
        <h2 id="coach-history-title" class="font-semibold text-slate-900">
          历史会话
        </h2>
        <form class="my-3 space-y-2" @submit.prevent="createConversation">
          <label class="block text-sm text-slate-600"
            >新会话名称（选填）
            <input
              v-model="newTitle"
              maxlength="120"
              placeholder="例如：日常口语练习"
              class="mt-1 w-full rounded-lg border px-3 py-2"
              :disabled="managementDisabled"
            />
          </label>
          <button
            type="submit"
            class="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            :disabled="managementDisabled"
          >
            新建会话
          </button>
        </form>
        <p v-if="pending" class="mb-3 text-xs text-slate-500">
          回答进行中，请先完成或取消，再切换或管理会话。
        </p>
        <p
          v-if="history.listing.value"
          role="status"
          class="text-sm text-slate-500"
        >
          正在读取会话…
        </p>
        <p
          v-else-if="!coach.conversations.length"
          class="text-sm text-slate-500"
        >
          还没有会话，可以新建或直接提问。
        </p>
        <ul class="max-h-96 space-y-2 overflow-y-auto">
          <li
            v-for="conversation in coach.conversations"
            :key="conversation.id"
            class="rounded-lg border p-2"
            :class="
              conversation.id === coach.activeConversationId
                ? 'border-blue-400 bg-blue-50'
                : 'border-slate-100'
            "
          >
            <button
              type="button"
              class="w-full text-left text-sm disabled:opacity-50"
              :aria-current="
                conversation.id === coach.activeConversationId
                  ? 'true'
                  : undefined
              "
              :disabled="
                pending ||
                initializing ||
                history.mutating.value ||
                history.deleted.value
              "
              @click="history.open(conversation.id)"
            >
              <span class="block break-words font-medium">{{
                conversation.title || "未命名会话"
              }}</span>
              <time
                class="text-xs text-slate-500"
                :datetime="conversation.lastActivityAt"
                >{{
                  new Date(conversation.lastActivityAt).toLocaleString()
                }}</time
              >
            </button>
            <button
              type="button"
              class="mt-2 text-xs text-rose-700 disabled:opacity-50"
              :aria-label="`删除会话：${conversation.title || '未命名会话'}`"
              :disabled="managementDisabled"
              @click="history.remove(conversation.id)"
            >
              删除会话
            </button>
          </li>
        </ul>
        <div class="mt-3 flex gap-3 text-sm text-blue-700">
          <button
            v-if="history.nextCursor.value"
            type="button"
            :disabled="history.listing.value || managementDisabled"
            @click="history.list(true)"
          >
            加载更多会话
          </button>
          <button
            type="button"
            :disabled="history.listing.value || managementDisabled"
            @click="history.list()"
          >
            刷新会话
          </button>
        </div>
      </section>
      <p
        v-if="history.message.value"
        role="status"
        class="rounded-xl bg-blue-50 p-3 text-sm text-slate-700"
      >
        {{ history.message.value }}
      </p>
      <LearnerProfileEditor
        v-if="coach.profile && !history.deleted.value"
        :profile="coach.profile"
        :saving="savingProfile || managementDisabled"
        @save="saveProfile"
      />
      <div
        v-else-if="!history.deleted.value"
        class="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500"
      >
        正在读取你的学习画像…
      </div>
      <details class="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <summary class="cursor-pointer font-medium">Coach 数据管理</summary>
        <p class="my-3 text-slate-600">
          删除全部 Coach
          数据会清除会话、反馈、学习画像、作答和复习数据。删除期间无法使用
          Coach。
        </p>
        <button
          type="button"
          class="text-rose-700 disabled:opacity-50"
          :disabled="managementDisabled || savingProfile"
          @click="history.removeAll()"
        >
          删除全部 Coach 数据
        </button>
      </details>
    </aside>

    <section
      class="flex min-h-[680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"
    >
      <header class="border-b border-slate-200 bg-white px-6 py-4">
        <h1 class="text-xl font-semibold text-slate-900">
          个性化英语学习 Coach
        </h1>
        <p class="mt-1 text-sm text-slate-500">
          基于你的水平、已学词汇与薄弱项提供讲解和练习建议。
        </p>
      </header>

      <div class="flex-1 space-y-4 overflow-y-auto p-6" aria-live="polite">
        <h2 v-if="coach.activeConversation" class="font-medium text-slate-700">
          {{ coach.activeConversation.title || "未命名会话" }}
        </h2>
        <p
          v-if="initializing || history.loading.value"
          role="status"
          class="text-sm text-slate-500"
        >
          正在读取消息…
        </p>
        <p
          v-else-if="!coach.messages.length && !history.deleted.value"
          class="text-sm text-slate-500"
        >
          从一个问题开始这次学习吧。
        </p>
        <template v-for="message in coach.messages" :key="message.id">
          <div v-if="message.role === 'COACH' && message.structuredResult">
            <CoachMessage :result="message.structuredResult" />
            <CoachFeedback
              v-if="message.requestId"
              :key="message.id"
              :request-id="message.requestId"
              :feedback="message.feedback"
              :disabled="pending || managementDisabled"
              @saved="message.feedback = $event"
            />
          </div>
          <p
            v-else-if="message.content"
            class="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-3 text-sm text-white"
          >
            {{ message.content }}
          </p>
        </template>

        <button
          v-if="history.messageCursor.value"
          type="button"
          class="text-sm text-blue-700 disabled:opacity-50"
          :disabled="managementDisabled"
          @click="history.moreMessages()"
        >
          加载后续消息
        </button>
        <div
          v-if="coach.provisionalText"
          class="rounded-2xl bg-white p-5 text-sm text-slate-700 shadow-sm"
        >
          {{ coach.provisionalText }}
        </div>
        <ExerciseCard
          v-if="coach.activeExercise"
          :exercise="coach.activeExercise"
          :coach-request-id="coach.activeRequestId"
          :submitting="coach.submissionPending"
          @submit="stageExerciseAnswers"
        />
        <CoachProgress
          :state="coach.streamState"
          :server-label="coach.serverStatusLabel || statusLabel"
          :tool-status="coach.toolStatus"
        />
        <p
          v-if="statusLabel && coach.streamState === 'idle'"
          role="status"
          class="rounded-xl bg-blue-50 p-3 text-sm text-slate-700"
        >
          {{ statusLabel }}
        </p>
        <p
          v-if="coach.error"
          class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
        >
          {{ coach.error.message }}
        </p>
      </div>

      <CoachComposer
        :key="coach.activeConversationId || 'new'"
        :disabled="initializing || history.busy.value"
        :pending="pending"
        :retryable="coach.error?.retryable"
        @submit="sendMessage"
        @cancel="cancelPending"
        @retry="retryLast"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { CoachProfileUpdate } from "@en/common/coach";
import type { ExerciseType } from "@en/common/coach";
import {
  createCoachConversation,
  createCoachRequest,
  cancelCoachRequest,
  getCoachProfile,
  getCoachRequest,
  retryCoachRequest,
  updateCoachProfile,
} from "@/apis/coach";
import { openCoachStream } from "@/apis/coach/stream";
import { useCoachStore } from "@/stores/coach";
import CoachComposer from "./components/CoachComposer.vue";
import CoachMessage from "./components/CoachMessage.vue";
import LearnerProfileEditor from "./components/LearnerProfileEditor.vue";
import ExerciseCard from "./components/ExerciseCard.vue";
import CoachProgress from "./components/CoachProgress.vue";
import CoachFeedback from "./components/CoachFeedback.vue";
import { useCoachHistory } from "./useCoachHistory";

import {
  learningSessionVersion,
  isLearningSessionCurrent,
  onLearningSessionChange,
} from "@/session/learning-session";
const version = learningSessionVersion();
let disposed = false;
const isCurrent = () => !disposed && isLearningSessionCurrent(version);
const assertCurrent = () => {
  if (!isCurrent()) throw new DOMException("Session changed", "AbortError");
};
const coach = useCoachStore();
const route = useRoute();
const router = useRouter();
const pending = ref(false);
const savingProfile = ref(false);
const statusLabel = ref("");
const lastMessage = ref("");
const lastExercisePreferences = ref<
  | {
      types: ExerciseType[];
      count: number;
    }
  | undefined
>();
const lastRequestId = ref<string | null>(null);
let streamAbort: AbortController | null = null;
const unsubscribe = onLearningSessionChange(() => {
  streamAbort?.abort();
});
onBeforeUnmount(() => {
  disposed = true;
  streamAbort?.abort();
  unsubscribe();
});

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
}

const initializing = ref(true);
const newTitle = ref("");
function leaveConversation() {
  streamAbort?.abort();
  lastRequestId.value = null;
  lastMessage.value = "";
  lastExercisePreferences.value = undefined;
  statusLabel.value = "";
}
const history = useCoachHistory(
  isCurrent,
  () => pending.value,
  leaveConversation,
);
const managementDisabled = computed(
  () => initializing.value || pending.value || history.busy.value,
);
async function createConversation() {
  if (await history.create(newTitle.value)) newTitle.value = "";
}

onMounted(async () => {
  try {
    const [profile] = await Promise.all([getCoachProfile(), history.list()]);
    assertCurrent();
    coach.setProfile(profile.data);
    const conversationId =
      typeof route.query.conversationId === "string"
        ? route.query.conversationId
        : null;
    const requestId =
      typeof route.query.requestId === "string" ? route.query.requestId : null;
    const selectedId = conversationId || coach.conversations[0]?.id;
    if (selectedId) await history.open(selectedId);
    if (
      conversationId &&
      requestId &&
      coach.activeConversationId === conversationId
    ) {
      pending.value = true;
      await followAcceptedRequest({
        requestId,
        streamUrl: `/ai/v1/coach/requests/${encodeURIComponent(requestId)}/events`,
      });
      assertCurrent();
      await router.replace({ name: "personalized-coach" });
    }
  } catch {
    if (isCurrent())
      statusLabel.value = "暂时无法读取 Coach 数据，请刷新页面重试。";
  } finally {
    if (isCurrent()) {
      initializing.value = false;
      pending.value = false;
    }
  }
});

async function saveProfile(update: CoachProfileUpdate) {
  if (savingProfile.value || managementDisabled.value) return;
  savingProfile.value = true;
  try {
    const response = await updateCoachProfile(
      update,
      idempotencyKey("profile"),
    );
    assertCurrent();
    coach.setProfile(response.data);
  } catch {
    if (isCurrent()) history.message.value = "画像保存失败，请重试。";
  } finally {
    savingProfile.value = false;
  }
}

async function ensureConversation() {
  if (coach.activeConversationId) return coach.activeConversationId;
  const response = await createCoachConversation(
    {},
    idempotencyKey("conversation"),
  );
  assertCurrent();
  coach.openConversation(response.data);
  return response.data.id;
}

async function sendMessage(
  message: string,
  exercisePreferences?: { types: ExerciseType[]; count: number },
) {
  if (!isCurrent() || pending.value || history.busy.value || initializing.value)
    return;
  lastMessage.value = message;
  lastExercisePreferences.value = exercisePreferences;
  pending.value = true;
  coach.resetRequestState();
  statusLabel.value = "正在连接 Coach…";
  try {
    const conversationId = await ensureConversation();
    assertCurrent();
    coach.messages.push({
      id: `local-${crypto.randomUUID()}`,
      role: "USER",
      content: message,
      structuredResult: null,
      createdAt: new Date().toISOString(),
    });
    const accepted = await createCoachRequest(
      conversationId,
      {
        type: "MESSAGE",
        message,
        ...(exercisePreferences
          ? { intentHint: "CREATE_EXERCISE" as const, exercisePreferences }
          : {}),
      },
      idempotencyKey("request"),
    );
    assertCurrent();
    await followAcceptedRequest(accepted.data);
  } catch {
    if (!isCurrent()) return;
    statusLabel.value = "请求失败，请安全重试。";
  } finally {
    pending.value = false;
  }
}

async function followAcceptedRequest(accepted: {
  requestId: string;
  streamUrl: string;
}) {
  assertCurrent();
  lastRequestId.value = accepted.requestId;
  streamAbort?.abort();
  const controller = new AbortController();
  streamAbort = controller;
  coach.beginStream(accepted.requestId);
  try {
    await openCoachStream({
      streamUrl: accepted.streamUrl,
      signal: controller.signal,
      onEvent: (event) => {
        if (isCurrent() && !controller.signal.aborted) coach.acceptEvent(event);
      },
      onReplayExpired: async () => {
        if (!isCurrent() || controller.signal.aborted) return;
        coach.markReplayExpired();
        const durable = await getCoachRequest(accepted.requestId);
        if (isCurrent() && !controller.signal.aborted)
          coach.reconcileRequest(durable.data);
      },
    });
  } catch (error) {
    if (isCurrent() && !controller.signal.aborted) coach.markStreamFailure();
  }
}

async function cancelPending() {
  if (!lastRequestId.value) return;
  try {
    const response = await cancelCoachRequest(
      lastRequestId.value,
      idempotencyKey("cancel"),
    );
    assertCurrent();
    coach.markCancellationAccepted(response.data.saveStatus);
    streamAbort?.abort();
  } catch {
    if (isCurrent())
      history.message.value = "取消未成功，请重试；当前会话仍在处理中。";
  }
}

async function retryLast() {
  if (!lastRequestId.value || pending.value || history.busy.value) return;
  pending.value = true;
  try {
    const response = await retryCoachRequest(
      lastRequestId.value,
      idempotencyKey("retry"),
    );
    assertCurrent();
    if ("streamUrl" in response.data)
      await followAcceptedRequest(response.data);
    else coach.reconcileRequest(response.data);
  } catch {
    if (isCurrent()) history.message.value = "重试失败，请稍后再试。";
  } finally {
    if (isCurrent()) pending.value = false;
  }
}

async function stageExerciseAnswers(
  answers: Array<{ itemId: string; answer: string }>,
) {
  const exercise = coach.activeExercise;
  if (
    !exercise ||
    coach.submissionPending ||
    pending.value ||
    history.busy.value
  )
    return;
  pending.value = true;
  const submission = coach.prepareExerciseSubmission(exercise.id, answers);
  statusLabel.value = "正在安全批改并保存学习结果…";
  try {
    const conversationId = await ensureConversation();
    const accepted = await createCoachRequest(
      conversationId,
      submission.body,
      submission.idempotencyKey,
    );
    assertCurrent();
    await followAcceptedRequest(accepted.data);
  } catch {
    if (!isCurrent()) return;
    coach.failExerciseSubmission();
    statusLabel.value = "提交失败；重试会复用同一幂等键。";
  } finally {
    if (isCurrent()) pending.value = false;
  }
}
</script>
