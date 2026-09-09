import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LearningDataDeletionService } from '@libs/learning';
import { createHash } from 'node:crypto';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import { CheckpointPurgeService } from './checkpoint-purge.service';
import { CoachRedisConnection } from '../streaming/coach-redis.module';

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export const COACH_RAG_RETENTION_POLICY = Object.freeze({
  privateContentPurgeMs: DAY_MS,
  diagnosticContentMs: 7 * DAY_MS,
  traceMetadataMs: 180 * DAY_MS,
  replayMs: HOUR_MS,
  reconciliationMs: DAY_MS,
});

export interface CoachRetentionRepository {
  expireConversations(now: Date): Promise<string[]>;
  purgeTracesBefore(cutoff: Date): Promise<number>;
  purgeFeedbackBefore(cutoff: Date): Promise<number>;
  purgeDiagnosticsBefore(cutoff: Date): Promise<number>;
  markSubjectDeleting(
    subjectId: string,
    requestedAt: Date,
    purgeAfter: Date,
  ): Promise<{
    tombstoneId: string;
    checkpointThreadIds: string[];
    purgeAfter: Date;
  }>;
  unlinkTraceSubject(subjectId: string): Promise<void>;
  isSubjectDeleting(subjectId: string): Promise<boolean>;
  purgeSubject(subjectId: string): Promise<void>;
  completeTombstone(tombstoneId: string, completedAt: Date): Promise<void>;
  claimDueDeletionJobs(now: Date): Promise<CoachDueDeletionJob[]>;
  purgeConversation(subjectId: string, conversationId: string): Promise<void>;
  markOwnedConversationDeleting?(
    subjectId: string,
    conversationId: string,
    requestedAt: Date,
    purgeAfter: Date,
  ): Promise<{
    tombstoneId: string;
    checkpointThreadIds: string[];
    purgeAfter: Date;
  } | null>;
}

export type CoachDueDeletionJob =
  | Readonly<{
      scope: 'COACH_DATA';
      tombstoneId: string;
      subjectId: string;
      checkpointThreadIds: readonly string[];
    }>
  | Readonly<{
      scope: 'CONVERSATION';
      tombstoneId: string;
      subjectId: string;
      conversationId: string;
      checkpointThreadIds: readonly string[];
    }>;

export interface CoachDueDeletionRunner {
  processDue(now: Date): Promise<void>;
}

export interface CoachEphemeralDataStore {
  purgeEventsBefore(cutoff: Date): Promise<number>;
  purgeReconciliationBefore(cutoff: Date): Promise<number>;
  purgeSubject(subjectId: string): Promise<void>;
}

export class CoachSubjectDeletingError extends Error {
  readonly code = 'STATE_CONFLICT';
  constructor() {
    super('Coach data is being deleted');
  }
}

@Injectable()
export class CoachRetentionService implements OnModuleInit, OnModuleDestroy {
  private retentionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: CoachRetentionRepository,
    private readonly ephemeral: CoachEphemeralDataStore,
    private readonly checkpoints: CheckpointPurgeService,
    private readonly learningDeletion: LearningDataDeletionService,
    private readonly now: () => Date = () => new Date(),
    private readonly deletionRunner?: CoachDueDeletionRunner,
  ) {}

  onModuleInit() {
    void this.purgeExpired().catch(() => undefined);
    this.retentionTimer = setInterval(
      () => void this.purgeExpired().catch(() => undefined),
      HOUR_MS,
    );
    this.retentionTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
  }

  async purgeExpired(): Promise<void> {
    const now = this.now();
    await Promise.all([
      this.ephemeral.purgeEventsBefore(
        new Date(now.getTime() - COACH_RAG_RETENTION_POLICY.replayMs),
      ),
      this.ephemeral.purgeReconciliationBefore(
        new Date(now.getTime() - COACH_RAG_RETENTION_POLICY.reconciliationMs),
      ),
      this.repository.purgeTracesBefore(
        new Date(now.getTime() - COACH_RAG_RETENTION_POLICY.traceMetadataMs),
      ),
      this.repository.purgeFeedbackBefore(
        new Date(now.getTime() - COACH_RAG_RETENTION_POLICY.traceMetadataMs),
      ),
      this.repository.purgeDiagnosticsBefore(
        new Date(now.getTime() - COACH_RAG_RETENTION_POLICY.diagnosticContentMs),
      ),
    ]);
    const expiredThreads = await this.repository.expireConversations(now);
    await this.checkpoints.deleteThreads(expiredThreads);
    await this.deletionRunner?.processDue(now);
  }

  async requestSubjectDeletion(subjectId: string) {
    const requestedAt = this.now();
    const requested = await this.repository.markSubjectDeleting(
      subjectId,
      requestedAt,
      new Date(
        requestedAt.getTime() +
          COACH_RAG_RETENTION_POLICY.privateContentPurgeMs,
      ),
    );
    await this.learningDeletion.hideImmediately(subjectId, requestedAt);
    await Promise.all([
      this.repository.unlinkTraceSubject(subjectId),
      this.ephemeral.purgeSubject(subjectId),
    ]);
    return Object.freeze({
      tombstoneId: requested.tombstoneId,
      status: 'DELETING' as const,
      purgeAfter: requested.purgeAfter.toISOString(),
    });
  }

  async requestConversationDeletion(
    subjectId: string,
    conversationId: string,
  ) {
    if (!this.repository.markOwnedConversationDeleting) return null;
    const requestedAt = this.now();
    const requested = await this.repository.markOwnedConversationDeleting(
      subjectId,
      conversationId,
      requestedAt,
      new Date(requestedAt.getTime() + DAY_MS),
    );
    if (!requested) return null;
    await this.checkpoints.deleteThreads(requested.checkpointThreadIds);
    return Object.freeze({
      deletionId: requested.tombstoneId,
      status: 'ACCEPTED' as const,
      hiddenAt: requestedAt.toISOString(),
      purgeDeadline: requested.purgeAfter.toISOString(),
    });
  }

  async assertSubjectActive(subjectId: string): Promise<void> {
    if (await this.repository.isSubjectDeleting(subjectId)) {
      throw new CoachSubjectDeletingError();
    }
  }
}

function opaqueHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function deletionId(subjectId: string, scope: string, resourceId: string) {
  return `delete_${opaqueHash(`${subjectId}\u0000${scope}\u0000${resourceId}`).slice(0, 24)}`;
}

@Injectable()
export class PrismaCoachRetentionRepository
  implements CoachRetentionRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async expireConversations(now: Date): Promise<string[]> {
    const conversations = await this.prisma.coachConversation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      select: { id: true, checkpointThreadId: true },
    });
    for (const conversation of conversations) {
      await this.prisma.$transaction(async (database) => {
        const exercises = await database.exercise.findMany({
          where: { conversationId: conversation.id },
          select: { id: true },
        });
        const exerciseIds = exercises.map((item) => item.id);
        const submissions = exerciseIds.length
          ? await database.exerciseSubmission.findMany({
              where: { exerciseId: { in: exerciseIds } },
              select: { id: true },
            })
          : [];
        const submissionIds = submissions.map((item) => item.id);
        if (submissionIds.length) {
          await database.exerciseSubmissionItem.updateMany({
            where: { submissionId: { in: submissionIds } },
            data: {
              answer: {},
              correction: '',
              explanation: '',
              errorTypes: [],
              targetQualities: [],
            },
          });
        }
        if (exerciseIds.length) {
          await database.exerciseItem.updateMany({
            where: { exerciseId: { in: exerciseIds } },
            data: {
              prompt: '[expired]',
              choices: Prisma.JsonNull,
              answerKey: {},
              gradingRubric: {},
              citations: [],
            },
          });
          await database.exercise.updateMany({
            where: { id: { in: exerciseIds } },
            data: {
              instructions: '[expired]',
              personalizationReason: '[expired]',
              citations: [],
            },
          });
        }
        await database.coachMessage.deleteMany({
          where: { conversationId: conversation.id },
        });
        await database.coachRequest.updateMany({
          where: { conversationId: conversation.id },
          data: {
            inputPayload: { type: 'RECOMMENDATION' },
            finalResult: Prisma.JsonNull,
            finalResultSchemaVersion: null,
          },
        });
        await database.coachConversation.update({
          where: { id: conversation.id },
          data: { status: 'EXPIRED', deletedAt: now },
        });
      });
    }
    return conversations.map((item) => item.checkpointThreadId);
  }

  async purgeTracesBefore(cutoff: Date) {
    return (
      await this.prisma.coachTrace.deleteMany({
        where: { expiresAt: { lte: cutoff } },
      })
    ).count;
  }

  async purgeFeedbackBefore(cutoff: Date) {
    return (
      await this.prisma.coachFeedback.deleteMany({
        where: { expiresAt: { lte: cutoff } },
      })
    ).count;
  }

  async purgeDiagnosticsBefore(_cutoff: Date) {
    return 0;
  }

  async markSubjectDeleting(
    subjectId: string,
    requestedAt: Date,
    purgeAfter: Date,
  ) {
    const conversations = await this.prisma.coachConversation.findMany({
      where: { userId: subjectId },
      select: { checkpointThreadId: true },
    });
    await this.prisma.coachConversation.updateMany({
      where: { userId: subjectId, status: 'ACTIVE' },
      data: { status: 'DELETING', deletedAt: requestedAt },
    });
    await this.prisma.coachRequest.updateMany({
      where: {
        userId: subjectId,
        status: { in: ['CREATED', 'QUEUED', 'RUNNING'] },
      },
      data: { cancelRequestedAt: requestedAt },
    });
    const subjectHash = opaqueHash(subjectId);
    const id = deletionId(subjectId, 'COACH_DATA', 'ALL');
    const tombstone = await this.prisma.coachDeletionTombstone.upsert({
      where: {
        subjectHash_scope_resourceHash: {
          subjectHash,
          scope: 'COACH_DATA',
          resourceHash: 'ALL',
        },
      },
      create: {
        id,
        subjectHash,
        resourceHash: 'ALL',
        scope: 'COACH_DATA',
        status: 'ACCEPTED',
        requestedAt,
        hiddenAt: requestedAt,
        purgeDeadline: purgeAfter,
        expiresAt: new Date('9999-12-31T23:59:59.999Z'),
      },
      update: {},
    });
    return {
      tombstoneId: tombstone.id,
      checkpointThreadIds: conversations.map((item) => item.checkpointThreadId),
      purgeAfter: tombstone.purgeDeadline,
    };
  }

  async markOwnedConversationDeleting(
    subjectId: string,
    conversationId: string,
    requestedAt: Date,
    purgeAfter: Date,
  ) {
    const conversation = await this.prisma.coachConversation.findFirst({
      where: { id: conversationId, userId: subjectId, status: 'ACTIVE' },
      select: { checkpointThreadId: true },
    });
    if (!conversation) return null;
    await this.prisma.coachConversation.update({
      where: { id: conversationId },
      data: { status: 'DELETING', deletedAt: requestedAt },
    });
    await this.prisma.coachRequest.updateMany({
      where: {
        conversationId,
        userId: subjectId,
        status: { in: ['CREATED', 'QUEUED', 'RUNNING'] },
      },
      data: { cancelRequestedAt: requestedAt },
    });
    const subjectHash = opaqueHash(subjectId);
    const resourceHash = opaqueHash(conversationId);
    const id = deletionId(subjectId, 'CONVERSATION', conversationId);
    const tombstone = await this.prisma.coachDeletionTombstone.upsert({
      where: {
        subjectHash_scope_resourceHash: {
          subjectHash,
          scope: 'CONVERSATION',
          resourceHash,
        },
      },
      create: {
        id,
        subjectHash,
        resourceHash,
        scope: 'CONVERSATION',
        requestedAt,
        hiddenAt: requestedAt,
        purgeDeadline: purgeAfter,
        expiresAt: new Date('9999-12-31T23:59:59.999Z'),
      },
      update: {},
    });
    return {
      tombstoneId: tombstone.id,
      checkpointThreadIds: [conversation.checkpointThreadId],
      purgeAfter: tombstone.purgeDeadline,
    };
  }

  async unlinkTraceSubject(subjectId: string) {
    await this.prisma.traceSubjectMapping.deleteMany({
      where: { userId: subjectId },
    });
  }

  async isSubjectDeleting(subjectId: string) {
    return Boolean(
      await this.prisma.coachDeletionTombstone.findFirst({
        where: {
          subjectHash: opaqueHash(subjectId),
          scope: 'COACH_DATA',
          status: { in: ['ACCEPTED', 'PURGING'] },
        },
        select: { id: true },
      }),
    );
  }

  async purgeSubject(subjectId: string) {
    await this.prisma.$transaction(async (database) => {
      await database.coachFeedback.deleteMany({ where: { userId: subjectId } });
      await database.learningAttempt.deleteMany({ where: { userId: subjectId } });
      await database.learningItemState.deleteMany({ where: { userId: subjectId } });
      await database.exerciseSubmission.deleteMany({ where: { userId: subjectId } });
      await database.exercise.deleteMany({ where: { userId: subjectId } });
      await database.coachMessage.deleteMany({
        where: { conversation: { userId: subjectId } },
      });
      await database.coachRequest.deleteMany({ where: { userId: subjectId } });
      await database.coachConversation.deleteMany({ where: { userId: subjectId } });
      await database.learnerProfile.deleteMany({ where: { userId: subjectId } });
    });
  }

  async completeTombstone(tombstoneId: string, completedAt: Date) {
    await this.prisma.coachDeletionTombstone.update({
      where: { id: tombstoneId },
      data: { status: 'COMPLETED', completedAt },
    });
  }

  async claimDueDeletionJobs(now: Date): Promise<CoachDueDeletionJob[]> {
    const tombstones = await this.prisma.coachDeletionTombstone.findMany({
      where: {
        status: { in: ['ACCEPTED', 'PURGING'] },
        purgeDeadline: { lte: now },
      },
      orderBy: { requestedAt: 'asc' },
    });
    if (tombstones.length === 0) return [];
    const conversations = await this.prisma.coachConversation.findMany({
      where: { status: 'DELETING' },
      select: { id: true, userId: true, checkpointThreadId: true },
    });
    const learningSubjects = await this.prisma.learningItemState.findMany({
      distinct: ['userId'],
      select: { userId: true },
    });
    const subjectIds = new Set([
      ...conversations.map((item) => item.userId),
      ...learningSubjects.map((item) => item.userId),
    ]);
    const jobs: CoachDueDeletionJob[] = [];
    for (const tombstone of tombstones) {
      await this.prisma.coachDeletionTombstone.updateMany({
        where: { id: tombstone.id, status: 'ACCEPTED' },
        data: { status: 'PURGING' },
      });
      if (tombstone.scope === 'COACH_DATA') {
        const subjectId = [...subjectIds].find(
          (candidate) => opaqueHash(candidate) === tombstone.subjectHash,
        );
        if (!subjectId) {
          await this.completeTombstone(tombstone.id, now);
          continue;
        }
        jobs.push({
          scope: 'COACH_DATA',
          tombstoneId: tombstone.id,
          subjectId,
          checkpointThreadIds: conversations
            .filter((item) => item.userId === subjectId)
            .map((item) => item.checkpointThreadId),
        });
        continue;
      }
      const conversation = conversations.find(
        (candidate) =>
          opaqueHash(candidate.userId) === tombstone.subjectHash &&
          opaqueHash(candidate.id) === tombstone.resourceHash,
      );
      if (!conversation) {
        await this.completeTombstone(tombstone.id, now);
        continue;
      }
      jobs.push({
        scope: 'CONVERSATION',
        tombstoneId: tombstone.id,
        subjectId: conversation.userId,
        conversationId: conversation.id,
        checkpointThreadIds: [conversation.checkpointThreadId],
      });
    }
    return jobs;
  }

  async purgeConversation(subjectId: string, conversationId: string) {
    await this.prisma.coachConversation.deleteMany({
      where: { id: conversationId, userId: subjectId, status: 'DELETING' },
    });
  }
}

@Injectable()
export class RedisCoachEphemeralDataStore implements CoachEphemeralDataStore {
  constructor(
    private readonly redis: CoachRedisConnection,
    private readonly prisma: PrismaService,
  ) {}

  async purgeEventsBefore(_cutoff: Date) {
    return 0; // Stream keys already have an enforced one-hour TTL at append time.
  }

  async purgeReconciliationBefore(_cutoff: Date) {
    return 0; // Reconciliation records are durable request state, not content cache.
  }

  async purgeSubject(subjectId: string) {
    const requests = await this.prisma.coachRequest.findMany({
      where: { userId: subjectId },
      select: { id: true },
    });
    if (this.redis.client.status === 'wait') await this.redis.client.connect();
    for (const request of requests) {
      const base = `coach:events:${request.id}`;
      await this.redis.client.set(`coach:cancel:${request.id}`, '1', 'EX', 3600);
      await this.redis.client.publish('coach:cancellations', request.id);
      await this.redis.client.del(
        base,
        `${base}:sequence`,
        `${base}:last`,
        `${base}:sealed`,
      );
    }
  }
}
