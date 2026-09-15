import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@libs/shared';
import { PronunciationLearningDeletionService } from '@libs/learning';
import { createHmac } from 'node:crypto';
import { PronunciationRuntimeAdapters } from './pronunciation-runtime.adapters';
import { PronunciationOutboxDispatcher } from '../queue/pronunciation-outbox.dispatcher';
import { PronunciationCleanupProcessor } from '../queue/pronunciation-cleanup.processor';
import { PronunciationProcessor } from '../queue/pronunciation.processor';
import { PronunciationAssessmentService } from '../application/pronunciation-assessment.service';

@Injectable()
export class PronunciationLifecycleService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PronunciationLifecycleService.name);
  private timer?: ReturnType<typeof setInterval>;
  private inFlight: Promise<void> | null = null;
  private lastCleanupAt = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: PronunciationRuntimeAdapters,
    private readonly outbox: PronunciationOutboxDispatcher,
    private readonly cleanup: PronunciationCleanupProcessor,
    private readonly processor: PronunciationProcessor,
    private readonly assessments: PronunciationAssessmentService,
    private readonly learningDeletion: PronunciationLearningDeletionService,
    private readonly environment: ConfigService,
  ) {}
  onApplicationBootstrap() {
    if (this.adapters.config.providerEnabled) {
      void this.processor.worker
        .run()
        .catch(() => this.logger.error('Pronunciation worker stopped'));
    }
    if (
      !this.adapters.config.captureEnabled &&
      !this.adapters.config.storageApproved
    )
      return;
    const run = () => {
      if (this.inFlight) return;
      this.inFlight = this.tick()
        .catch(() => this.logger.warn('Pronunciation maintenance will retry'))
        .finally(() => {
          this.inFlight = null;
        });
    };
    run();
    this.timer = setInterval(run, 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }

  async tick(now = new Date()) {
    await this.prisma.pronunciationAssessment.updateMany({
      where: {
        status: {
          in: [
            'CREATED',
            'AUDIO_VALIDATING',
            'AUDIO_READY',
            'QUEUED',
            'PROCESSING',
          ],
        },
        deadlineAt: { lte: now },
        hiddenAt: null,
      },
      data: {
        status: 'TIMED_OUT',
        publicErrorCode: 'REQUEST_TIMEOUT',
        finishedAt: now,
      },
    });
    if (this.adapters.config.providerEnabled) await this.outbox.dispatchBatch();
    if (now.getTime() - this.lastCleanupAt < 30000) return;
    this.lastCleanupAt = now.getTime();
    if (this.adapters.config.learningWriteEnabled) {
      const pending = await this.prisma.pronunciationAssessment.findMany({
        where: {
          status: 'COMPLETED',
          hiddenAt: null,
          learningWriteStatus: { in: ['PENDING', 'FAILED'] },
          updatedAt: { lt: new Date(now.getTime() - 30000) },
        },
        select: { id: true, userId: true },
        orderBy: { updatedAt: 'asc' },
        take: 20,
      });
      for (const item of pending)
        await this.assessments.recoverLearning(item.userId, item.id);
    }
    await this.retryCompensation();
    if (this.adapters.config.storageApproved)
      await this.cleanup.processDue(now);
  }
  private async retryCompensation() {
    const pepper = this.environment.get<string>('PRONUNCIATION_TRACE_PEPPER');
    if (!pepper) return;
    const pending = await this.prisma.pronunciationDeletionTombstone.findMany({
      where: {
        OR: [
          { status: 'COMPENSATING' },
          { status: 'FAILED', failureCode: 'COMPENSATION_RETRY' },
        ],
      },
      select: { id: true, resourceHash: true },
      orderBy: { requestedAt: 'asc' },
      take: 20,
    });
    if (!pending.length) return;
    const candidates = await this.prisma.pronunciationAssessment.findMany({
      where: { hiddenAt: { not: null }, learningAttempt: { isNot: null } },
      select: { id: true, learningAttempt: { select: { id: true } } },
    });
    for (const tombstone of pending) {
      const item = candidates.find(
        (candidate) =>
          createHmac('sha256', pepper)
            .update(`assessment\0${candidate.id}`)
            .digest('hex') === tombstone.resourceHash,
      );
      if (!item?.learningAttempt) continue;
      try {
        await this.learningDeletion.compensate({
          deletionId: tombstone.id,
          deletedAttemptId: item.learningAttempt.id,
          reviewedTimezone: 'UTC',
        });
      } catch {
        this.logger.warn('Pronunciation learning compensation will retry');
      }
    }
  }
}
