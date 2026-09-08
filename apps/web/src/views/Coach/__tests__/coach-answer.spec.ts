import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCoachStore } from '@/stores/coach'
import CoachMessage from '../components/CoachMessage.vue'
import LearnerProfileEditor from '../components/LearnerProfileEditor.vue'

const correctionResult = {
  schemaVersion: 'coach.result.v1',
  responseType: 'correction',
  correction: 'I went home yesterday.',
  explanation: 'Use went for a completed past action.',
  examples: ['She went to school.', 'We went by train.'],
  errorTypes: ['TENSE'],
  score: null,
  nextAction: 'practice',
  citations: [
    {
      sourceId: 'word:went',
      materialType: 'word',
      title: 'went',
      locator: 'dictionary/went',
      supports: 'past tense of go',
    },
  ],
  nextActionReason: 'Practice one more past-tense sentence.',
  traceId: 'trace_web_00001',
} as const

describe('Coach answer UI', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows a clear prompt when CEFR profile data is missing', () => {
    const wrapper = mount(LearnerProfileEditor, {
      props: {
        profile: {
          cefrLevel: null,
          levelSource: null,
          goalType: null,
          goalText: null,
          activeCourseId: null,
          timezone: 'Asia/Shanghai',
          updatedAt: '2026-09-02T00:00:00.000Z',
        },
      },
    })
    expect(wrapper.text()).toContain('完善英语水平')
    expect(wrapper.text()).not.toContain('默认 A1')
  })

  it('renders only the structured correction, explanation, examples, errors, and citations', () => {
    const wrapper = mount(CoachMessage, { props: { result: correctionResult } })
    expect(wrapper.text()).toContain('I went home yesterday.')
    expect(wrapper.text()).toContain('Use went for a completed past action.')
    expect(wrapper.text()).toContain('She went to school.')
    expect(wrapper.text()).toContain('TENSE')
    expect(wrapper.text()).toContain('went')
    expect(wrapper.text()).toContain('Practice one more past-tense sentence.')
    expect(wrapper.html()).not.toMatch(/reasoning|system prompt|answerKey/i)
  })

  it('rejects unknown result versions and does not persist provisional text', () => {
    const store = useCoachStore()
    store.appendProvisional('temporary content')
    expect(
      store.acceptResult({ ...correctionResult, schemaVersion: 'coach.result.v999' }),
    ).toBe(false)
    expect(store.error?.code).toBe('SCHEMA_INVALID')
    expect(store.messages).toEqual([])
    expect(store.provisionalText).toBe('')
  })

  it('rejects an event carrying another-user identity canary before rendering', () => {
    const store = useCoachStore()
    const canary = 'other-user-private-canary'
    expect(
      store.acceptEvent({
        schemaVersion: 'coach.sse.v1',
        eventId: 'event_000001',
        requestId: 'request_00001',
        sequence: 0,
        timestamp: '2026-09-02T00:00:00.000Z',
        type: 'content_delta',
        payload: { channel: 'explanation', delta: 'safe' },
        userId: canary,
      }),
    ).toBe(false)
    expect(JSON.stringify(store.$state)).not.toContain(canary)
    expect(store.provisionalText).toBe('')
  })
})
