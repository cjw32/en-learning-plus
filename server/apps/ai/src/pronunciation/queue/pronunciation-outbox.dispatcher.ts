import { Injectable } from '@nestjs/common';
import { PronunciationRepository } from '../application/pronunciation.repository';
import { PronunciationQueueService } from './pronunciation.queue';

@Injectable()
export class PronunciationOutboxDispatcher {
  constructor(
    private readonly repository: PronunciationRepository,
    private readonly queue: PronunciationQueueService,
  ) {}

  async dispatchBatch(limit = 25): Promise<
    Readonly<{
      selected: number;
      dispatched: number;
      failed: number;
    }>
  > {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('PRONUNCIATION_OUTBOX_LIMIT_INVALID');
    }
    const assessmentIds = await this.repository.findQueuedAssessmentIds(limit);
    let dispatched = 0;
    let failed = 0;
    for (const assessmentId of assessmentIds) {
      try {
        await this.queue.enqueue(assessmentId);
        dispatched += 1;
      } catch {
        // QUEUED remains the durable outbox record for the next dispatch pass.
        failed += 1;
      }
    }
    return Object.freeze({
      selected: assessmentIds.length,
      dispatched,
      failed,
    });
  }
}
