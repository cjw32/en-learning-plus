import {
  AttemptService,
  GradingService,
  LearningDomainError,
  OwnedGradingService,
  type AttemptRepository,
  type GradingRepository,
  type StoredValidSubmission,
} from '@libs/learning';

const exercise = {
  id: 'exercise_00001',
  version: 'exercise-version-00001',
  type: 'FILL_BLANK' as const,
  citations: [],
  items: [
    {
      id: 'exercise_item_00001',
      position: 1,
      prompt: 'Yesterday I ___ home.',
      choices: null,
      answerKey: { accepted: ['went'] },
      gradingRubric: {},
      maxScore: 100,
      citations: [],
      targets: [
        {
          targetType: 'WORD' as const,
          targetKey: 'word-went',
          weight: 1,
        },
      ],
    },
  ],
};

function gradingFixture(existing: StoredValidSubmission | null = null) {
  const saved: StoredValidSubmission[] = [];
  const repository: GradingRepository = {
    async loadOwnedExercise(input) {
      return input.subjectId === 'user-a' &&
        input.gradeRequestId === 'request_grade_0001' &&
        input.exerciseId === exercise.id &&
        input.idempotencyKey === 'grade-key-000001'
        ? exercise
        : null;
    },
    async findOwnedSubmissionByKey(subjectId, key) {
      if (subjectId !== 'user-a' || key !== 'grade-key-000001') return null;
      return existing ?? saved[0] ?? null;
    },
    async saveValidSubmission(input) {
      saved.push({
        id: 'submission_00001',
        subjectId: input.subjectId,
        exerciseId: input.exercise.id,
        gradeRequestId: input.gradeRequestId,
        clientIdempotencyKey: input.idempotencyKey,
        answerVersion: input.result.answerVersion!,
        gradingHash: input.result.gradingHash!,
        status: 'GRADED_VALID',
        result: input.result,
        citations: input.exercise.citations,
      });
      return saved[0]!;
    },
  };
  return {
    saved,
    service: new OwnedGradingService(
      repository,
      new GradingService(),
      () => 'submission_00001',
    ),
  };
}

const gradeInput = {
  subjectId: 'user-a',
  gradeRequestId: 'request_grade_0001',
  exerciseId: 'exercise_00001',
  answers: [{ itemId: 'exercise_item_00001', answer: 'went' }],
  idempotencyKey: 'grade-key-000001',
};

describe('Coach grading ownership and integrity boundaries', () => {
  it('returns the same not-found error for another user/resource and writes nothing', async () => {
    const fixture = gradingFixture();
    for (const changed of [
      { ...gradeInput, subjectId: 'user-b' },
      { ...gradeInput, exerciseId: 'exercise_other1' },
      { ...gradeInput, gradeRequestId: 'request_other_001' },
    ]) {
      await expect(fixture.service.gradeOwned(changed)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
    }
    expect(fixture.saved).toHaveLength(0);
  });

  it('rejects an idempotency key whose stored answer version differs', async () => {
    const existing: StoredValidSubmission = {
      id: 'submission_00009',
      subjectId: 'user-a',
      exerciseId: exercise.id,
      gradeRequestId: 'request_grade_0009',
      clientIdempotencyKey: 'grade-key-000001',
      answerVersion: 'different-answer-version',
      gradingHash: 'b'.repeat(64),
      status: 'GRADED_VALID',
      result: {
        status: 'GRADED_VALID',
        answerVersion: 'different-answer-version',
        gradingHash: 'b'.repeat(64),
        score: 100,
        correction: '',
        explanation: 'Correct.',
        examples: [],
        errorTypes: [],
        items: [],
      },
      citations: [],
    };
    const fixture = gradingFixture(existing);
    await expect(fixture.service.gradeOwned(gradeInput)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(fixture.saved).toHaveLength(0);
  });

  it('rejects a forged grading hash before creating an attempt', async () => {
    let attempts = 0;
    const repository: AttemptRepository = {
      async transaction(operation) {
        return operation({
          async lockOwnedSubmission(subjectId) {
            return subjectId === 'user-a'
              ? {
                  id: 'submission_00001',
                  subjectId: 'user-a',
                  exerciseId: exercise.id,
                  status: 'GRADED_VALID',
                  score: 100,
                  gradingHash: 'a'.repeat(64),
                  errorTypes: [],
                  timezone: 'Asia/Shanghai',
                  targetEvidence: [
                    {
                      targetType: 'WORD',
                      targetKey: 'word-went',
                      wordId: null,
                      quality: 5,
                    },
                  ],
                }
              : null;
          },
          async findAttemptBySubmission() {
            return null;
          },
          async findItemState() {
            return null;
          },
          async createAttempt() {
            attempts += 1;
          },
          async upsertItemState() {},
          async createReviewEvent() {},
          async markSaved() {},
        });
      },
    };
    const service = new AttemptService(repository);
    await expect(
      service.save({
        subjectId: 'user-a',
        submissionId: 'submission_00001',
        gradingHash: 'f'.repeat(64),
        saveRequestId: 'request_save_0001',
        idempotencyKey: 'save-key-0000001',
      }),
    ).rejects.toBeInstanceOf(LearningDomainError);
    expect(attempts).toBe(0);
  });
});
