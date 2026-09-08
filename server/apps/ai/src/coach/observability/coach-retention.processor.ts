import { Injectable } from '@nestjs/common';
import { LearningDataDeletionService } from '@libs/learning';
import { CheckpointPurgeService } from './checkpoint-purge.service';
import type { CoachRetentionRepository } from './coach-retention.service';

export type CoachDeletionJob = Readonly<{
  tombstoneId: string;
  subjectId: string;
  checkpointThreadIds: readonly string[];
  purgeAfter: Date;
}>;

@Injectable()
export class CoachRetentionProcessor {
  constructor(
    private readonly repository: CoachRetentionRepository,
    private readonly checkpoints: CheckpointPurgeService,
    private readonly learningDeletion: LearningDataDeletionService,
  ) {}

  async process(job: CoachDeletionJob): Promise<void> {
    await this.checkpoints.deleteThreads(job.checkpointThreadIds);
    await this.learningDeletion.purgeOwnedData(job.subjectId);
    await this.repository.purgeSubject(job.subjectId);
    await this.repository.completeTombstone(job.tombstoneId, new Date());
  }

  async processDue(now: Date): Promise<void> {
    const jobs = await this.repository.claimDueDeletionJobs(now);
    for (const job of jobs) {
      await this.checkpoints.deleteThreads(job.checkpointThreadIds);
      if (job.scope === 'COACH_DATA') {
        await this.learningDeletion.purgeOwnedData(job.subjectId);
        await this.repository.purgeSubject(job.subjectId);
      } else {
        await this.repository.purgeConversation(
          job.subjectId,
          job.conversationId,
        );
      }
      await this.repository.completeTombstone(job.tombstoneId, new Date());
    }
  }
}
