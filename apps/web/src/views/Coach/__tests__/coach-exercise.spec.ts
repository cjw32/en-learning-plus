import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CoachComposer from '../components/CoachComposer.vue'
import ExerciseCard from '../components/ExerciseCard.vue'

const exercise = {
  id: 'exercise_00001',
  type: 'FILL_BLANK',
  cefrDifficulty: 'B1',
  instructions: 'Fill each blank.',
  personalizationReason: '一级挑战：练习你到期的过去时词汇。',
  items: [
    {
      id: 'exercise_item_00001',
      position: 1,
      prompt: 'Yesterday I ___ home.',
      choices: null,
      maxScore: 100,
      citations: [],
    },
  ],
  expiresAt: '2026-09-03T00:00:00.000Z',
} as const

describe('Coach exercise UI', () => {
  it('offers four controlled exercise types and a bounded count', async () => {
    const wrapper = mount(CoachComposer)
    expect(wrapper.text()).toContain('选择题')
    expect(wrapper.text()).toContain('填空题')
    expect(wrapper.text()).toContain('翻译题')
    expect(wrapper.text()).toContain('情境对话')
    const count = wrapper.get('[data-test="exercise-count"]')
    expect(count.attributes('min')).toBe('1')
    expect(count.attributes('max')).toBe('20')
  })

  it('renders the challenge, reason and prompts without answer material', () => {
    const wrapper = mount(ExerciseCard, { props: { exercise } })
    expect(wrapper.text()).toContain('B1')
    expect(wrapper.text()).toContain('一级挑战')
    expect(wrapper.text()).toContain('Yesterday I ___ home.')
    expect(wrapper.text()).toContain('练习你到期的过去时词汇')
    expect(wrapper.html()).not.toMatch(/answerKey|gradingRubric|accepted|exact/i)
    expect(JSON.stringify(wrapper.props())).not.toMatch(/answerKey|gradingRubric/i)
  })

  it('shows a non-submittable degraded state', () => {
    const wrapper = mount(ExerciseCard, {
      props: { exercise: null, degradedMessage: '暂时没有可靠材料，未创建练习。' },
    })
    expect(wrapper.text()).toContain('未创建练习')
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)
  })
})
