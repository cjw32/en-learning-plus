import type { Job } from 'bullmq';
import type { PronunciationRepository } from '../../src/pronunciation/application/pronunciation.repository';
import {
  PRONUNCIATION_ASSESSMENT_JOB,
  type PronunciationQueuePayload,
} from '../../src/pronunciation/queue/pronunciation.queue';
import { PronunciationProcessor } from '../../src/pronunciation/queue/pronunciation.processor';

type CounterName = 'provider' | 'result' | 'learning' | 'cost' | 'trace';

function recoveryHarness(crashAfter: CounterName) {
  let status = 'QUEUED';
  const counters: Record<CounterName, number> = {
    provider: 0,
    result: 0,
    learning: 0,
    cost: 0,
    trace: 0,
  };
  const repository = {
    claimQueuedForProcessing: jest.fn(async () => {
      if (status !== 'QUEUED') return false;
      status = 'PROCESSING';
      return true;
    }),
    markProcessingFailed: jest.fn(async () => {
      if (status !== 'PROCESSING') return false;
      status = 'FAILED';
      counters.trace += 1;
      return true;
    }),
  } as unknown as PronunciationRepository;
  const order: CounterName[] = [
    'provider',
    'cost',
    'result',
    'learning',
    'trace',
  ];
  const executor = {
    executeAssessment: jest.fn(async () => {
      for (const step of order) {
        counters[step] += 1;
        if (step === 'result') status = 'COMPLETED';
        if (step === crashAfter) throw new Error(`crash-after-${step}`);
      }
    }),
  };
  const processor = new PronunciationProcessor(
    repository,
    executor,
    () => new Date('2026-09-10T00:00:10.000Z'),
  );
  const job = {
    id: 'assessment-1',
    name: PRONUNCIATION_ASSESSMENT_JOB,
    data: { assessmentId: 'assessment-1' },
  } as Job<PronunciationQueuePayload>;
  return { processor, job, counters, repository, status: () => status };
}

describe('pronunciation queue crash/replay/dead-letter recovery', () => {
  it('terminalizes a crash after a potentially billable Provider call exactly once', async () => {
    const harness = recoveryHarness('cost');
    await expect(harness.processor.process(harness.job)).rejects.toThrow(
      'crash-after-cost',
    );
    await expect(
      harness.processor.process(harness.job),
    ).resolves.toBeUndefined();
    expect(harness.status()).toBe('FAILED');
    expect(harness.counters).toEqual({
      provider: 1,
      cost: 1,
      result: 0,
      learning: 0,
      trace: 1,
    });
    expect(
      (harness.repository as any).markProcessingFailed,
    ).toHaveBeenCalledTimes(1);
  });

  it.each(['result', 'learning', 'trace'] as CounterName[])(
    'cannot duplicate durable side effects when a worker crashes after %s',
    async (crashAfter) => {
      const harness = recoveryHarness(crashAfter);
      await expect(harness.processor.process(harness.job)).rejects.toThrow();
      await expect(
        harness.processor.process(harness.job),
      ).resolves.toBeUndefined();
      expect(harness.counters.provider).toBe(1);
      expect(harness.counters.cost).toBe(1);
      expect(harness.counters.result).toBe(1);
      expect(harness.counters.learning).toBeLessThanOrEqual(1);
      expect(harness.counters.trace).toBeLessThanOrEqual(1);
      expect(
        (harness.repository as any).markProcessingFailed,
      ).toHaveBeenCalledTimes(1);
    },
  );
});
