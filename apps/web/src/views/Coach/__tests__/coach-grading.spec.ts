import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CoachResult } from '@en/common/coach'
import { useCoachStore } from '@/stores/coach'
import GradingResult from '../components/GradingResult.vue'
import LearningUpdate from '../components/LearningUpdate.vue'

function gradingResult(
  status: 'saved' | 'replayed' | 'not_saved' = 'saved',
): CoachResult {
  return {
    schemaVersion: 'coach.result.v1',
    responseType: 'grading',
    correction: 'I went home yesterday.',
    explanation: 'Yesterday requires the past tense.',
    examples: ['She went to school yesterday.'],
    errorTypes: ['TENSE'],
    score: 80,
    nextAction: 'review',
    citations: [],
    nextActionReason: 'Review the past tense tomorrow.',
    traceId: 'trace_grading_ui_01',
    gradingItems: [
      {
        itemId: 'exercise_item_00001',
        isCorrect: false,
        score: 80,
        correction: 'went',
        explanation: 'Use the past form of go.',
        errorTypes: ['TENSE'],
      },
    ],
    learningUpdate:
      status === 'not_saved'
        ? { status, attemptId: null, changes: [], savedAt: null }
        : {
            status,
            attemptId: 'attempt_00001',
            changes: [
              {
                targetType: 'WORD',
                targetKey: 'word-went',
                label: 'went',
                previousState: 'LEARNING',
                nextState: 'REVIEW',
                quality: 4,
                nextReviewAt: '2026-09-08T00:00:00.000Z',
                reason: '根据本次表现更新复习时间。',
              },
            ],
            savedAt: '2026-09-02T00:00:00.000Z',
          },
  }
}

describe('Coach grading UI', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders total score, item correction, error type and examples', () => {
    const wrapper = mount(GradingResult, {
      props: { result: gradingResult() },
    })
    expect(wrapper.text()).toContain('80')
    expect(wrapper.text()).toContain('went')
    expect(wrapper.text()).toContain('Use the past form of go.')
    expect(wrapper.text()).toContain('TENSE')
    expect(wrapper.text()).toContain('She went to school yesterday.')
  })

  it.each([
    ['saved', '学习状态已更新'],
    ['replayed', '此前已保存'],
    ['not_saved', '学习记录未保存'],
  ] as const)('renders %s reconciliation truth', (status, label) => {
    const result = gradingResult(status)
    const wrapper = mount(LearningUpdate, {
      props: { update: result.learningUpdate! },
    })
    expect(wrapper.text()).toContain(label)
    if (status === 'not_saved') {
      expect(wrapper.text()).not.toContain('LEARNING → REVIEW')
    } else {
      expect(wrapper.text()).toContain('LEARNING → REVIEW')
      expect(wrapper.text()).toContain('went')
    }
  })

  it('keeps a valid grade visible when saving failed', () => {
    const wrapper = mount(GradingResult, {
      props: { result: gradingResult('not_saved') },
    })
    expect(wrapper.text()).toContain('80')
    expect(wrapper.text()).toContain('学习记录未保存')
    expect(wrapper.text()).toContain('批改结果仍可查看')
  })

  it('reuses one idempotency key for duplicate answer submissions', () => {
    const store = useCoachStore()
    const answers = [{ itemId: 'exercise_item_00001', answer: 'went' }]
    const first = store.prepareExerciseSubmission('exercise_00001', answers)
    const duplicate = store.prepareExerciseSubmission('exercise_00001', answers)
    const changed = store.prepareExerciseSubmission('exercise_00001', [
      { itemId: 'exercise_item_00001', answer: 'go' },
    ])
    expect(duplicate.idempotencyKey).toBe(first.idempotencyKey)
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey)
    expect(first.body).toEqual({
      type: 'EXERCISE_SUBMISSION',
      exerciseId: 'exercise_00001',
      answers,
    })
    expect(first.body).not.toHaveProperty('userId')
  })
})
