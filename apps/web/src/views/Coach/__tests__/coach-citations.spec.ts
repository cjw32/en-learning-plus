import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CitationCard from '../components/CitationCard.vue'
import CoachMessage from '../components/CoachMessage.vue'

const activeCitation = {
  citationId: 'cit_web_harbor_000001',
  status: 'active',
  source: 'synthetic-word-source',
  title: 'harbor',
  category: 'WORD_MEANING',
  excerpt: 'A harbor is a sheltered place for boats.',
  accessScope: 'PUBLIC',
  locator: { kind: 'word', id: 'word_harbor' },
} as const

const result = {
  schemaVersion: 'coach.result.v2',
  responseType: 'answer',
  correction: '',
  explanation: 'A harbor is a sheltered place for boats.',
  examples: [],
  errorTypes: [],
  score: null,
  nextAction: 'continue',
  citations: [
    activeCitation,
    {
      citationId: 'cit_web_unavailable_000001',
      status: 'unavailable',
      reason: 'SOURCE_UNAVAILABLE',
    },
  ],
  groundedClaims: [
    {
      claimId: 'claim_web_harbor_000001',
      resultPath: '/explanation',
      text: 'A harbor is a sheltered place for boats.',
      citationIds: ['cit_web_harbor_000001'],
    },
    {
      claimId: 'claim_web_harbor_000002',
      resultPath: '/correction',
      text: 'Harbor is the requested spelling.',
      citationIds: ['cit_web_harbor_000001'],
    },
  ],
  knowledgeStatus: 'grounded',
  nextActionReason: 'Continue learning.',
  traceId: 'trace_web_citation_000001',
} as const

describe('Coach v2 citation UI', () => {
  it('deduplicates cards while retaining all associated claims', () => {
    const wrapper = mount(CoachMessage, { props: { result } })
    expect(wrapper.findAll('[data-citation-id="cit_web_harbor_000001"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('A harbor is a sheltered place for boats.')
    expect(wrapper.text()).toContain('Harbor is the requested spelling.')
  })

  it('renders a private citation with a minimal learner-facing label', () => {
    const wrapper = mount(CitationCard, {
      props: {
        citation: {
          ...activeCitation,
          citationId: 'cit_web_private_000001',
          source: 'private-learning-summary',
          title: 'Your learning summary',
          category: 'LEARNING_SUMMARY',
          excerpt: 'You often confuse port and harbor.',
          accessScope: 'PRIVATE_OWNER',
          locator: null,
        },
        claims: [],
      },
    })
    expect(wrapper.text()).toContain('你的学习记录')
    expect(wrapper.text()).toContain('You often confuse port and harbor.')
    expect(wrapper.text()).not.toContain('private-learning-summary')
    expect(wrapper.html()).not.toMatch(/userId|sourceId|chunkId|documentId/i)
  })

  it('uses one generic unavailable state without stale evidence', () => {
    const wrapper = mount(CitationCard, {
      props: {
        citation: {
          citationId: 'cit_web_unavailable_000001',
          status: 'unavailable',
          reason: 'SOURCE_UNAVAILABLE',
        },
        claims: [],
      },
    })
    expect(wrapper.text()).toContain('来源当前不可用')
    expect(wrapper.text()).not.toMatch(/harbor|撤权|删除|不存在/i)
    expect(wrapper.html()).not.toMatch(/excerpt|locator|sourceId/i)
  })

  it('emits only a controlled locator and never renders an arbitrary link', async () => {
    const wrapper = mount(CitationCard, {
      props: { citation: activeCitation, claims: [] },
    })
    expect(wrapper.find('a').exists()).toBe(false)
    await wrapper.get('button[data-open-citation]').trigger('click')
    expect(wrapper.emitted('open')).toEqual([
      [{ kind: 'word', id: 'word_harbor' }],
    ])
  })
});
