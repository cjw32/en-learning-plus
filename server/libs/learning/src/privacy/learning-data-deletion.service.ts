import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '@libs/shared';
import type { LearningDataCleanupPort } from './learning-data-cleanup.port';

export interface LearningDataDeletionRepository {
  hideImmediately(subjectId: string, requestedAt: Date): Promise<void>;
  purgeOwnedData(subjectId: string): Promise<void>;
}

export interface PronunciationAccountDataCleanup {
  revokeAudioAccess(subjectId: string): Promise<void>;
  purgeCaches(subjectId: string): Promise<void>;
  revokeTemporaryLinks(subjectId: string): Promise<void>;
  unlinkTraceSubject(subjectId: string): Promise<void>;
  purgeAudioObjects(subjectId: string): Promise<void>;
}

@Injectable()
export class LearningDataDeletionService {
  private readonly cleanups = new Map<string, LearningDataCleanupPort>();
  private pronunciation?: PronunciationAccountDataCleanup;

  constructor(
    private readonly repository: LearningDataDeletionRepository,
    cleanupsOrPronunciation?:
      | readonly LearningDataCleanupPort[]
      | PronunciationAccountDataCleanup,
  ) {
    if (Array.isArray(cleanupsOrPronunciation)) {
      for (const cleanup of cleanupsOrPronunciation) {
        this.registerCleanup(cleanup);
      }
    } else if (cleanupsOrPronunciation) {
      this.configurePronunciationCleanup(
        cleanupsOrPronunciation as PronunciationAccountDataCleanup,
      );
    }
  }

  registerCleanup(cleanup: LearningDataCleanupPort): void {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(cleanup.cleanupKey)) {
      throw new Error(
        `Invalid learning-data cleanup key: ${cleanup.cleanupKey}`,
      );
    }
    const registered = this.cleanups.get(cleanup.cleanupKey);
    if (registered === cleanup) return;
    if (registered) {
      throw new Error(
        `Duplicate learning-data cleanup key: ${cleanup.cleanupKey}`,
      );
    }
    this.cleanups.set(cleanup.cleanupKey, cleanup);
  }

  configurePronunciationCleanup(
    cleanup: PronunciationAccountDataCleanup,
  ): void {
    if (this.pronunciation === cleanup) return;
    if (this.pronunciation) {
      throw new Error('Duplicate learning-data cleanup key: pronunciation');
    }
    this.pronunciation = cleanup;
    this.registerCleanup({
      cleanupKey: 'pronunciation',
      hideImmediately: async (subjectId) => {
        await cleanup.revokeAudioAccess(subjectId);
        await cleanup.purgeCaches(subjectId);
        await cleanup.revokeTemporaryLinks(subjectId);
        await cleanup.unlinkTraceSubject(subjectId);
      },
      purgeOwnedData: (subjectId) => cleanup.purgeAudioObjects(subjectId),
    });
  }

  async hideImmediately(subjectId: string, requestedAt: Date): Promise<void> {
    await this.repository.hideImmediately(subjectId, requestedAt);
    for (const cleanup of this.cleanups.values()) {
      await cleanup.hideImmediately(subjectId, requestedAt);
    }
  }

  async purgeOwnedData(subjectId: string): Promise<void> {
    for (const cleanup of this.cleanups.values()) {
      await cleanup.purgeOwnedData(subjectId);
    }
    await this.repository.purgeOwnedData(subjectId);
  }
}

@Injectable()
export class PrismaLearningDataDeletionRepository implements LearningDataDeletionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hideImmediately(subjectId: string, requestedAt: Date) {
    await this.prisma.$transaction(async (database) => {
      const documents = await database.knowledgeDocument.findMany({
        where: { userId: subjectId, accessScope: 'PRIVATE_OWNER' },
        select: {
          id: true,
          releaseId: true,
          knowledgeSourceId: true,
          sourceRecordType: true,
          sourceRecordId: true,
          contentVersion: true,
          chunks: { select: { id: true } },
        },
      });
      const documentIds = documents.map((document) => document.id);
      const chunkIds = documents.flatMap((document) =>
        document.chunks.map((chunk) => chunk.id),
      );
      const releaseIds = [
        ...new Set(documents.map((document) => document.releaseId)),
      ];

      if (documentIds.length > 0) {
        await database.knowledgeCitation.updateMany({
          where: {
            documentId: { in: documentIds },
            status: { notIn: ['PRIVATE_DATA_DELETED', 'PURGED'] },
          },
          data: {
            status: 'PRIVATE_DATA_DELETED',
            invalidatedAt: requestedAt,
            excerpt: null,
            sourceId: null,
          },
        });
        if (chunkIds.length > 0) {
          await database.knowledgeEmbedding.updateMany({
            where: {
              chunkId: { in: chunkIds },
              status: { in: ['PENDING', 'READY', 'FAILED'] },
            },
            data: { status: 'INVALID' },
          });
          await database.knowledgeChunk.updateMany({
            where: {
              id: { in: chunkIds },
              status: { in: ['STAGED', 'ACTIVE', 'SUPERSEDED'] },
            },
            data: { status: 'INVALID' },
          });
        }
        await database.knowledgeDocument.updateMany({
          where: {
            id: { in: documentIds },
            status: { in: ['STAGED', 'ACTIVE', 'SUPERSEDED'] },
          },
          data: { status: 'INVALID' },
        });
        for (const releaseId of releaseIds) {
          const remainingActive = await database.knowledgeDocument.count({
            where: {
              releaseId,
              id: { notIn: documentIds },
              status: 'ACTIVE',
            },
          });
          if (remainingActive === 0) {
            await database.knowledgeRelease.updateMany({
              where: {
                id: releaseId,
                status: { in: ['BUILDING', 'READY', 'ACTIVE'] },
              },
              data: { status: 'INVALID', invalidatedAt: requestedAt },
            });
          }
        }
        await database.knowledgeIngestionJob.createMany({
          skipDuplicates: true,
          data: documents.map((document) => ({
            id: `kjob_${createHash('sha256')
              .update(
                `PURGE\0${document.sourceRecordType}\0${document.sourceRecordId}\0${document.contentVersion}\0private-purge.v1`,
              )
              .digest('hex')
              .slice(0, 24)}`,
            operation: 'PURGE' as const,
            knowledgeSourceId: document.knowledgeSourceId,
            sourceRecordType: document.sourceRecordType,
            sourceRecordId: document.sourceRecordId,
            contentVersion: document.contentVersion,
            pipelineVersion: 'private-purge.v1',
            ownerUserId: subjectId,
          })),
        });
      }
      await database.privateLearningSummary.updateMany({
        where: { userId: subjectId, status: { in: ['ACTIVE', 'SUPERSEDED'] } },
        data: { status: 'DELETING' },
      });
      await database.learnerProfile.deleteMany({
        where: { userId: subjectId },
      });
      await database.coachConversation.updateMany({
        where: { userId: subjectId, status: 'ACTIVE' },
        data: { status: 'DELETING', deletedAt: requestedAt },
      });
      await database.pronunciationAssessment.updateMany({
        where: { userId: subjectId, hiddenAt: null },
        data: {
          status: 'DELETING',
          hiddenAt: requestedAt,
          cancelRequestedAt: requestedAt,
        },
      });
      await database.pronunciationAudioAsset.updateMany({
        where: { userId: subjectId, accessRevokedAt: null },
        data: { status: 'REVOKED', accessRevokedAt: requestedAt },
      });
    });
  }

  async purgeOwnedData(subjectId: string) {
    await this.prisma.$transaction(async (database) => {
      const documents = await database.knowledgeDocument.findMany({
        where: { userId: subjectId, accessScope: 'PRIVATE_OWNER' },
        select: { id: true, releaseId: true },
      });
      const documentIds = documents.map((document) => document.id);
      const releaseIds = [
        ...new Set(documents.map((document) => document.releaseId)),
      ];
      if (documentIds.length > 0) {
        await database.knowledgeCitation.updateMany({
          where: { documentId: { in: documentIds } },
          data: {
            status: 'PURGED',
            invalidatedAt: new Date(),
            chunkId: null,
            documentId: null,
            sourceId: null,
            excerpt: null,
          },
        });
        await database.knowledgeDocument.deleteMany({
          where: { id: { in: documentIds } },
        });
        for (const releaseId of releaseIds) {
          const remaining = await database.knowledgeDocument.count({
            where: { releaseId },
          });
          if (remaining === 0) {
            await database.knowledgeRelease.updateMany({
              where: { id: releaseId },
              data: { status: 'PURGED' },
            });
          }
        }
      }
      await database.privateLearningSummary.deleteMany({
        where: { userId: subjectId },
      });
      await database.knowledgeIngestionJob.updateMany({
        where: { ownerUserId: subjectId, operation: 'PURGE' },
        data: { status: 'SUCCEEDED', finishedAt: new Date() },
      });
      await database.learningAttempt.deleteMany({
        where: { userId: subjectId },
      });
      await database.learningItemState.deleteMany({
        where: { userId: subjectId },
      });
      await database.pronunciationTrace.deleteMany({
        where: { assessment: { userId: subjectId } },
      });
      await database.pronunciationAssessment.deleteMany({
        where: { userId: subjectId },
      });
      await database.learnerProfile.deleteMany({
        where: { userId: subjectId },
      });
    });
  }
}
