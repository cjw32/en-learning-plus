import { coachResultSchema } from '@en/common/coach';
import { createCoachExecutionContext } from '@libs/shared';
import { assertCoachNodeCanStart } from '../../src/coach/workflow/coach-guards';
import {
  CoachGradingWorkflow,
  type CoachGradingWorkflowDependencies,
} from '../../src/coach/workflow/coach.graph';

const context = createCoachExecutionContext(
  { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
  1_788_307_200,
);

const validGrade = {
  schemaVersion: 'coach.tool.v1' as const,
  ok: true as const,
  submissionId: 'submission_00001',
  answerVersion: 'answer-version-00001',
  gradingHash: 'a'.repeat(64),
  score: 80,
  correction: 'I went home yesterday.',
  explanation: 'Use the past tense after yesterday.',
  examples: ['She went to school yesterday.'],
  errorTypes: ['TENSE'] as const,
  items: [
    {
      itemId: 'exercise_item_00001',
      isCorrect: false,
      score: 80,
      correction: 'went',
      explanation: 'The answer needs past tense.',
      errorTypes: ['TENSE'] as const,
      targetQualities: [
        { targetType: 'WORD' as const, targetKey: 'word-went', quality: 4 },
      ],
    },
  ],
  citations: [
    {
      sourceId: 'word:went',
      materialType: 'word' as const,
      title: 'went',
      locator: 'dictionary/went',
      supports: 'past tense of go',
      accessScope: 'PUBLIC' as const,
    },
  ],
};

function fixture(overrides: Partial<CoachGradingWorkflowDependencies> = {}) {
  const order: string[] = [];
  const dependencies: CoachGradingWorkflowDependencies = {
    async classifyIntent() {
      order.push('classify_intent');
      return 'GRADE_ANSWER';
    },
    async gradeAnswer() {
      order.push('grade_answer');
      return validGrade;
    },
    async saveAttempt() {
      order.push('save_attempt');
      return {
        schemaVersion: 'coach.tool.v1',
        ok: true,
        status: 'saved',
        attemptId: 'attempt_00001',
        score: 80,
        changes: [
          {
            targetType: 'WORD',
            targetKey: 'word-went',
            label: 'went',
            previousState: 'LEARNING',
            nextState: 'REVIEW',
            quality: 4,
            nextReviewAt: '2026-09-08T00:00:00.000Z',
            reason: 'Updated with SM2_V1.',
          },
        ],
        savedAt: '2026-09-02T00:00:00.000Z',
      };
    },
    async recommend() {
      order.push('recommend');
      return {
        nextAction: 'review',
        nextActionReason: 'Review this tense after the scheduled interval.',
      };
    },
    async getRecommendationFacts() {
      return { dueCount: 1, profileSignals: [] };
    },
    authorizeTool(tool) {
      order.push(`budget:${tool}`);
    },
    onValidate() {
      order.push('validate_result');
    },
    ...overrides,
  };
  return { order, dependencies };
}

const input = {
  requestId: 'request_grading_001',
  conversationId: 'conversation-a',
  exerciseId: 'exercise_00001',
  answers: [{ itemId: 'exercise_item_00001', answer: 'go' }],
  idempotencyKey: 'grade-key-00000001',
  traceId: 'trace_grading_001',
} as const;

describe('Coach GRADE_ANSWER workflow', () => {
  it('runs owned exercise -> grade -> validate -> save -> recommend in order', async () => {
    const test = fixture();
    const result = await new CoachGradingWorkflow(test.dependencies).run(
      input,
      context,
    );
    expect(coachResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      responseType: 'grading',
      score: 80,
      gradingItems: [{ itemId: 'exercise_item_00001', score: 80 }],
      learningUpdate: { status: 'saved', attemptId: 'attempt_00001' },
    });
    expect(test.order).toEqual([
      'classify_intent',
      'budget:grade_answer',
      'grade_answer',
      'budget:save_attempt',
      'save_attempt',
      'recommend',
      'validate_result',
    ]);
  });

  it('retries an invalid grade once, then saves only the validated fact', async () => {
    const gradeAnswer = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, score: 'invalid' })
      .mockResolvedValueOnce(validGrade);
    const saveAttempt = jest.fn(async () => ({
      schemaVersion: 'coach.tool.v1',
      ok: true,
      status: 'replayed',
      attemptId: 'attempt_00001',
      score: 80,
      changes: [],
      savedAt: '2026-09-02T00:00:00.000Z',
    }));
    const test = fixture({ gradeAnswer, saveAttempt });
    const result = await new CoachGradingWorkflow(test.dependencies).run(
      input,
      context,
    );
    expect(gradeAnswer).toHaveBeenCalledTimes(2);
    expect(saveAttempt).toHaveBeenCalledTimes(1);
    expect(saveAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        gradingValidated: true,
        submissionId: validGrade.submissionId,
        gradingHash: validGrade.gradingHash,
      }),
      context,
    );
    expect(result.learningUpdate?.status).toBe('replayed');
  });

  it('degrades after the schema retry and never invokes save_attempt', async () => {
    const saveAttempt = jest.fn();
    const test = fixture({
      async gradeAnswer() {
        return { ok: true, score: 'invalid' };
      },
      saveAttempt,
    });
    const result = await new CoachGradingWorkflow(test.dependencies).run(
      input,
      context,
    );
    expect(result.responseType).toBe('degraded');
    expect(saveAttempt).not.toHaveBeenCalled();
  });

  it('does not retry a validated tool failure', async () => {
    const gradeAnswer = jest.fn(async () => ({
      schemaVersion: 'coach.tool.v1',
      ok: false,
      code: 'SCHEMA_INVALID',
      message: 'safe public failure',
      retryable: false,
    }));
    const saveAttempt = jest.fn();
    const test = fixture({ gradeAnswer, saveAttempt });

    const result = await new CoachGradingWorkflow(test.dependencies).run(
      input,
      context,
    );

    expect(result.responseType).toBe('degraded');
    expect(gradeAnswer).toHaveBeenCalledTimes(1);
    expect(saveAttempt).not.toHaveBeenCalled();
  });

  it('returns valid grading with not_saved when persistence fails', async () => {
    const test = fixture({
      async saveAttempt() {
        return {
          schemaVersion: 'coach.tool.v1',
          ok: false,
          code: 'INTERNAL_ERROR',
          message: 'not exposed',
          retryable: true,
        };
      },
    });
    const result = await new CoachGradingWorkflow(test.dependencies).run(
      input,
      context,
    );
    expect(result).toMatchObject({
      responseType: 'grading',
      score: 80,
      learningUpdate: {
        status: 'not_saved',
        attemptId: null,
        changes: [],
        savedAt: null,
      },
    });
    expect(coachResultSchema.safeParse(result).success).toBe(true);
  });

  it('forbids save-before-grade at the workflow guard', () => {
    expect(() =>
      assertCoachNodeCanStart(
        {
          requestId: 'request_grading_001',
          conversationId: 'conversation-a',
          inputType: 'EXERCISE_SUBMISSION',
          currentNode: 'grade_answer',
          intent: 'GRADE_ANSWER',
          profileLoaded: false,
          dueWordsLoaded: false,
          materialSourceIds: [],
          exerciseId: 'exercise_00001',
          submissionId: null,
          gradingValidated: false,
          attemptSaved: false,
          schemaRetryCount: 0,
          toolCallCount: 1,
          cancelled: false,
        },
        'save_attempt',
      ),
    ).toThrow('valid grade');
  });
});
