<template>
  <main class="mx-auto grid w-full max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[280px_1fr]">
    <aside>
      <LearnerProfileEditor
        v-if="coach.profile"
        :profile="coach.profile"
        :saving="savingProfile"
        @save="saveProfile"
      />
      <div v-else class="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        正在读取你的学习画像…
      </div>
    </aside>

    <section class="flex min-h-[680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
      <header class="border-b border-slate-200 bg-white px-6 py-4">
        <h1 class="text-xl font-semibold text-slate-900">个性化英语学习 Coach</h1>
        <p class="mt-1 text-sm text-slate-500">
          基于你的水平、已学词汇与薄弱项提供讲解和练习建议。
        </p>
      </header>

      <div class="flex-1 space-y-4 overflow-y-auto p-6" aria-live="polite">
        <template v-for="message in coach.messages" :key="message.id">
          <CoachMessage
            v-if="message.role === 'COACH' && message.structuredResult"
            :result="message.structuredResult"
          />
          <p
            v-else-if="message.content"
            class="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-3 text-sm text-white"
          >
            {{ message.content }}
          </p>
        </template>

        <div v-if="coach.provisionalText" class="rounded-2xl bg-white p-5 text-sm text-slate-700 shadow-sm">
          {{ coach.provisionalText }}
        </div>
        <ExerciseCard
          v-if="coach.activeExercise"
          :exercise="coach.activeExercise"
          :submitting="coach.submissionPending"
          @submit="stageExerciseAnswers"
        />
        <CoachProgress
          :state="coach.streamState"
          :server-label="coach.serverStatusLabel || statusLabel"
          :tool-status="coach.toolStatus"
        />
        <p v-if="coach.error" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
          {{ coach.error.message }}
        </p>
      </div>

      <CoachComposer
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
import { onMounted, ref } from 'vue'
import type { CoachProfileUpdate } from '@en/common/coach'
import type { ExerciseType } from '@en/common/coach'
import {
  createCoachConversation,
  createCoachRequest,
  cancelCoachRequest,
  getCoachConversation,
  getCoachProfile,
  getCoachRequest,
  listCoachConversations,
  retryCoachRequest,
  updateCoachProfile,
} from '@/apis/coach'
import { openCoachStream } from '@/apis/coach/stream'
import { useCoachStore } from '@/stores/coach'
import CoachComposer from './components/CoachComposer.vue'
import CoachMessage from './components/CoachMessage.vue'
import LearnerProfileEditor from './components/LearnerProfileEditor.vue'
import ExerciseCard from './components/ExerciseCard.vue'
import CoachProgress from './components/CoachProgress.vue'

const coach = useCoachStore()
const pending = ref(false)
const savingProfile = ref(false)
const statusLabel = ref('')
const lastMessage = ref('')
const lastExercisePreferences = ref<{
  types: ExerciseType[]
  count: number
} | undefined>()
const lastRequestId = ref<string | null>(null)
let streamAbort: AbortController | null = null

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replaceAll('-', '')}`
}

async function loadConversation(conversationId: string) {
  const detail = await getCoachConversation(conversationId)
  coach.openConversation(detail.data.conversation, detail.data.messages)
}

onMounted(async () => {
  try {
    const [profile, conversations] = await Promise.all([
      getCoachProfile(),
      listCoachConversations({ limit: 20 }),
    ])
    coach.setProfile(profile.data)
    coach.setConversations(conversations.data.items)
    const first = conversations.data.items[0]
    if (first) await loadConversation(first.id)
  } catch {
    statusLabel.value = '暂时无法读取 Coach 数据，请稍后重试。'
  }
})

async function saveProfile(update: CoachProfileUpdate) {
  savingProfile.value = true
  try {
    const response = await updateCoachProfile(
      update,
      idempotencyKey('profile'),
    )
    coach.setProfile(response.data)
  } finally {
    savingProfile.value = false
  }
}

async function ensureConversation() {
  if (coach.activeConversationId) return coach.activeConversationId
  const response = await createCoachConversation(
    {},
    idempotencyKey('conversation'),
  )
  coach.openConversation(response.data)
  return response.data.id
}

async function sendMessage(
  message: string,
  exercisePreferences?: { types: ExerciseType[]; count: number },
) {
  lastMessage.value = message
  lastExercisePreferences.value = exercisePreferences
  pending.value = true
  coach.resetRequestState()
  statusLabel.value = '正在连接 Coach…'
  try {
    const conversationId = await ensureConversation()
    coach.messages.push({
      id: `local-${crypto.randomUUID()}`,
      role: 'USER',
      content: message,
      structuredResult: null,
      createdAt: new Date().toISOString(),
    })
    const accepted = await createCoachRequest(
      conversationId,
      {
        type: 'MESSAGE',
        message,
        ...(exercisePreferences
          ? { intentHint: 'CREATE_EXERCISE' as const, exercisePreferences }
          : {}),
      },
      idempotencyKey('request'),
    )
    await followAcceptedRequest(accepted.data)
  } catch {
    statusLabel.value = '请求失败，请安全重试。'
  } finally {
    pending.value = false
  }
}

async function followAcceptedRequest(accepted: {
  requestId: string
  streamUrl: string
}) {
  lastRequestId.value = accepted.requestId
  streamAbort?.abort()
  streamAbort = new AbortController()
  coach.beginStream(accepted.requestId)
  try {
    await openCoachStream({
      streamUrl: accepted.streamUrl,
      signal: streamAbort.signal,
      onEvent: (event) => coach.acceptEvent(event),
      onReplayExpired: async () => {
        coach.markReplayExpired()
        const durable = await getCoachRequest(accepted.requestId)
        coach.reconcileRequest(durable.data)
      },
    })
  } catch (error) {
    if (!streamAbort.signal.aborted) coach.markStreamFailure()
  }
}

async function cancelPending() {
  if (!lastRequestId.value) return
  try {
    const response = await cancelCoachRequest(
      lastRequestId.value,
      idempotencyKey('cancel'),
    )
    coach.markCancellationAccepted(response.data.saveStatus)
  } finally {
    streamAbort?.abort()
  }
}

async function retryLast() {
  if (!lastRequestId.value) return
  const response = await retryCoachRequest(
    lastRequestId.value,
    idempotencyKey('retry'),
  )
  if ('streamUrl' in response.data) await followAcceptedRequest(response.data)
  else coach.reconcileRequest(response.data)
}

async function stageExerciseAnswers(
  answers: Array<{ itemId: string; answer: string }>,
) {
  const exercise = coach.activeExercise
  if (!exercise || coach.submissionPending) return
  const submission = coach.prepareExerciseSubmission(exercise.id, answers)
  statusLabel.value = '正在安全批改并保存学习结果…'
  try {
    const conversationId = await ensureConversation()
    const accepted = await createCoachRequest(
      conversationId,
      submission.body,
      submission.idempotencyKey,
    )
    await followAcceptedRequest(accepted.data)
  } catch {
    coach.failExerciseSubmission()
    statusLabel.value = '提交失败；重试会复用同一幂等键。'
  }
}
</script>
