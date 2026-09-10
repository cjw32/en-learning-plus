import type { Job, Queue } from 'bullmq';
import type { PronunciationRepository } from '../../src/pronunciation/application/pronunciation.repository';
import { PronunciationOutboxDispatcher } from '../../src/pronunciation/queue/pronunciation-outbox.dispatcher';
import {
  PRONUNCIATION_ASSESSMENT_JOB,
  PronunciationQueueService,
  parsePronunciationQueuePayload,
  type PronunciationQueuePayload,
} from '../../src/pronunciation/queue/pronunciation.queue';
import { PronunciationProcessor } from '../../src/pronunciation/queue/pronunciation.processor';

describe('pronunciation durable ID-only queue', () => {
  it('accepts exactly one opaque assessmentId field', () => {
    expect(
      parsePronunciationQueuePayload({ assessmentId: 'assessment_1' }),
    ).toEqual({
      assessmentId: 'assessment_1',
    });
    for (const payload of [
      {},
      { assessmentId: 'assessment_1', userId: 'user-1' },
      { assessmentId: 'assessment_1', audio: [1, 2, 3] },
      { assessmentId: 'assessment_1', referenceText: 'hello' },
    ])
      expect(() => parsePronunciationQueuePayload(payload)).toThrow(
        'PRONUNCIATION_QUEUE_PAYLOAD_INVALID',
      );
  });

  it('uses the durable QUEUED row as outbox and a stable Bull job id', async () => {
    const jobs = new Map<string, unknown>();
    const add = jest.fn(async (_name, data, options) => {
      jobs.set(String(options?.jobId), data);
      return {};
    });
    const repository = {
      findQueuedAssessmentIds: jest.fn().mockResolvedValue(['assessment_1']),
    } as unknown as PronunciationRepository;
    const queue = new PronunciationQueueService({
      add,
    } as unknown as Queue<PronunciationQueuePayload>);
    const dispatcher = new PronunciationOutboxDispatcher(repository, queue);

    await dispatcher.dispatchBatch();
    await dispatcher.dispatchBatch();
    expect(add).toHaveBeenCalledTimes(2);
    expect(jobs).toEqual(
      new Map([['assessment_1', { assessmentId: 'assessment_1' }]]),
    );
    expect(JSON.stringify([...jobs.values()])).not.toMatch(
      /user|audio|referenceText/i,
    );
  });

  it('uses database CAS so crash replay cannot duplicate a call or result', async () => {
    let status = 'QUEUED';
    const repository = {
      claimQueuedForProcessing: jest.fn(async () => {
        if (status !== 'QUEUED') return false;
        status = 'PROCESSING';
        return true;
      }),
    } as unknown as PronunciationRepository;
    const executor = {
      executeAssessment: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new PronunciationProcessor(
      repository,
      executor,
      () => new Date('2026-09-10T00:00:00Z'),
    );
    const job = {
      id: 'assessment_1',
      name: PRONUNCIATION_ASSESSMENT_JOB,
      data: { assessmentId: 'assessment_1' },
    } as Job<PronunciationQueuePayload>;

    await processor.process(job);
    await processor.process(job);
    expect(executor.executeAssessment).toHaveBeenCalledTimes(1);
    expect(repository.claimQueuedForProcessing).toHaveBeenCalledTimes(2);
  });

  it('rejects mismatched job IDs before database or Provider work', async () => {
    const repository = {
      claimQueuedForProcessing: jest.fn(),
    } as unknown as PronunciationRepository;
    const executor = { executeAssessment: jest.fn() };
    const processor = new PronunciationProcessor(repository, executor);
    await expect(
      processor.process({
        id: 'other',
        name: PRONUNCIATION_ASSESSMENT_JOB,
        data: { assessmentId: 'assessment_1' },
      } as Job<PronunciationQueuePayload>),
    ).rejects.toThrow('PRONUNCIATION_QUEUE_JOB_ID_MISMATCH');
    expect(repository.claimQueuedForProcessing).not.toHaveBeenCalled();
    expect(executor.executeAssessment).not.toHaveBeenCalled();
  });
});
