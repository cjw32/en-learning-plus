import { coachResultSchema } from '@en/common/coach';
import { assembleLearningUpdate } from '../../src/coach/workflow/coach-result.assembler';
import {
  upgradeCoachResultToV2,
  validateFinalResult,
} from '../../src/coach/workflow/final-result.validator';

const saveResult = {
  schemaVersion: 'coach.tool.v1' as const,
  ok: true as const,
  status: 'saved' as const,
  attemptId: 'attempt_00001',
  score: 80,
  changes: [
    {
      targetType: 'WORD' as const,
      targetKey: 'word-went',
      label: 'went',
      previousState: 'LEARNING' as const,
      nextState: 'REVIEW' as const,
      quality: 4,
      nextReviewAt: '2026-09-08T00:00:00.000Z',
      reason: '根据本次表现更新 SM2_V1 复习间隔。',
    },
  ],
  savedAt: '2026-09-02T00:00:00.000Z',
};

const candidate = {
  schemaVersion: 'coach.result.v1' as const,
  responseType: 'grading' as const,
  correction: 'went',
  explanation: 'Use past tense.',
  examples: [],
  errorTypes: ['TENSE'] as const,
  score: 80,
  nextAction: 'review' as const,
  citations: [],
  nextActionReason: '当前还有到期内容，建议按复习计划先完成复习。',
  traceId: 'trace_result_assembler_001',
  gradingItems: [
    {
      itemId: 'exercise_item_00001',
      isCorrect: false,
      score: 80,
      correction: 'went',
      explanation: 'Use past tense.',
      errorTypes: ['TENSE'] as const,
    },
  ],
  learningUpdate: {
    status: 'saved' as const,
    attemptId: saveResult.attemptId,
    changes: saveResult.changes,
    savedAt: saveResult.savedAt,
  },
};

describe('Coach final-result transaction reconciliation', () => {
  it('projects every learning change from a validated save result', () => {
    expect(assembleLearningUpdate(saveResult)).toEqual(
      candidate.learningUpdate,
    );
  });

  it('returns an explicit empty not_saved projection for a failed or invalid save', () => {
    expect(
      assembleLearningUpdate({
        schemaVersion: 'coach.tool.v1',
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'provider stack must not escape',
        retryable: true,
        changes: saveResult.changes,
      }),
    ).toEqual({
      status: 'not_saved',
      attemptId: null,
      changes: [],
      savedAt: null,
    });
  });

  it('accepts a final result only when it matches the save transaction facts', () => {
    expect(
      validateFinalResult(candidate, { saveAttemptResult: saveResult }),
    ).toEqual(coachResultSchema.parse(candidate));
    expect(
      validateFinalResult(
        {
          ...candidate,
          learningUpdate: {
            ...candidate.learningUpdate,
            changes: [
              {
                ...saveResult.changes[0],
                nextState: 'MASTERED',
                reason: 'Invented by model.',
              },
            ],
          },
        },
        { saveAttemptResult: saveResult },
      ),
    ).toBeUndefined();
  });

  it('rejects not_saved results that imply an attempt or a learning change', () => {
    expect(
      coachResultSchema.safeParse({
        ...candidate,
        learningUpdate: {
          status: 'not_saved',
          attemptId: 'attempt_fabricated',
          changes: saveResult.changes,
          savedAt: null,
        },
      }).success,
    ).toBe(false);
  });

  it('upgrades non-knowledge branches to citation-free v2 when RAG is enabled', () => {
    expect(
      upgradeCoachResultToV2(coachResultSchema.parse(candidate)),
    ).toMatchObject({
      schemaVersion: 'coach.result.v2',
      responseType: 'grading',
      knowledgeStatus: 'not_applicable',
      groundedClaims: [],
      citations: [],
      learningUpdate: candidate.learningUpdate,
    });
  });
});
