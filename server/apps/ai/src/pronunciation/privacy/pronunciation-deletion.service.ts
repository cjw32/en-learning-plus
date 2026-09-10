import { createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import type { PronunciationLearningDeletionService } from '@libs/learning';
import type { PronunciationAudioStorage } from '../storage/pronunciation-audio.storage';

const HOUR_MS = 60 * 60 * 1_000;

export type PronunciationDeletionScope =
  | 'PRONUNCIATION_AUDIO'
  | 'PRONUNCIATION_ASSESSMENT';
export type PronunciationDeletionStatus =
  | 'ACCEPTED'
  | 'COMPENSATING'
  | 'PURGING'
  | 'COMPLETED'
  | 'FAILED';

type InternalDeletion = Readonly<{
  deletionId: string;
  scope: PronunciationDeletionScope;
  status: PronunciationDeletionStatus;
  hiddenAt: Date;
  purgeDeadline: Date;
  objectKey: string | null;
  deletedAttemptId: string | null;
  failureCode: string | null;
}>;

export interface PronunciationDeletionRepository {
  request(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      scope: PronunciationDeletionScope;
      subjectHash: string;
      resourceHash: string;
      idempotencyKeyHash: string;
      requestedAt: Date;
      purgeDeadline: Date;
    }>,
  ): Promise<InternalDeletion | null>;
  findStatus(
    subjectHash: string,
    deletionId: string,
  ): Promise<Readonly<{
    deletionId: string;
    scope: PronunciationDeletionScope;
    status: PronunciationDeletionStatus;
    hiddenAt: Date;
    purgeDeadline: Date;
    completedAt: Date | null;
  }> | null>;
  markFailed(deletionId: string, code: string): Promise<void>;
}

function hash(pepper: string, namespace: string, value: string): string {
  return createHmac('sha256', pepper)
    .update(`${namespace}\0${value}`)
    .digest('hex');
}

function publicDeletion(value: {
  deletionId: string;
  scope: PronunciationDeletionScope;
  status: PronunciationDeletionStatus;
  hiddenAt: Date;
  purgeDeadline: Date;
  completedAt?: Date | null;
}) {
  return Object.freeze({
    deletionId: value.deletionId,
    scope: value.scope,
    status: value.status,
    accessRevokedAt: value.hiddenAt.toISOString(),
    purgeDeadline: value.purgeDeadline.toISOString(),
    completedAt: value.completedAt?.toISOString() ?? null,
  });
}

@Injectable()
export class PronunciationDeletionService {
  constructor(
    private readonly repository: PronunciationDeletionRepository,
    private readonly storage: Pick<PronunciationAudioStorage, 'revoke'>,
    private readonly learning: Pick<
      PronunciationLearningDeletionService,
      'compensate'
    >,
    private readonly now: () => Date = () => new Date(),
    private readonly pepper = process.env.PRONUNCIATION_TRACE_PEPPER ??
      process.env.JWT_SECRET ??
      '',
  ) {}

  async request(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      scope: PronunciationDeletionScope;
      idempotencyKey: string;
    }>,
  ) {
    if (!this.pepper.trim())
      throw new Error('DELETION_HASH_PEPPER_UNAVAILABLE');
    const requestedAt = this.now();
    const saved = await this.repository.request({
      ...input,
      subjectHash: hash(this.pepper, 'subject', input.subjectId),
      resourceHash: hash(this.pepper, 'assessment', input.assessmentId),
      idempotencyKeyHash: hash(
        this.pepper,
        'idempotency',
        input.idempotencyKey,
      ),
      requestedAt,
      purgeDeadline: new Date(requestedAt.getTime() + HOUR_MS),
    });
    if (!saved) return null;
    if (saved.objectKey)
      await this.storage.revoke(saved.objectKey).catch(() => undefined);
    let status = saved.status;
    const compensationRequired =
      input.scope === 'PRONUNCIATION_ASSESSMENT' &&
      saved.deletedAttemptId &&
      (saved.status === 'COMPENSATING' ||
        (saved.status === 'FAILED' &&
          saved.failureCode === 'COMPENSATION_RETRY'));
    if (compensationRequired) {
      try {
        await this.learning.compensate({
          deletionId: saved.deletionId,
          deletedAttemptId: saved.deletedAttemptId,
          reviewedTimezone: 'UTC',
        });
        status = 'ACCEPTED';
      } catch {
        status = 'FAILED';
        await this.repository.markFailed(
          saved.deletionId,
          'COMPENSATION_RETRY',
        );
      }
    }
    return publicDeletion({
      ...saved,
      scope: saved.scope ?? input.scope,
      status,
    });
  }

  async status(subjectId: string, deletionId: string) {
    if (!this.pepper.trim())
      throw new Error('DELETION_HASH_PEPPER_UNAVAILABLE');
    const found = await this.repository.findStatus(
      hash(this.pepper, 'subject', subjectId),
      deletionId,
    );
    return found ? publicDeletion(found) : null;
  }
}

@Injectable()
export class PrismaPronunciationDeletionRepository implements PronunciationDeletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async request(
    input: Parameters<PronunciationDeletionRepository['request']>[0],
  ) {
    return this.prisma.$transaction(async (database) => {
      const assessment = await database.pronunciationAssessment.findFirst({
        where: { id: input.assessmentId, userId: input.subjectId },
        select: {
          id: true,
          hiddenAt: true,
          audioAsset: { select: { objectKey: true } },
          learningAttempt: { select: { id: true } },
        },
      });
      if (!assessment) return null;
      const conflicting =
        await database.pronunciationDeletionTombstone.findUnique({
          where: {
            subjectHash_idempotencyKeyHash: {
              subjectHash: input.subjectHash,
              idempotencyKeyHash: input.idempotencyKeyHash,
            },
          },
        });
      if (
        conflicting &&
        (conflicting.resourceHash !== input.resourceHash ||
          conflicting.scope !== input.scope)
      ) {
        throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'), {
          code: 'IDEMPOTENCY_CONFLICT',
        });
      }
      if (input.scope === 'PRONUNCIATION_AUDIO') {
        await database.pronunciationAudioAsset.updateMany({
          where: { assessmentId: assessment.id, userId: input.subjectId },
          data: { status: 'REVOKED', accessRevokedAt: input.requestedAt },
        });
      } else {
        await database.pronunciationAssessment.update({
          where: { id: assessment.id },
          data: {
            status: 'DELETING',
            hiddenAt: assessment.hiddenAt ?? input.requestedAt,
            cancelRequestedAt: input.requestedAt,
            learningWriteStatus: assessment.learningAttempt
              ? 'COMPENSATING'
              : 'NOT_ELIGIBLE',
          },
        });
        await database.pronunciationAudioAsset.updateMany({
          where: { assessmentId: assessment.id, userId: input.subjectId },
          data: { status: 'REVOKED', accessRevokedAt: input.requestedAt },
        });
      }
      const initialStatus =
        input.scope === 'PRONUNCIATION_ASSESSMENT' && assessment.learningAttempt
          ? 'COMPENSATING'
          : 'ACCEPTED';
      const tombstone = await database.pronunciationDeletionTombstone.upsert({
        where: {
          subjectHash_scope_resourceHash: {
            subjectHash: input.subjectHash,
            scope: input.scope,
            resourceHash: input.resourceHash,
          },
        },
        create: {
          id: `delete_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
          subjectHash: input.subjectHash,
          resourceHash: input.resourceHash,
          scope: input.scope,
          status: initialStatus,
          idempotencyKeyHash: input.idempotencyKeyHash,
          requestedAt: input.requestedAt,
          hiddenAt: input.requestedAt,
          purgeDeadline: input.purgeDeadline,
          expiresAt: new Date('9999-12-31T23:59:59.999Z'),
        },
        update: {},
      });
      return {
        deletionId: tombstone.id,
        scope: tombstone.scope,
        status: tombstone.status,
        hiddenAt: tombstone.hiddenAt,
        purgeDeadline: tombstone.purgeDeadline,
        objectKey: assessment.audioAsset?.objectKey ?? null,
        deletedAttemptId: assessment.learningAttempt?.id ?? null,
        failureCode: tombstone.failureCode,
      };
    });
  }

  async findStatus(subjectHash: string, deletionId: string) {
    const row = await this.prisma.pronunciationDeletionTombstone.findFirst({
      where: { id: deletionId, subjectHash },
    });
    return row
      ? {
          deletionId: row.id,
          scope: row.scope,
          status: row.status,
          hiddenAt: row.hiddenAt,
          purgeDeadline: row.purgeDeadline,
          completedAt: row.completedAt,
        }
      : null;
  }

  async markFailed(deletionId: string, code: string) {
    await this.prisma.pronunciationDeletionTombstone.updateMany({
      where: { id: deletionId },
      data: { status: 'FAILED', failureCode: code },
    });
  }
}
