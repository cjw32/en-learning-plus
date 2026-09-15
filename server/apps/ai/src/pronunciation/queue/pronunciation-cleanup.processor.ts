import { createHmac } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import type { PronunciationAudioStorage } from '../storage/pronunciation-audio.storage';

export type PronunciationCleanupJob = Readonly<{
  tombstoneId: string;
  objectKey: string | null;
  purgeDeadline: Date;
  audioAssetId?: string;
}>;

export interface PronunciationCleanupRepository {
  claimDue(now: Date): Promise<readonly PronunciationCleanupJob[]>;
  complete(tombstoneId: string, completedAt: Date): Promise<void>;
  retry(tombstoneId: string, failureCode: string): Promise<void>;
}

@Injectable()
export class PronunciationCleanupProcessor {
  constructor(
    private readonly repository: PronunciationCleanupRepository,
    private readonly storage: Pick<PronunciationAudioStorage, 'purge'>,
  ) {}

  async processDue(now: Date): Promise<void> {
    const jobs = await this.repository.claimDue(now);
    for (const job of jobs) {
      try {
        if (job.objectKey) await this.storage.purge(job.objectKey);
        await this.repository.complete(job.tombstoneId, now);
      } catch {
        await this.repository.retry(job.tombstoneId, 'PURGE_RETRY');
      }
    }
  }
}

function resourceHash(pepper: string, assessmentId: string): string {
  return createHmac('sha256', pepper)
    .update(`assessment\0${assessmentId}`)
    .digest('hex');
}

@Injectable()
export class PrismaPronunciationCleanupRepository implements PronunciationCleanupRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly pepper = process.env.PRONUNCIATION_TRACE_PEPPER ??
      process.env.JWT_SECRET ??
      '',
  ) {}

  async claimDue(now: Date): Promise<readonly PronunciationCleanupJob[]> {
    if (!this.pepper.trim()) return [];
    return this.prisma.$transaction(async (database) => {
      const output: PronunciationCleanupJob[] = [];
      const tombstones = await database.pronunciationDeletionTombstone.findMany(
        {
          where: {
            OR: [
              { status: 'ACCEPTED', claimedAt: null },
              { status: 'FAILED', failureCode: 'PURGE_RETRY', claimedAt: null },
              {
                status: 'PURGING',
                claimedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
              },
            ],
          },
          orderBy: { requestedAt: 'asc' },
          take: 20,
        },
      );
      const candidates = await database.pronunciationAssessment.findMany({
        where: {
          OR: [
            { hiddenAt: { not: null } },
            { audioAsset: { accessRevokedAt: { not: null } } },
          ],
        },
        select: {
          id: true,
          audioAsset: { select: { id: true, objectKey: true } },
        },
      });
      for (const tombstone of tombstones) {
        const claimed =
          await database.pronunciationDeletionTombstone.updateMany({
            where: {
              id: tombstone.id,
              status: tombstone.status,
              claimedAt: tombstone.claimedAt,
            },
            data: { claimedAt: now, status: 'PURGING', failureCode: null },
          });
        if (claimed.count !== 1) continue;
        const assessment = candidates.find(
          (candidate) =>
            resourceHash(this.pepper, candidate.id) === tombstone.resourceHash,
        );
        output.push({
          tombstoneId: tombstone.id,
          objectKey: assessment?.audioAsset?.objectKey ?? null,
          audioAssetId: assessment?.audioAsset?.id,
          purgeDeadline: tombstone.purgeDeadline,
        });
      }
      const expired = await database.pronunciationAudioAsset.findMany({
        where: {
          expiresAt: { lte: now },
          purgedAt: null,
          OR: [
            { status: { in: ['READY', 'INVALID', 'QUARANTINED', 'UPLOADING', 'VALIDATING', 'REVOKED'] } },
            {
              status: 'PURGING',
              accessRevokedAt: {
                lte: new Date(now.getTime() - 5 * 60_000),
              },
            },
          ],
        },
        orderBy: { expiresAt: 'asc' },
        take: 20,
      });
      for (const audio of expired) {
        const claimed = await database.pronunciationAudioAsset.updateMany({
          where: {
            id: audio.id,
            status: audio.status,
            accessRevokedAt: audio.accessRevokedAt,
            purgedAt: null,
          },
          data: { status: 'PURGING', accessRevokedAt: now },
        });
        if (claimed.count === 1) {
          output.push({
            tombstoneId: `audio:${audio.id}`,
            objectKey: audio.objectKey,
            audioAssetId: audio.id,
            purgeDeadline: audio.expiresAt,
          });
        }
      }
      return output;
    });
  }

  async complete(tombstoneId: string, completedAt: Date): Promise<void> {
    if (tombstoneId.startsWith('audio:')) {
      await this.prisma.pronunciationAudioAsset.updateMany({
        where: { id: tombstoneId.slice(6), status: 'PURGING' },
        data: { status: 'PURGED', purgedAt: completedAt },
      });
      return;
    }
    if (!this.pepper.trim()) return;
    await this.prisma.$transaction(async (database) => {
      const tombstone =
        await database.pronunciationDeletionTombstone.findUnique({
          where: { id: tombstoneId },
          select: { resourceHash: true, scope: true, status: true },
        });
      if (!tombstone || tombstone.status !== 'PURGING') return;
      const candidates = await database.pronunciationAssessment.findMany({
        where: {
          OR: [
            { hiddenAt: { not: null } },
            { audioAsset: { accessRevokedAt: { not: null } } },
          ],
        },
        select: {
          id: true,
          hiddenAt: true,
          audioAsset: { select: { id: true } },
        },
      });
      const assessment = candidates.find(
        (candidate) =>
          resourceHash(this.pepper, candidate.id) === tombstone.resourceHash,
      );
      if (assessment && tombstone.scope === 'PRONUNCIATION_ASSESSMENT') {
        await database.pronunciationAssessment.deleteMany({
          where: { id: assessment.id, hiddenAt: { not: null } },
        });
      } else if (assessment?.audioAsset) {
        await database.pronunciationAudioAsset.updateMany({
          where: {
            id: assessment.audioAsset.id,
            status: { in: ['REVOKED', 'PURGING'] },
          },
          data: { status: 'PURGED', purgedAt: completedAt },
        });
      }
      await database.pronunciationDeletionTombstone.updateMany({
        where: { id: tombstoneId, status: 'PURGING' },
        data: {
          status: 'COMPLETED',
          completedAt,
          claimedAt: null,
          failureCode: null,
        },
      });
    });
  }

  async retry(tombstoneId: string, failureCode: string): Promise<void> {
    if (tombstoneId.startsWith('audio:')) {
      await this.prisma.pronunciationAudioAsset.updateMany({
        where: { id: tombstoneId.slice(6), status: 'PURGING' },
        data: { status: 'REVOKED' },
      });
      return;
    }
    await this.prisma.pronunciationDeletionTombstone.updateMany({
      where: { id: tombstoneId },
      data: { status: 'FAILED', failureCode, claimedAt: null },
    });
  }
}
