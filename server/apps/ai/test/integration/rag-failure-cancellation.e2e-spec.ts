import { CoachExecutionContext } from '@libs/shared';
import {
  CoachCancellationService,
  type CoachCancellationRepository,
  type CoachCancellationSignalStore,
} from '../../src/coach/governance/coach-cancellation.service';

const now = new Date('2026-09-08T12:00:00.000Z');

function fixture(
  guardState: {
    requestStatus: 'RUNNING' | 'CANCELLED';
    accountStatus: 'ACTIVE' | 'DELETING';
    accessStillAllowed: boolean;
  } = {
    requestStatus: 'RUNNING',
    accountStatus: 'ACTIVE',
    accessStillAllowed: true,
  },
) {
  let cancelled = false;
  const repository: CoachCancellationRepository = {
    async findOwned(subjectId, requestId) {
      return subjectId === 'synthetic_a' && requestId === 'request_late_001'
        ? {
            id: requestId,
            status: guardState.requestStatus,
            attemptSaved: false,
          }
        : null;
    },
    async markCancellationRequested() {},
    async findKnowledgeConsumptionState(subjectId, requestId) {
      return subjectId === 'synthetic_a' && requestId === 'request_late_001'
        ? guardState
        : null;
    },
  };
  const signals: CoachCancellationSignalStore = {
    async set() {
      cancelled = true;
    },
    async has() {
      return cancelled;
    },
  };
  return {
    service: new CoachCancellationService(repository, signals, () => now),
    cancel: () => {
      cancelled = true;
    },
  };
}

describe('RAG late-result cancellation boundary', () => {
  it('accepts a current result only for the same active subject and request', async () => {
    const { service } = fixture();
    await expect(
      service.assertCanConsumeKnowledgeResult(
        new CoachExecutionContext(
          'synthetic_a',
          Math.floor(now.getTime() / 1000) + 60,
        ),
        'request_late_001',
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['expired JWT', 'TOKEN_INVALID'],
    ['cancelled signal', 'CANCELLED'],
    ['cancelled request', 'CANCELLED'],
    ['deleting account', 'STATE_CONFLICT'],
    ['revoked access', 'FORBIDDEN'],
  ] as const)(
    'drops a late result after %s before Prompt, Trace, replay or write',
    async (reason, code) => {
      const state = {
        requestStatus: (reason === 'cancelled request'
          ? 'CANCELLED'
          : 'RUNNING') as 'RUNNING' | 'CANCELLED',
        accountStatus: (reason === 'deleting account'
          ? 'DELETING'
          : 'ACTIVE') as 'ACTIVE' | 'DELETING',
        accessStillAllowed: reason !== 'revoked access',
      };
      const { service, cancel } = fixture(state);
      if (reason === 'cancelled signal') cancel();
      const context = new CoachExecutionContext(
        'synthetic_a',
        Math.floor(now.getTime() / 1000) + (reason === 'expired JWT' ? -1 : 60),
      );
      const prompt = jest.fn();
      const trace = jest.fn();
      const replay = jest.fn();
      const learningWrite = jest.fn();

      await expect(
        service.assertCanConsumeKnowledgeResult(
          context,
          'request_late_001',
          service.abortSignalFor('request_late_001'),
        ),
      ).rejects.toMatchObject({ code });
      expect(prompt).not.toHaveBeenCalled();
      expect(trace).not.toHaveBeenCalled();
      expect(replay).not.toHaveBeenCalled();
      expect(learningWrite).not.toHaveBeenCalled();
    },
  );
});
