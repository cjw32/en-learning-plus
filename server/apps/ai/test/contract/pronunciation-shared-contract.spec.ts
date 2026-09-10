import {
  createPronunciationAssessmentSchema,
  PRONUNCIATION_CONTRACT_VERSIONS,
  pronunciationProviderResultSchema,
  pronunciationResultSchema,
  pronunciationTargetInputSchema,
} from '@en/common/pronunciation';

const validResult = {
  schemaVersion: 'pronunciation-result.v1',
  assessmentId: 'assessment_1',
  referenceText: 'Hello world',
  recognizedText: 'Hello world',
  scores: {
    overall: 91,
    accuracy: 92,
    completeness: 90,
    fluency: 89,
    prosody: null,
  },
  confidence: 0.9,
  confidenceTier: 'RELIABLE',
  words: [
    {
      sequence: 0,
      targetPosition: 0,
      word: 'Hello',
      normalizedWord: 'hello',
      startMs: 0,
      endMs: 500,
      score: 92,
      status: 'correct',
      feedback: null,
    },
  ],
  summary: 'Clear pronunciation.',
  suggestions: ['Keep the final consonant crisp.'],
  nextAction: 'continue',
  provider: 'fake',
  modelVersion: 'fake-model.v1',
  learningUpdate: { status: 'NOT_ELIGIBLE', changedItems: [] },
  audio: { available: true, expiresAt: '2026-09-11T00:00:00.000Z' },
  versions: {
    providerAdapter: 'fake-adapter.v1',
    providerApi: 'fake-api.v1',
    normalization: 'pronunciation-normalization.v1',
    alignment: 'pronunciation-alignment.v1',
    assessmentRule: 'pronunciation-assessment.v1',
    confidencePolicy: 'pronunciation-confidence.v1',
    learningMapping: 'pronunciation-quality.v1',
    scheduler: 'sm2.v1',
    budget: 'pronunciation-budget.v1',
    price: 'test-price.v1',
  },
  traceId: 'trace_1',
} as const;

const validProviderSuccess = {
  schemaVersion: 'pronunciation-provider-result.v1',
  provider: 'fake',
  modelVersion: 'fake-model.v1',
  adapterVersion: 'fake-adapter.v1',
  apiContractVersion: 'fake-api.v1',
  capabilityVersion: 'fake-capability.v1',
  providerAccepted: true,
  providerRequestId: null,
  latencyMs: 100,
  billableDurationMs: 1_000,
  cost: 0,
  currency: 'USD',
  priceVersion: 'test-price.v1',
  outcome: 'SUCCESS',
  recognizedText: 'Hello',
  recognitionConfidence: 0.95,
  scores: {
    overall: 90,
    accuracy: 90,
    completeness: 90,
    fluency: 90,
    prosody: null,
  },
  words: [
    {
      sequence: 0,
      lexicalForm: 'Hello',
      offsetMs: 0,
      durationMs: 500,
      score: 90,
      errorType: 'NONE',
    },
  ],
} as const;

describe('pronunciation shared contracts', () => {
  describe('API target inputs', () => {
    it('accepts each declared source variant', () => {
      const targets = [
        { sourceType: 'MANUAL', text: 'Hello world' },
        { sourceType: 'WORD_BOOK', wordId: 'word_1' },
        {
          sourceType: 'COURSE_WORD',
          courseId: 'course_1',
          wordId: 'word_1',
        },
        {
          sourceType: 'RAG_CITATION',
          citationId: 'citation_1',
          selection: { start: 0, end: 5 },
        },
        {
          sourceType: 'COACH_EXERCISE',
          coachRequestId: 'coach_1',
          exerciseId: 'exercise_1',
          itemId: 'item_1',
        },
      ];

      for (const target of targets) {
        expect(pronunciationTargetInputSchema.safeParse(target).success).toBe(
          true,
        );
      }
    });

    it('rejects caller identity and unknown fields at every boundary', () => {
      expect(
        createPronunciationAssessmentSchema.safeParse({
          locale: 'en-US',
          userId: 'caller-selected-user',
          target: { sourceType: 'MANUAL', text: 'Hello' },
        }).success,
      ).toBe(false);
      expect(
        createPronunciationAssessmentSchema.safeParse({
          locale: 'en-US',
          target: {
            sourceType: 'MANUAL',
            text: 'Hello',
            userId: 'caller-selected-user',
          },
        }).success,
      ).toBe(false);
    });

    it('rejects invalid citation spans and unsupported locales', () => {
      expect(
        createPronunciationAssessmentSchema.safeParse({
          locale: 'zh-CN',
          target: { sourceType: 'MANUAL', text: 'Hello' },
        }).success,
      ).toBe(false);
      expect(
        pronunciationTargetInputSchema.safeParse({
          sourceType: 'RAG_CITATION',
          citationId: 'citation_1',
          selection: { start: 5, end: 5 },
        }).success,
      ).toBe(false);
    });
  });

  describe('public results', () => {
    it('accepts a complete provider-neutral result with null prosody', () => {
      expect(pronunciationResultSchema.safeParse(validResult).success).toBe(
        true,
      );
    });

    it.each([
      [
        'missing field',
        (() => {
          const value = { ...validResult } as Record<string, unknown>;
          delete value.traceId;
          return value;
        })(),
      ],
      ['extra field', { ...validResult, providerRequestId: 'secret' }],
      [
        'out-of-range score',
        { ...validResult, scores: { ...validResult.scores, overall: 101 } },
      ],
      ['out-of-range confidence', { ...validResult, confidence: Number.NaN }],
      [
        'contradictory confidence tier',
        { ...validResult, confidence: 0.7, confidenceTier: 'RELIABLE' },
      ],
      [
        'partial timestamps',
        {
          ...validResult,
          words: [{ ...validResult.words[0], endMs: null }],
        },
      ],
      [
        'inserted target claim',
        {
          ...validResult,
          words: [
            {
              ...validResult.words[0],
              status: 'inserted',
              targetPosition: 0,
            },
          ],
        },
      ],
    ])('rejects %s', (_name, value) => {
      expect(pronunciationResultSchema.safeParse(value).success).toBe(false);
    });
  });

  describe('Provider results', () => {
    it('accepts declared success and failure outcomes', () => {
      expect(
        pronunciationProviderResultSchema.safeParse(validProviderSuccess)
          .success,
      ).toBe(true);
      expect(
        pronunciationProviderResultSchema.safeParse({
          ...validProviderSuccess,
          providerAccepted: null,
          outcome: 'TIMEOUT',
          retryable: false,
          retryAfterSeconds: null,
          recognizedText: undefined,
          recognitionConfidence: undefined,
          scores: undefined,
          words: undefined,
        }).success,
      ).toBe(false);
      const {
        recognizedText: _recognizedText,
        recognitionConfidence: _recognitionConfidence,
        scores: _scores,
        words: _words,
        ...base
      } = validProviderSuccess;
      expect(
        pronunciationProviderResultSchema.safeParse({
          ...base,
          providerAccepted: null,
          outcome: 'TIMEOUT',
          retryable: false,
          retryAfterSeconds: null,
        }).success,
      ).toBe(true);
    });

    it.each([
      [
        'missing scores',
        (() => {
          const value = { ...validProviderSuccess } as Record<string, unknown>;
          delete value.scores;
          return value;
        })(),
      ],
      ['unknown outcome', { ...validProviderSuccess, outcome: 'PARTIAL' }],
      [
        'out-of-range score',
        {
          ...validProviderSuccess,
          scores: { ...validProviderSuccess.scores, fluency: -1 },
        },
      ],
      ['raw response leakage', { ...validProviderSuccess, rawResponse: {} }],
      [
        'partial word timestamp',
        {
          ...validProviderSuccess,
          words: [{ ...validProviderSuccess.words[0], durationMs: null }],
        },
      ],
    ])('rejects %s', (_name, value) => {
      expect(pronunciationProviderResultSchema.safeParse(value).success).toBe(
        false,
      );
    });
  });

  describe('contract versions', () => {
    it('pins every schema and deterministic policy to a nonempty version', () => {
      expect(Object.isFrozen(PRONUNCIATION_CONTRACT_VERSIONS)).toBe(true);
      expect(Object.keys(PRONUNCIATION_CONTRACT_VERSIONS)).toEqual(
        expect.arrayContaining([
          'apiSchema',
          'resultSchema',
          'providerResultSchema',
          'providerAdapter',
          'providerApi',
          'providerCapability',
          'normalization',
          'alignment',
          'assessmentRule',
          'confidencePolicy',
          'learningMapping',
          'scheduler',
          'budgetSchema',
          'priceSchema',
        ]),
      );
      for (const version of Object.values(PRONUNCIATION_CONTRACT_VERSIONS)) {
        expect(version.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
