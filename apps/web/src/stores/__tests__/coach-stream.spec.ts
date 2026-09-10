import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCoachStore } from '@/stores/coach'

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  eventId = `event_${sequence}`,
) {
  return {
    schemaVersion: 'coach.sse.v1',
    eventId,
    requestId: 'request_00001',
    sequence,
    timestamp: '2026-09-02T00:00:00.000Z',
    type,
    payload,
  }
}

describe('Coach stream reducer', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('maps connected/status/tool/result/completed into explicit UI states', () => {
    const store = useCoachStore()
    store.beginStream('request_00001')
    expect(store.streamState).toBe('connecting')
    expect(
      store.acceptEvent(
        event(0, 'connected', { status: 'QUEUED', replayedThrough: null }),
      ),
    ).toBe(true)
    expect(store.streamState).toBe('queued')
    store.acceptEvent(
      event(1, 'status', { step: 'grading', label: '正在批改答案' }),
    )
    expect(store.streamState).toBe('grading')
    store.acceptEvent(
      event(2, 'tool_status', {
        tool: 'grade_answer',
        state: 'started',
        label: '答案批改正在处理',
        retryable: null,
      }),
    )
    expect(store.streamState).toBe('tool_running')
    expect(store.toolStatus).toMatchObject({
      tool: 'grade_answer',
      state: 'started',
    })

    const result = {
      schemaVersion: 'coach.result.v1',
      responseType: 'answer',
      correction: '',
      explanation: 'A safe answer.',
      examples: [],
      errorTypes: [],
      score: null,
      nextAction: 'continue',
      citations: [],
      nextActionReason: 'Continue.',
      traceId: 'trace_stream_0001',
    }
    store.acceptEvent(event(3, 'result', { result }))
    expect(store.finalResult?.explanation).toBe('A safe answer.')
    expect(store.streamState).not.toBe('completed')
    store.acceptEvent(
      event(4, 'completed', {
        status: 'COMPLETED',
        resultEventId: 'event_3',
        learningSaveStatus: 'not_applicable',
      }),
    )
    expect(store.streamState).toBe('completed')
  })

  it('deduplicates by eventId and never appends a delta twice', () => {
    const store = useCoachStore()
    store.beginStream('request_00001')
    const first = event(
      0,
      'content_delta',
      { channel: 'explanation', delta: 'Hello' },
      'same-event',
    )
    expect(store.acceptEvent(first)).toBe(true)
    expect(store.acceptEvent({ ...first, sequence: 1 })).toBe(true)
    expect(store.provisionalText).toBe('Hello')
  })

  it.each([
    [
      'cancelled',
      { status: 'CANCELLED', saveStatus: 'NOT_STARTED', message: '已取消' },
      'cancelled',
    ],
    [
      'error',
      {
        code: 'REQUEST_TIMEOUT',
        message: '请求超时',
        retryable: true,
        retryAfterSeconds: null,
        saveStatus: 'NOT_STARTED',
      },
      'timed_out',
    ],
    [
      'error',
      {
        code: 'BUDGET_EXCEEDED',
        message: '已达到预算',
        retryable: false,
        retryAfterSeconds: null,
        saveStatus: 'NOT_STARTED',
      },
      'budget_exceeded',
    ],
  ] as const)('maps %s into %s terminal state', (type, payload, expected) => {
    const store = useCoachStore()
    store.beginStream('request_00001')
    store.acceptEvent(event(0, type, payload))
    expect(store.streamState).toBe(expected)
    expect(store.provisionalText).toBe('')
  })

  it('marks replay expiry for durable fallback without creating a retry', () => {
    const store = useCoachStore()
    store.beginStream('request_00001')
    store.markReplayExpired()
    expect(store.streamState).toBe('reconciling')
    expect(store.retryRequested).toBe(false)
  })

  it('deduplicates v2 cards while preserving claim links and distinct sources', () => {
    const store = useCoachStore()
    const first = {
      citationId: 'cit_store_first_000001',
      status: 'active',
      source: 'source-a',
      title: 'Source A',
      category: 'WORD_MEANING',
      excerpt: 'Fact A.',
      accessScope: 'PUBLIC',
      locator: null,
    } as const
    expect(
      store.acceptResult({
        schemaVersion: 'coach.result.v2',
        responseType: 'answer',
        correction: '',
        explanation: 'Fact A and Fact B.',
        examples: [],
        errorTypes: [],
        score: null,
        nextAction: 'continue',
        nextActionReason: 'Continue.',
        traceId: 'trace_store_v2_000001',
        knowledgeStatus: 'grounded',
        citations: [
          first,
          first,
          {
            ...first,
            citationId: 'cit_store_second_000001',
            source: 'source-b',
            title: 'Source B',
            excerpt: 'Fact B.',
          },
        ],
        groundedClaims: [
          {
            claimId: 'claim_store_v2_000001',
            resultPath: '/explanation',
            text: 'Fact A.',
            citationIds: ['cit_store_first_000001'],
          },
          {
            claimId: 'claim_store_v2_000002',
            resultPath: '/explanation',
            text: 'Fact B.',
            citationIds: [
              'cit_store_first_000001',
              'cit_store_second_000001',
            ],
          },
        ],
      }),
    ).toBe(true)
    expect(store.finalResult?.citations).toHaveLength(2)
    expect(store.claimsByCitationId.get('cit_store_first_000001')).toHaveLength(2)
    expect(store.claimsByCitationId.get('cit_store_second_000001')).toHaveLength(1)
  })

  it('lazily refreshes a citation into a generic unavailable state', async () => {
    const store = useCoachStore()
    store.acceptResult({
      schemaVersion: 'coach.result.v2',
      responseType: 'answer',
      correction: '',
      explanation: 'Historical fact.',
      examples: [],
      errorTypes: [],
      score: null,
      nextAction: 'continue',
      nextActionReason: 'Continue.',
      traceId: 'trace_store_refresh_000001',
      knowledgeStatus: 'grounded',
      citations: [
        {
          citationId: 'cit_store_refresh_000001',
          status: 'active',
          source: 'stale-source',
          title: 'Stale source',
          category: 'WORD_MEANING',
          excerpt: 'STALE_WEB_EXCERPT_CANARY',
          accessScope: 'PUBLIC',
          locator: null,
        },
      ],
      groundedClaims: [
        {
          claimId: 'claim_store_refresh_000001',
          resultPath: '/explanation',
          text: 'Historical fact.',
          citationIds: ['cit_store_refresh_000001'],
        },
      ],
    })
    const resolver = vi.fn(async () => ({
      code: 0,
      message: 'Success',
      data: {
        citationId: 'cit_store_refresh_000001',
        status: 'unavailable' as const,
        reason: 'SOURCE_UNAVAILABLE' as const,
      },
    }))
    await store.refreshCitations(resolver)
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(store.finalResult)).not.toContain(
      'STALE_WEB_EXCERPT_CANARY',
    )
    expect(store.finalResult?.citations).toEqual([
      {
        citationId: 'cit_store_refresh_000001',
        status: 'unavailable',
        reason: 'SOURCE_UNAVAILABLE',
      },
    ])
  })
})
