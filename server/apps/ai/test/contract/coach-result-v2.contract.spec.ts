import {
  coachResultSchema,
  publicCoachResultV2Schema,
  storedCoachResultV2Schema,
} from '@en/common/coach';

const base = {
  schemaVersion: 'coach.result.v2',
  responseType: 'answer',
  correction: '',
  explanation: 'A harbor is a sheltered place for boats.',
  examples: [],
  errorTypes: [],
  score: null,
  nextAction: 'continue',
  nextActionReason: 'Continue learning.',
  traceId: 'trace_result_v2_001',
  knowledgeStatus: 'grounded',
  groundedClaims: [
    {
      claimId: 'claim_harbor_001',
      resultPath: '/explanation',
      text: 'A harbor is a sheltered place for boats.',
      citationIds: ['cit_result_v2_000001'],
    },
  ],
} as const;

describe('coach.result.v2 contract', () => {
  it('stores only citation IDs and grounded claim bindings', () => {
    expect(
      storedCoachResultV2Schema.parse({
        ...base,
        citationIds: ['cit_result_v2_000001'],
      }),
    ).toEqual({ ...base, citationIds: ['cit_result_v2_000001'] });
    expect(
      storedCoachResultV2Schema.safeParse({
        ...base,
        citationIds: ['cit_result_v2_000001'],
        excerpt: 'must not persist',
        locator: '/must-not-persist',
      }).success,
    ).toBe(false);
  });

  it('projects active and unavailable citations as a strict union', () => {
    const parsed = publicCoachResultV2Schema.parse({
      ...base,
      citations: [
        {
          citationId: 'cit_result_v2_000001',
          status: 'active',
          source: 'synthetic-word-source',
          title: 'harbor',
          category: 'WORD_MEANING',
          excerpt: 'A harbor is a sheltered place for boats.',
          accessScope: 'PUBLIC',
          locator: { kind: 'word', id: 'word_harbor' },
        },
        {
          citationId: 'cit_result_v2_000002',
          status: 'unavailable',
          reason: 'SOURCE_UNAVAILABLE',
        },
      ],
    });
    expect(parsed.citations).toHaveLength(2);
    expect(JSON.stringify(parsed.citations[1])).not.toMatch(
      /excerpt|locator|sourceId/i,
    );
  });

  it.each([
    [
      'invalid claim path',
      {
        ...base,
        groundedClaims: [
          { ...base.groundedClaims[0], resultPath: '/internal/prompt' },
        ],
        citations: [],
      },
    ],
    [
      'duplicate citations',
      {
        ...base,
        citations: [
          {
            citationId: 'cit_result_v2_000001',
            status: 'unavailable',
            reason: 'SOURCE_UNAVAILABLE',
          },
          {
            citationId: 'cit_result_v2_000001',
            status: 'unavailable',
            reason: 'SOURCE_UNAVAILABLE',
          },
        ],
      },
    ],
  ])('rejects %s', (_name, value) => {
    expect(publicCoachResultV2Schema.safeParse(value).success).toBe(false);
  });

  it('keeps the v1 result parser compatible', () => {
    expect(
      coachResultSchema.safeParse({
        schemaVersion: 'coach.result.v1',
        responseType: 'degraded',
        correction: '',
        explanation: 'Safe fallback.',
        examples: [],
        errorTypes: [],
        score: null,
        nextAction: 'continue',
        citations: [],
        nextActionReason: 'Continue.',
        traceId: 'trace_v1_compat_001',
      }).success,
    ).toBe(true);
  });
});
