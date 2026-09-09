import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  anyPublicCoachResultSchema,
  coachSseEventSchema,
  type AnyPublicCoachResult,
  type CoachProfile,
  type PublicCoachCitationV2,
  type CoachSseEvent,
  type CreateCoachRequest,
  type CoachRequest,
} from '@en/common/coach'
import { getCoachCitation } from '@/apis/coach'
import type {
  CoachConversation,
  CoachMessage,
} from '@/apis/coach/contracts'

export type CoachStoreError = {
  code: string
  message: string
  retryable: boolean
}

export type CoachStreamState =
  | 'idle'
  | 'connecting'
  | 'reconciling'
  | 'queued'
  | 'generating'
  | 'tool_running'
  | 'grading'
  | 'saving'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'timed_out'
  | 'budget_exceeded'

export const useCoachStore = defineStore('coach', () => {
  const profile = ref<CoachProfile | null>(null)
  const conversations = ref<CoachConversation[]>([])
  const activeConversationId = ref<string | null>(null)
  const messages = ref<CoachMessage[]>([])
  const finalResult = ref<AnyPublicCoachResult | null>(null)
  const provisionalText = ref('')
  const lastEventSequence = ref(-1)
  const error = ref<CoachStoreError | null>(null)
  const streamState = ref<CoachStreamState>('idle')
  const activeRequestId = ref<string | null>(null)
  const toolStatus = ref<
    Extract<CoachSseEvent, { type: 'tool_status' }>['payload'] | null
  >(null)
  const retryRequested = ref(false)
  const serverStatusLabel = ref('')
  const processedEventIds = new Set<string>()
  let resultEventId: string | null = null
  const submissionPending = ref(false)
  const pendingExerciseId = ref<string | null>(null)
  const submissionKeys = new Map<string, string>()

  const activeConversation = computed(
    () =>
      conversations.value.find(
        (conversation) => conversation.id === activeConversationId.value,
      ) ?? null,
  )
  const activeExercise = computed(() => finalResult.value?.exercise ?? null)
  const claimsByCitationId = computed(() => {
    const result = finalResult.value
    const claims =
      result?.schemaVersion === 'coach.result.v2' ? result.groundedClaims : []
    const grouped = new Map<string, typeof claims>()
    for (const claim of claims) {
      for (const citationId of claim.citationIds) {
        grouped.set(citationId, [...(grouped.get(citationId) ?? []), claim])
      }
    }
    return grouped
  })

  function setProfile(value: CoachProfile) {
    profile.value = value
  }

  function setConversations(value: CoachConversation[]) {
    conversations.value = [...value]
  }

  function openConversation(
    conversation: CoachConversation,
    history: CoachMessage[] = [],
  ) {
    activeConversationId.value = conversation.id
    const index = conversations.value.findIndex(
      (item) => item.id === conversation.id,
    )
    if (index === -1) conversations.value.unshift(conversation)
    else conversations.value[index] = conversation
    messages.value = [...history]
    finalResult.value = null
    provisionalText.value = ''
    lastEventSequence.value = -1
    error.value = null
  }

  function appendProvisional(text: string) {
    provisionalText.value += text
  }

  function rejectUntrustedResult() {
    provisionalText.value = ''
    error.value = {
      code: 'SCHEMA_INVALID',
      message: 'Coach 返回结果格式无效，请安全重试。',
      retryable: true,
    }
    return false
  }

  function acceptResult(untrusted: unknown): boolean {
    const normalized = (() => {
      if (
        !untrusted ||
        typeof untrusted !== 'object' ||
        !('schemaVersion' in untrusted) ||
        untrusted.schemaVersion !== 'coach.result.v2' ||
        !('citations' in untrusted) ||
        !Array.isArray(untrusted.citations)
      ) {
        return untrusted
      }
      const seen = new Set<string>()
      return {
        ...untrusted,
        citations: untrusted.citations.filter((citation) => {
          if (
            !citation ||
            typeof citation !== 'object' ||
            !('citationId' in citation) ||
            typeof citation.citationId !== 'string' ||
            seen.has(citation.citationId)
          ) {
            return false
          }
          seen.add(citation.citationId)
          return true
        }),
      }
    })()
    const parsed = anyPublicCoachResultSchema.safeParse(normalized)
    if (!parsed.success) return rejectUntrustedResult()
    const result = parsed.data
    finalResult.value = result
    if (result.responseType === 'grading') {
      submissionPending.value = false
      pendingExerciseId.value = null
    }
    provisionalText.value = ''
    error.value = null
    messages.value.push({
      id: `result-${result.traceId}`,
      role: 'COACH',
      content: null,
      structuredResult: result,
      createdAt: new Date().toISOString(),
    })
    return true
  }

  function replaceCitation(citation: PublicCoachCitationV2) {
    const replace = (
      result: AnyPublicCoachResult | null,
    ): AnyPublicCoachResult | null => {
      if (!result || result.schemaVersion !== 'coach.result.v2') return result
      return {
        ...result,
        citations: result.citations.map((current) =>
          current.citationId === citation.citationId ? citation : current,
        ),
      }
    }
    finalResult.value = replace(finalResult.value)
    messages.value = messages.value.map((message) => ({
      ...message,
      structuredResult: replace(message.structuredResult),
    }))
  }

  async function resolveCitation(
    citationId: string,
    resolver: typeof getCoachCitation = getCoachCitation,
  ) {
    try {
      const response = await resolver(citationId)
      replaceCitation(response.data)
      return response.data
    } catch {
      const unavailable = {
        citationId,
        status: 'unavailable',
        reason: 'SOURCE_UNAVAILABLE',
      } as const
      replaceCitation(unavailable)
      return unavailable
    }
  }

  async function refreshCitations(
    resolver: typeof getCoachCitation = getCoachCitation,
  ) {
    const result = finalResult.value
    if (!result || result.schemaVersion !== 'coach.result.v2') return []
    return Promise.all(
      result.citations.map((citation) =>
        resolveCitation(citation.citationId, resolver),
      ),
    )
  }

  function applyValidatedEvent(event: CoachSseEvent): boolean {
    if (processedEventIds.has(event.eventId)) return true
    if (activeRequestId.value && event.requestId !== activeRequestId.value) {
      return false
    }
    if (event.sequence <= lastEventSequence.value) return true
    processedEventIds.add(event.eventId)
    lastEventSequence.value = event.sequence
    if (event.type === 'connected') {
      serverStatusLabel.value = '已连接 Coach'
      streamState.value =
        event.payload.status === 'QUEUED' || event.payload.status === 'CREATED'
          ? 'queued'
          : event.payload.status === 'RUNNING'
            ? 'generating'
            : event.payload.status === 'COMPLETED'
              ? 'completed'
              : event.payload.status === 'CANCELLED'
                ? 'cancelled'
                : event.payload.status === 'TIMED_OUT'
                  ? 'timed_out'
                  : event.payload.status === 'BUDGET_EXCEEDED'
                    ? 'budget_exceeded'
                    : 'failed'
    } else if (event.type === 'status') {
      serverStatusLabel.value = event.payload.label
      streamState.value =
        event.payload.step === 'grading'
          ? 'grading'
          : event.payload.step === 'saving'
            ? 'saving'
            : 'generating'
    } else if (event.type === 'tool_status') {
      toolStatus.value = event.payload
      serverStatusLabel.value = event.payload.label
      streamState.value =
        event.payload.state === 'started' ? 'tool_running' : streamState.value
    } else if (event.type === 'content_delta') {
      streamState.value = 'generating'
      appendProvisional(event.payload.delta)
    } else if (event.type === 'result') {
      resultEventId = event.eventId
      return acceptResult(event.payload.result)
    } else if (event.type === 'completed') {
      if (resultEventId !== event.payload.resultEventId || !finalResult.value) {
        return rejectUntrustedResult()
      }
      provisionalText.value = ''
      streamState.value = 'completed'
      serverStatusLabel.value = 'Coach 已完成'
    } else if (event.type === 'error') {
      provisionalText.value = ''
      streamState.value =
        event.payload.code === 'REQUEST_TIMEOUT'
          ? 'timed_out'
          : event.payload.code === 'BUDGET_EXCEEDED'
            ? 'budget_exceeded'
            : 'failed'
      error.value = {
        code: event.payload.code,
        message: event.payload.message,
        retryable: event.payload.retryable,
      }
      serverStatusLabel.value = event.payload.message
    } else if (event.type === 'cancelled') {
      provisionalText.value = ''
      streamState.value = 'cancelled'
      error.value = {
        code: 'CANCELLED',
        message: event.payload.message,
        retryable: true,
      }
      serverStatusLabel.value = event.payload.message
    }
    return true
  }

  function acceptEvent(untrusted: unknown): boolean {
    const parsed = coachSseEventSchema.safeParse(untrusted)
    if (!parsed.success) return rejectUntrustedResult()
    return applyValidatedEvent(parsed.data)
  }

  function resetRequestState() {
    provisionalText.value = ''
    finalResult.value = null
    lastEventSequence.value = -1
    error.value = null
    streamState.value = 'idle'
    activeRequestId.value = null
    toolStatus.value = null
    retryRequested.value = false
    processedEventIds.clear()
    resultEventId = null
    serverStatusLabel.value = ''
  }

  function beginStream(requestId: string) {
    activeRequestId.value = requestId
    streamState.value = 'connecting'
    provisionalText.value = ''
    lastEventSequence.value = -1
    toolStatus.value = null
    retryRequested.value = false
    error.value = null
    processedEventIds.clear()
    resultEventId = null
    serverStatusLabel.value = '正在连接 Coach'
  }

  function markReplayExpired() {
    provisionalText.value = ''
    streamState.value = 'reconciling'
    retryRequested.value = false
  }

  function reconcileRequest(request: CoachRequest) {
    provisionalText.value = ''
    if (request.finalResult) acceptResult(request.finalResult)
    streamState.value =
      request.status === 'COMPLETED'
        ? 'completed'
        : request.status === 'CANCELLED'
          ? 'cancelled'
          : request.status === 'TIMED_OUT'
            ? 'timed_out'
            : request.status === 'BUDGET_EXCEEDED'
              ? 'budget_exceeded'
              : request.status === 'FAILED'
                ? 'failed'
                : request.status === 'QUEUED' || request.status === 'CREATED'
                  ? 'queued'
                  : 'generating'
    error.value = request.error
    serverStatusLabel.value =
      request.error?.message ??
      (request.status === 'COMPLETED'
        ? '已从请求记录恢复最终结果'
        : '已从请求记录恢复当前状态')
  }

  function markStreamFailure(message = '网络中断，可安全重连或重试。') {
    provisionalText.value = ''
    streamState.value = 'failed'
    error.value = { code: 'NETWORK_ERROR', message, retryable: true }
    serverStatusLabel.value = message
  }

  function markCancellationAccepted(saveStatus: string) {
    provisionalText.value = ''
    streamState.value = 'cancelled'
    serverStatusLabel.value =
      saveStatus === 'SAVED_ONCE'
        ? '请求已取消；此前完成的学习更新仍已保存一次'
        : '请求已取消，本次未保存新的学习记录'
    error.value = {
      code: 'CANCELLED',
      message: serverStatusLabel.value,
      retryable: true,
    }
  }

  function prepareExerciseSubmission(
    exerciseId: string,
    answers: Array<{ itemId: string; answer: string | string[] }>,
  ): {
    body: Extract<CreateCoachRequest, { type: 'EXERCISE_SUBMISSION' }>
    idempotencyKey: string
  } {
    const normalizedAnswers = [...answers].sort((left, right) =>
      left.itemId.localeCompare(right.itemId),
    )
    const fingerprint = JSON.stringify({ exerciseId, answers: normalizedAnswers })
    let key = submissionKeys.get(fingerprint)
    if (!key) {
      const random = globalThis.crypto.randomUUID().replaceAll('-', '')
      key = `submission-${random}`
      submissionKeys.set(fingerprint, key)
    }
    submissionPending.value = true
    pendingExerciseId.value = exerciseId
    return {
      body: {
        type: 'EXERCISE_SUBMISSION',
        exerciseId,
        answers: normalizedAnswers,
      },
      idempotencyKey: key,
    }
  }

  function failExerciseSubmission() {
    submissionPending.value = false
    pendingExerciseId.value = null
  }

  return {
    profile,
    conversations,
    activeConversationId,
    activeConversation,
    activeExercise,
    claimsByCitationId,
    messages,
    finalResult,
    provisionalText,
    lastEventSequence,
    error,
    streamState,
    activeRequestId,
    toolStatus,
    retryRequested,
    serverStatusLabel,
    submissionPending,
    pendingExerciseId,
    setProfile,
    setConversations,
    openConversation,
    appendProvisional,
    acceptResult,
    resolveCitation,
    refreshCitations,
    acceptEvent,
    resetRequestState,
    beginStream,
    markReplayExpired,
    reconcileRequest,
    markStreamFailure,
    markCancellationAccepted,
    prepareExerciseSubmission,
    failExerciseSubmission,
  }
})
