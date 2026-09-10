import { createHmac } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  LearningDataDeletionService,
  type PronunciationAccountDataCleanup,
} from '@libs/learning';
import { PrismaService } from '@libs/shared';
import type { PronunciationAudioStorage } from '../storage/pronunciation-audio.storage';

@Injectable()
export class PronunciationAccountCleanupService
  implements PronunciationAccountDataCleanup, OnModuleInit
{
  constructor(
    private readonly learningDeletion: LearningDataDeletionService,
    private readonly prisma: PrismaService,
    private readonly storage: Pick<
      PronunciationAudioStorage,
      'revoke' | 'purge'
    >,
    private readonly pepper = process.env.PRONUNCIATION_TRACE_PEPPER ??
      process.env.JWT_SECRET ??
      '',
  ) {}

  onModuleInit(): void {
    this.learningDeletion.configurePronunciationCleanup(this);
  }

  async revokeAudioAccess(subjectId: string): Promise<void> {
    const assets = await this.prisma.pronunciationAudioAsset.findMany({
      where: { userId: subjectId, purgedAt: null },
      select: { objectKey: true },
    });
    for (const asset of assets) {
      await this.storage.revoke(asset.objectKey).catch(() => undefined);
    }
  }

  async purgeCaches(_subjectId: string): Promise<void> {
    // Pronunciation currently keeps no result/audio cache.
  }

  async revokeTemporaryLinks(_subjectId: string): Promise<void> {
    // Playback uses freshly authenticated direct reads; no presigned link exists.
  }

  async unlinkTraceSubject(subjectId: string): Promise<void> {
    await this.prisma.traceSubjectMapping.deleteMany({
      where: { userId: subjectId },
    });
  }

  async purgeAudioObjects(subjectId: string): Promise<void> {
    const assets = await this.prisma.pronunciationAudioAsset.findMany({
      where: { userId: subjectId, purgedAt: null },
      select: { id: true, objectKey: true },
    });
    for (const asset of assets) await this.storage.purge(asset.objectKey);
    await this.prisma.pronunciationAudioAsset.updateMany({
      where: { id: { in: assets.map((asset) => asset.id) } },
      data: { status: 'PURGED', purgedAt: new Date() },
    });
    if (this.pepper.trim()) {
      const subjectHash = createHmac('sha256', this.pepper)
        .update(`subject\0${subjectId}`)
        .digest('hex');
      await this.prisma.pronunciationDeletionTombstone.updateMany({
        where: { subjectHash, status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED', completedAt: new Date(), claimedAt: null },
      });
    }
  }
}
