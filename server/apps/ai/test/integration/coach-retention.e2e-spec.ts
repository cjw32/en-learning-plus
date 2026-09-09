import {
  CoachRetentionService,
  COACH_RAG_RETENTION_POLICY,
  type CoachRetentionRepository,
  type CoachEphemeralDataStore,
} from '../../src/coach/observability/coach-retention.service';
import { CoachRetentionProcessor } from '../../src/coach/observability/coach-retention.processor';
import { CheckpointPurgeService } from '../../src/coach/observability/checkpoint-purge.service';
import {
  LearningDataDeletionService,
  type LearningDataDeletionRepository,
} from '@libs/learning';

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
    return { repository, ephemeral, checkpointAdapter, learningRepository, service, now };
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
    expect(test.checkpointAdapter.deleteThread).toHaveBeenCalledWith('thread_expired_001');
    expect(test.repository.purgeTracesBefore).toHaveBeenCalledWith(
      new Date(test.now.getTime() - 180 * day),
    );
    expect(test.repository.purgeFeedbackBefore).toHaveBeenCalledWith(
      new Date(test.now.getTime() - 180 * day),
    );
    expect(test.repository.purgeDiagnosticsBefore).toHaveBeenCalledWith(
      new Date(test.now.getTime() - 7 * day),
    );
    expect(COACH_RAG_RETENTION_POLICY).toEqual({
      privateContentPurgeMs: day,
      diagnosticContentMs: 7 * day,
      traceMetadataMs: 180 * day,
      replayMs: hour,
      reconciliationMs: day,
    });
  });

  it('immediately hides data, clears ephemeral content and unlinks Trace identity', async () => {
    const test = fixture();
    const deletion = await test.service.requestSubjectDeletion('user-a');
    expect(deletion).toMatchObject({
      tombstoneId: 'deletion_00001',
      status: 'DELETING',
      purgeAfter: '2026-09-03T00:00:00.000Z',
    });
    expect(test.learningRepository.hideImmediately).toHaveBeenCalledWith('user-a', test.now);
    expect(test.repository.unlinkTraceSubject).toHaveBeenCalledWith('user-a');
    expect(test.ephemeral.purgeSubject).toHaveBeenCalledWith('user-a');
  });

  it('physically purges within 24h and prevents in-flight work from restoring data', async () => {
    const test = fixture();
    test.repository.isSubjectDeleting.mockResolvedValue(true);
    await expect(test.service.assertSubjectActive('user-a')).rejects.toMatchObject({
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
    expect(test.learningRepository.purgeOwnedData).toHaveBeenCalledWith('user-a');
    expect(test.repository.purgeSubject).toHaveBeenCalledWith('user-a');
    expect(test.checkpointAdapter.deleteThread).toHaveBeenCalledWith('thread_user_001');
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
});
