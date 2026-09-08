import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export const COACH_QUEUE_NAME = 'COACH_REQUEST_QUEUE';
export const COACH_EXECUTE_JOB = 'EXECUTE_COACH_REQUEST';

export type CoachJobData = Readonly<{ requestId: string }>;

export function createCoachJobData(requestId: string): CoachJobData {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(requestId)) {
    throw new Error('Invalid Coach request ID');
  }
  return Object.freeze({ requestId });
}

export function parseCoachJobData(data: unknown): CoachJobData {
  if (
    !data ||
    typeof data !== 'object' ||
    Object.keys(data).length !== 1 ||
    !Object.hasOwn(data, 'requestId')
  ) {
    throw new Error('Invalid Coach job payload');
  }
  return createCoachJobData((data as { requestId: string }).requestId);
}

@Injectable()
export class CoachQueueService {
  constructor(
    @InjectQueue(COACH_QUEUE_NAME)
    private readonly queue: Queue<CoachJobData>,
  ) {}

  enqueue(requestId: string) {
    const data = createCoachJobData(requestId);
    return this.queue.add(COACH_EXECUTE_JOB, data, {
      jobId: requestId,
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }
}
