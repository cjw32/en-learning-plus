import { createCoachExecutionContext } from '@libs/shared';
import { GradeAnswerTool } from '../../src/coach/tools/grade-answer.tool';

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
});
