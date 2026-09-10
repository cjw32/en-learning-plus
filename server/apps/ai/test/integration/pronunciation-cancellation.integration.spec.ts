import type { PronunciationAssessmentStatus } from '@en/common/pronunciation';
import {
  InMemoryPronunciationCancellationSignalStore,
  PronunciationCancellationError,
  PronunciationCancellationService,
  type PronunciationCancellationRepository,
  type PronunciationCancellationState,
} from '../../src/pronunciation/governance/pronunciation-cancellation.service';

class MemoryRepository implements PronunciationCancellationRepository {
  state: PronunciationCancellationState | null;
  mutations = 0;

  constructor(
    status: PronunciationAssessmentStatus,
    providerAccepted: boolean | null = null,
  ) {
    this.state = {
      id: 'assessment-1',
      status,
      cancelRequestedAt: null,
      providerAccepted,
      learningSaved: status === 'COMPLETED',
    };
  }

  async findOwned(subjectId: string, assessmentId: string) {
    return subjectId === 'user-1' && assessmentId === 'assessment-1'
      ? this.state
      : null;
  }

  async markCancellationRequested(input: { requestedAt: Date }) {
    if (
      !this.state ||
      ![
        'CREATED',
        'AUDIO_VALIDATING',
        'AUDIO_READY',
        'QUEUED',
        'PROCESSING',
      ].includes(this.state.status)
    ) {
      return false;
    }
    this.mutations += 1;
    this.state = {
      ...this.state,
      status: 'CANCELLED',
      cancelRequestedAt: input.requestedAt,
    };
    return true;
  }
}

const idempotencyKey = 'cancel-key-00000001';

describe('pronunciation cancellation', () => {
  it.each(['CREATED', 'QUEUED'] as const)(
    'durably cancels before or after queue (%s)',
    async (status) => {
      const repository = new MemoryRepository(status);
      const signals = new InMemoryPronunciationCancellationSignalStore();
      const service = new PronunciationCancellationService(repository, signals);
      const signal = service.abortSignalFor('assessment-1');

      await expect(
        service.cancel({
          subjectId: 'user-1',
          assessmentId: 'assessment-1',
          idempotencyKey,
        }),
      ).resolves.toMatchObject({ status: 'CANCELLED', mayBeBillable: false });
      expect(repository.state?.cancelRequestedAt).toBeInstanceOf(Date);
      expect(signal.aborted).toBe(true);
      await expect(service.observe('assessment-1')).resolves.toBe(true);
    },
  );

  it('records possible billing but rejects a late Provider result after acceptance', async () => {
    const repository = new MemoryRepository('PROCESSING', true);
    const service = new PronunciationCancellationService(
      repository,
      new InMemoryPronunciationCancellationSignalStore(),
    );
    const signal = service.abortSignalFor('assessment-1');
    await expect(
      service.cancel({
        subjectId: 'user-1',
        assessmentId: 'assessment-1',
        idempotencyKey,
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED', mayBeBillable: true });
    await expect(
      service.assertCanFinalize('user-1', 'assessment-1', signal),
    ).rejects.toEqual(new PronunciationCancellationError('CANCELLED'));
  });

  it('does not overwrite a final transaction and is idempotent', async () => {
    const repository = new MemoryRepository('COMPLETED', true);
    const service = new PronunciationCancellationService(
      repository,
      new InMemoryPronunciationCancellationSignalStore(),
    );
    await expect(
      service.cancel({
        subjectId: 'user-1',
        assessmentId: 'assessment-1',
        idempotencyKey,
      }),
    ).resolves.toEqual({
      status: 'COMPLETED',
      mayBeBillable: true,
      learningSaved: true,
    });
    expect(repository.mutations).toBe(0);
  });

  it('keeps durable cancellation successful if Redis signalling is unavailable', async () => {
    const repository = new MemoryRepository('PROCESSING');
    const service = new PronunciationCancellationService(repository, {
      set: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      has: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
    });
    await expect(
      service.cancel({
        subjectId: 'user-1',
        assessmentId: 'assessment-1',
        idempotencyKey,
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(repository.state?.status).toBe('CANCELLED');
  });

  it('uses indistinguishable not-found behavior across owners', async () => {
    const service = new PronunciationCancellationService(
      new MemoryRepository('QUEUED'),
      new InMemoryPronunciationCancellationSignalStore(),
    );
    await expect(
      service.cancel({
        subjectId: 'other-user',
        assessmentId: 'assessment-1',
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
