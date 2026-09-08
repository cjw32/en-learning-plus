import {
  buildCoachContractArtifacts,
  coachContractRuntimeSchemas,
  readCoachContractArtifact,
  serializeCoachContractArtifact,
} from '@en/common/coach/generate-contracts';

describe('generated Coach contract artifacts', () => {
  it('is deterministic and matches committed JSON artifacts', () => {
    const first = buildCoachContractArtifacts();
    const second = buildCoachContractArtifacts();
    expect(serializeCoachContractArtifact(first)).toBe(
      serializeCoachContractArtifact(second),
    );
    for (const [name, artifact] of Object.entries(first)) {
      expect(readCoachContractArtifact(name as keyof typeof first)).toEqual(
        artifact,
      );
    }
  });

  it('accepts representative Plan contract values at runtime', () => {
    expect(
      coachContractRuntimeSchemas.result.safeParse({
        schemaVersion: 'coach.result.v1',
        responseType: 'answer',
        correction: '',
        explanation: 'Went is the past tense of go.',
        examples: ['I went home yesterday.'],
        errorTypes: [],
        score: null,
        nextAction: 'continue',
        citations: [],
        nextActionReason: 'Continue with another example.',
        traceId: 'trace_artifact_01',
      }).success,
    ).toBe(true);

    const inputs = {
      get_learner_profile: {
        schemaVersion: 'coach.tool.v1',
        dimensions: ['LEVEL'],
        perDimensionLimit: 10,
      },
      get_due_words: {
        schemaVersion: 'coach.tool.v1',
        learningDate: '2026-09-02',
        timezone: 'Asia/Shanghai',
        limit: 20,
      },
      search_learning_materials: {
        schemaVersion: 'coach.tool.v1',
        query: 'past tense',
        materialTypes: ['word'],
        limit: 5,
      },
      create_exercise: {
        schemaVersion: 'coach.tool.v1',
        types: ['FILL_BLANK'],
        count: 1,
        difficulty: 'A2',
        targetRefs: [{ targetType: 'WORD', targetKey: 'word_000001' }],
        materialSourceIds: ['word_000001'],
        idempotencyKey: 'exercise-key-0001',
      },
      grade_answer: {
        schemaVersion: 'coach.tool.v1',
        exerciseId: 'exercise_000001',
        answers: [{ itemId: 'item_1', answer: 'went' }],
        idempotencyKey: 'grading-key-00001',
      },
      save_attempt: {
        schemaVersion: 'coach.tool.v1',
        submissionId: 'submission_0001',
        gradingHash: 'a'.repeat(64),
        idempotencyKey: 'save-key-0000001',
      },
    } as const;

    for (const [name, input] of Object.entries(inputs)) {
      expect(
        coachContractRuntimeSchemas.tools[
          name as keyof typeof coachContractRuntimeSchemas.tools
        ].input.safeParse(input).success,
      ).toBe(true);
    }
  });
});
