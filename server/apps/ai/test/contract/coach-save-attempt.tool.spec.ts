import { createCoachExecutionContext } from '@libs/shared';
import { SaveAttemptTool } from '../../src/coach/tools/save-attempt.tool';

const context = createCoachExecutionContext(
  { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
  1_788_307_200,
);

const input = {
  schemaVersion: 'coach.tool.v1',
  submissionId: 'submission_00001',
  gradingHash: 'a'.repeat(64),
  idempotencyKey: 'save-key-0000001',
} as const;

describe('SaveAttemptTool', () => {
  it('requires the exact validated grading fact before the only write', async () => {
    const attempts = {
      save: jest.fn(async () => ({
        status: 'saved',
        attemptId: 'attempt_00001',
        score: 80,
        changes: [],
        savedAt: new Date('2026-09-02T00:00:00.000Z'),
      })),
    };
    const tool = new SaveAttemptTool(attempts as never);
    expect(
      await tool.execute(
        context,
        {
          requestId: 'request_save_0001',
          gradingValidated: false,
          submissionId: 'submission_00001',
          gradingHash: 'a'.repeat(64),
        },
        input,
      ),
    ).toMatchObject({ ok: false, code: 'STATE_CONFLICT' });
    expect(attempts.save).not.toHaveBeenCalled();

    expect(
      await tool.execute(
        context,
        {
          requestId: 'request_save_0001',
          gradingValidated: true,
          submissionId: 'submission_00001',
          gradingHash: 'a'.repeat(64),
        },
        input,
      ),
    ).toMatchObject({ ok: true, status: 'saved' });
    expect(attempts.save).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 'user-a' }),
    );
    expect(attempts.save.mock.calls[0][0]).not.toHaveProperty('score');
  });
});
