import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { CoachResult } from '@en/common/coach'
import CoachMessage from '../components/CoachMessage.vue'
import GradingResult from '../components/GradingResult.vue'
import LearningUpdate from '../components/LearningUpdate.vue'
import LearnerProfileEditor from '../components/LearnerProfileEditor.vue'

const base = {
  schemaVersion: 'coach.result.v1',
  correction: '',
  examples: [],
  errorTypes: [],
  citations: [],
  traceId: 'trace_recommendation_001',
} as const

function gradingResult(
  status: 'saved' | 'replayed' | 'not_saved' = 'saved',
): CoachResult {
  return {
    ...base,
    responseType: 'grading',
    explanation: '本次时态题需要继续巩固。',
    score: 60,
    nextAction: 'practice',
    nextActionReason: '本次练习仍有薄弱项，建议针对错误再练一次。',
    gradingItems: [
      {
        itemId: 'exercise_item_00001',
        isCorrect: false,
        score: 60,
        correction: 'went',
        explanation: 'Use the past tense.',
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
                targetType: 'ERROR_TYPE',
                targetKey: 'TENSE',
                label: '时态',
                previousState: 'REVIEW',
                nextState: 'REVIEW',
                quality: 2,
                nextReviewAt: '2026-09-03T08:00:00.000Z',
                reason: '本次质量低于 3，状态保持复习并重新安排。',
              },
            ],
            savedAt: '2026-09-02T08:00:00.000Z',
          },
  }
}

describe('Coach recommendation and learning-change UI', () => {
  it('labels the evidence-backed recommendation separately from the answer', () => {
    const result: CoachResult = {
      ...base,
      responseType: 'answer',
      explanation: 'Went is the past tense of go.',
      score: null,
      nextAction: 'review',
      nextActionReason: '当前还有 2 个到期单词，建议先完成复习。',
    }
    const wrapper = mount(CoachMessage, { props: { result } })
    expect(wrapper.text()).toContain('为什么推荐这一步')
    expect(wrapper.text()).toContain('当前还有 2 个到期单词')
    expect(wrapper.text()).toContain('复习')
  })

  it('shows missing profile signals as missing rather than inferred facts', () => {
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
    expect(wrapper.text()).not.toMatch(/推测|默认 A1/)
  })

  it('shows each target before/after state, unchanged reason and next review time', () => {
    const result = gradingResult()
    const wrapper = mount(LearningUpdate, {
      props: { update: result.learningUpdate! },
    })
    expect(wrapper.text()).toContain('时态')
    expect(wrapper.text()).toContain('REVIEW → REVIEW')
    expect(wrapper.text()).toContain('状态保持复习')
    expect(wrapper.text()).toContain('下次复习')
  })

  it('keeps the grade and recommendation but never implies an update when save failed', () => {
    const wrapper = mount(GradingResult, {
      props: { result: gradingResult('not_saved') },
    })
    expect(wrapper.text()).toContain('60')
    expect(wrapper.text()).toContain('为什么推荐这一步')
    expect(wrapper.text()).toContain('学习记录未保存')
    expect(wrapper.text()).not.toContain('学习状态已更新')
    expect(wrapper.text()).not.toContain('REVIEW → REVIEW')
  })
})
