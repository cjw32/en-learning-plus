import { createCoachExecutionContext } from '@libs/shared';
import type { OwnedGradingService } from '@libs/learning';
import { z } from '@en/common/coach/zod';
import { GradeAnswerTool } from '../../src/coach/tools/grade-answer.tool';

type GradeOwnedInput = Parameters<OwnedGradingService['gradeOwned']>[0];

const context = createCoachExecutionContext(
  { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
  1_788_307_200,
);

describe('GradeAnswerTool', () => {
  it('derives ownership from context and returns a validated grade without saving progress', async () => {
    const gradeOwned = jest.fn(async () => ({
      status: 'GRADED_VALID',
      submissionId: 'submission_00001',
      answerVersion: 'a'.repeat(64),
      gradingHash: 'b'.repeat(64),
      score: 100,
      correction: '',
      explanation: 'Correct.',
      examples: ['I went home.'],
      errorTypes: [],
      items: [
        {
          itemId: 'exercise_item_00001',
          isCorrect: true,
          score: 100,
          correction: '',
          explanation: 'Correct.',
          errorTypes: [],
          targetQualities: [
            { targetType: 'WORD', targetKey: 'word-1', quality: 5 },
          ],
        },
      ],
      citations: [],
    }));
    const tool = new GradeAnswerTool({ gradeOwned } as never);
    const output = await tool.execute(
      context,
      { requestId: 'request_grade_0001' },
      {
        schemaVersion: 'coach.tool.v1',
        exerciseId: 'exercise_00001',
        answers: [{ itemId: 'exercise_item_00001', answer: 'went' }],
        idempotencyKey: 'grade-key-000001',
      },
    );
    expect(output).toMatchObject({ ok: true, score: 100 });
    expect(gradeOwned).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 'user-a' }),
    );
    expect(JSON.stringify(output)).not.toContain('answerKey');
  });

  it('rejects input identity before business access', async () => {
    const grading = { gradeOwned: jest.fn() };
    const output = await new GradeAnswerTool(grading as never).execute(
      context,
      { requestId: 'request_grade_0002' },
      {
        schemaVersion: 'coach.tool.v1',
        exerciseId: 'exercise_00001',
        answers: [{ itemId: 'exercise_item_00001', answer: 'went' }],
        idempotencyKey: 'grade-key-000002',
        userId: 'user-b',
      },
    );
    expect(output).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(grading.gradeOwned).not.toHaveBeenCalled();
  });

  it('uses the governed model adapter for subjective exercises', async () => {
    const model = {
      gradeSubjective: jest.fn(async () => ({
        scoreRatio: 0.8,
        isCorrect: false,
        correction: 'I went home yesterday.',
        explanation: 'Use the past tense after yesterday.',
        errorTypes: ['TENSE'],
        examples: ['She went home yesterday.'],
      })),
    };
    const gradeOwned = jest.fn(async (input: GradeOwnedInput) => {
      await input.subjective!.evaluate({
        exerciseType: 'TRANSLATION',
        prompt: 'Translate this sentence.',
        answer: 'I go home yesterday.',
        referenceAnswer: 'I went home yesterday.',
        controlledRubric: { tense: 'past' },
        maxScore: 100,
      });
      return {
        status: 'GRADED_VALID',
        submissionId: 'submission_00002',
        answerVersion: 'c'.repeat(64),
        gradingHash: 'd'.repeat(64),
        score: 80,
        correction: 'I went home yesterday.',
        explanation: 'Use the past tense after yesterday.',
        examples: ['She went home yesterday.'],
        errorTypes: ['TENSE'],
        items: [
          {
            itemId: 'exercise_item_00002',
            isCorrect: false,
            score: 80,
            correction: 'I went home yesterday.',
            explanation: 'Use the past tense after yesterday.',
            errorTypes: ['TENSE'],
            targetQualities: [
              { targetType: 'ERROR_TYPE', targetKey: 'TENSE', quality: 4 },
            ],
          },
        ],
        citations: [],
      };
    });
    const beforeModelCall = jest.fn();
    const onFirstOutput = jest.fn();
    const onUsage = jest.fn();
    const controller = new AbortController();
    const tool = new GradeAnswerTool({ gradeOwned } as never, model);

    await expect(
      tool.execute(
        context,
        {
          requestId: 'request_grade_0003',
          signal: controller.signal,
          beforeModelCall,
          modelTelemetry: { onFirstOutput, onUsage },
        },
        {
          schemaVersion: 'coach.tool.v1',
          exerciseId: 'exercise_00002',
          answers: [
            {
              itemId: 'exercise_item_00002',
              answer: 'I go home yesterday.',
            },
          ],
          idempotencyKey: 'grade-key-000003',
        },
      ),
    ).resolves.toMatchObject({ ok: true, score: 80, errorTypes: ['TENSE'] });
    expect(beforeModelCall).toHaveBeenCalledTimes(1);
    expect(model.gradeSubjective).toHaveBeenCalledWith(
      expect.objectContaining({ maxScore: 100 }),
      controller.signal,
      { onFirstOutput, onUsage },
    );
  });

  it('retries invalid subjective model output once and never persists it', async () => {
    const model = {
      gradeSubjective: jest.fn(async () => {
        throw new z.ZodError([]);
      }),
    };
    const gradeOwned = jest.fn(async (input: GradeOwnedInput) => {
      await input.subjective!.evaluate({
        exerciseType: 'SITUATIONAL_DIALOGUE',
        prompt: 'Reply to the hotel clerk.',
        answer: 'Room please.',
        referenceAnswer: 'I would like a room, please.',
        controlledRubric: { politeness: true },
        maxScore: 100,
      });
      throw new Error('unreachable');
    });
    const onSchemaFailure = jest.fn();
    const onRetry = jest.fn();
    const output = await new GradeAnswerTool(
      { gradeOwned } as never,
      model,
    ).execute(
      context,
      {
        requestId: 'request_grade_0004',
        onSchemaFailure,
        onRetry,
      },
      {
        schemaVersion: 'coach.tool.v1',
        exerciseId: 'exercise_00003',
        answers: [{ itemId: 'exercise_item_00003', answer: 'Room please.' }],
        idempotencyKey: 'grade-key-000004',
      },
    );

    expect(output).toMatchObject({ ok: false, code: 'SCHEMA_INVALID' });
    expect(model.gradeSubjective).toHaveBeenCalledTimes(2);
    expect(onSchemaFailure).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
