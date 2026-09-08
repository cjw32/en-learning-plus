import {
  CoachRetentionService,
  PrismaCoachRetentionRepository,
  type CoachRetentionRepository,
  type CoachEphemeralDataStore,
} from '../../src/coach/observability/coach-retention.service';
import { CoachRetentionProcessor } from '../../src/coach/observability/coach-retention.processor';
import { CheckpointPurgeService } from '../../src/coach/observability/checkpoint-purge.service';
import {
  LearningDataDeletionService,
  type LearningDataDeletionRepository,
} from '@libs/learning';
import { Prisma } from '@libs/shared/generated/prisma/client';

const hour = 60 * 60 * 1_000;
const day = 24 * hour;

describe('Coach retention and deletion lifecycle', () => {
  function fixture() {
    const repository: jest.Mocked<CoachRetentionRepository> = {
      expireConversations: jest.fn(async () => ['thread_expired_001']),
      purgeTracesBefore: jest.fn(async () => 1),
      purgeFeedbackBefore: jest.fn(async () => 1),
      purgeDiagnosticsBefore: jest.fn(async () => 1),
      markSubjectDeleting: jest.fn(async () => ({
        tombstoneId: 'deletion_00001',
        checkpointThreadIds: ['thread_user_001'],
        purgeAfter: new Date('2026-09-03T00:00:00.000Z'),
      })),
      unlinkTraceSubject: jest.fn(async () => undefined),
      isSubjectDeleting: jest.fn(async () => false),
      purgeSubject: jest.fn(async () => undefined),
      completeTombstone: jest.fn(async () => undefined),
      claimDueDeletionJobs: jest.fn(async () => []),
      purgeConversation: jest.fn(async () => undefined),
    };
    const ephemeral: jest.Mocked<CoachEphemeralDataStore> = {
      purgeEventsBefore: jest.fn(async () => 1),
      purgeReconciliationBefore: jest.fn(async () => 1),
      purgeSubject: jest.fn(async () => undefined),
    };
    const checkpointAdapter = { deleteThread: jest.fn(async () => undefined) };
    const checkpoint = new CheckpointPurgeService(checkpointAdapter);
    const learningRepository: jest.Mocked<LearningDataDeletionRepository> = {
      hideImmediately: jest.fn(async () => undefined),
      purgeOwnedData: jest.fn(async () => undefined),
    };
    const learning = new LearningDataDeletionService(learningRepository);
    const now = new Date('2026-09-02T00:00:00.000Z');
    const service = new CoachRetentionService(
      repository,
      ephemeral,
      checkpoint,
      learning,
      () => now,
    );
    return {
      repository,
      ephemeral,
      checkpointAdapter,
      learningRepository,
      service,
      now,
    };
  }

  it('applies the 1h, 24h, 90d, 180d and 7d retention boundaries', async () => {
    const test = fixture();
    await test.service.purgeExpired();
    expect(test.ephemeral.purgeEventsBefore).toHaveBeenCalledWith(
      new Date(test.now.getTime() - hour),
    );
    expect(test.ephemeral.purgeReconciliationBefore).toHaveBeenCalledWith(
      new Date(test.now.getTime() - day),
    );
    expect(test.repository.expireConversations).toHaveBeenCalledWith(test.now);
    expect(test.checkpointAdapter.deleteThread).toHaveBeenCalledWith(
      'thread_expired_001',
    );
    expect(test.repository.purgeTracesBefore).toHaveBeenCalledWith(
      new Date(test.now.getTime() - 180 * day),
    );
    expect(test.repository.purgeFeedbackBefore).toHaveBeenCalledWith(
      new Date(test.now.getTime() - 180 * day),
    );
    expect(test.repository.purgeDiagnosticsBefore).toHaveBeenCalledWith(
      new Date(test.now.getTime() - 7 * day),
    );
  });

  it('immediately hides data, clears ephemeral content and unlinks Trace identity', async () => {
    const test = fixture();
    const deletion = await test.service.requestSubjectDeletion('user-a');
    expect(deletion).toMatchObject({
      tombstoneId: 'deletion_00001',
      status: 'DELETING',
      purgeAfter: '2026-09-03T00:00:00.000Z',
    });
    expect(test.learningRepository.hideImmediately).toHaveBeenCalledWith(
      'user-a',
      test.now,
    );
    expect(test.repository.unlinkTraceSubject).toHaveBeenCalledWith('user-a');
    expect(test.ephemeral.purgeSubject).toHaveBeenCalledWith('user-a');
  });

  it('physically purges within 24h and prevents in-flight work from restoring data', async () => {
    const test = fixture();
    test.repository.isSubjectDeleting.mockResolvedValue(true);
    await expect(
      test.service.assertSubjectActive('user-a'),
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });

    const processor = new CoachRetentionProcessor(
      test.repository,
      new CheckpointPurgeService(test.checkpointAdapter),
      new LearningDataDeletionService(test.learningRepository),
    );
    await processor.process({
      tombstoneId: 'deletion_00001',
      subjectId: 'user-a',
      checkpointThreadIds: ['thread_user_001'],
      purgeAfter: new Date(test.now.getTime() + day),
    });
    expect(test.learningRepository.purgeOwnedData).toHaveBeenCalledWith(
      'user-a',
    );
    expect(test.repository.purgeSubject).toHaveBeenCalledWith('user-a');
    expect(test.checkpointAdapter.deleteThread).toHaveBeenCalledWith(
      'thread_user_001',
    );
    expect(test.repository.completeTombstone).toHaveBeenCalledWith(
      'deletion_00001',
      expect.any(Date),
    );
  });

  it('claims due tombstones without identity in queue payloads and purges both scopes', async () => {
    const test = fixture();
    test.repository.claimDueDeletionJobs.mockResolvedValue([
      {
        scope: 'COACH_DATA',
        tombstoneId: 'deletion_subject_001',
        subjectId: 'user-a',
        checkpointThreadIds: ['thread_user_001'],
      },
      {
        scope: 'CONVERSATION',
        tombstoneId: 'deletion_conversation_001',
        subjectId: 'user-a',
        conversationId: 'conversation-a',
        checkpointThreadIds: ['thread_conversation_001'],
      },
    ]);
    const processor = new CoachRetentionProcessor(
      test.repository,
      new CheckpointPurgeService(test.checkpointAdapter),
      new LearningDataDeletionService(test.learningRepository),
    );

    await processor.processDue(test.now);

    expect(test.repository.claimDueDeletionJobs).toHaveBeenCalledWith(test.now);
    expect(test.repository.purgeConversation).toHaveBeenCalledWith(
      'user-a',
      'conversation-a',
    );
    expect(test.repository.completeTombstone).toHaveBeenCalledTimes(2);
  });

  it('redacts deleted conversation content without cascading saved learning progress', async () => {
    const database = {
      coachConversation: {
        findFirst: jest.fn(async () => ({ id: 'conversation-a' })),
        update: jest.fn(async () => undefined),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      exercise: {
        findMany: jest.fn(async () => [{ id: 'exercise-a' }]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      exerciseItem: {
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      exerciseSubmission: {
        findMany: jest.fn(async () => [{ id: 'submission-a' }]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      exerciseSubmissionItem: {
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      coachRequest: {
        findMany: jest.fn(async () => [{ id: 'request-a' }]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      coachFeedback: {
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      coachMessage: {
        deleteMany: jest.fn(async () => ({ count: 2 })),
      },
      learningAttempt: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (operation: (client: typeof database) => Promise<unknown>) =>
          operation(database),
      ),
    };
    const repository = new PrismaCoachRetentionRepository(prisma as never);

    await repository.purgeConversation('user-a', 'conversation-a');

    expect(database.coachConversation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'conversation-a',
        status: 'DELETING',
        userId: 'user-a',
      },
      select: { id: true },
    });
    expect(database.exerciseSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answers: [],
          gradingResult: { redacted: true },
        }),
      }),
    );
    expect(database.coachRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finalResult: Prisma.DbNull,
          finalResultSchemaVersion: null,
        }),
      }),
    );
    expect(database.coachConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELETED', title: null }),
      }),
    );
    expect(database.coachConversation.deleteMany).not.toHaveBeenCalled();
    expect(database.learningAttempt.deleteMany).not.toHaveBeenCalled();
  });
});
