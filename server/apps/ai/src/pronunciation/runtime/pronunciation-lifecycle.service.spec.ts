import { PronunciationLifecycleService } from './pronunciation-lifecycle.service';

function setup() {
  const prisma = {
    pronunciationAssessment: {
      updateMany: jest.fn(),
      findMany: jest.fn(async () => [{ id: 'assessment-1', userId: 'owner' }]),
    },
    pronunciationDeletionTombstone: { findMany: jest.fn(async () => []) },
  };
  const adapters = {
    config: {
      providerEnabled: true,
      captureEnabled: true,
      storageApproved: true,
      learningWriteEnabled: true,
    },
  };
  const outbox = { dispatchBatch: jest.fn() };
  const cleanup = { processDue: jest.fn() };
  const processor = { worker: { run: jest.fn(async () => {}) } };
  const assessments = { recoverLearning: jest.fn() };
  const lifecycle = new PronunciationLifecycleService(
    prisma as never,
    adapters as never,
    outbox as never,
    cleanup as never,
    processor as never,
    assessments as never,
    {} as never,
    { get: () => 'local-test-pepper' } as never,
  );
  return {
    lifecycle,
    prisma,
    adapters,
    outbox,
    cleanup,
    processor,
    assessments,
  };
}

describe('pronunciation durable maintenance', () => {
  it('expires abandoned work, redispatches queued work and recovers learning without provider replay', async () => {
    const s = setup();
    const now = new Date();
    await s.lifecycle.tick(now);
    expect(s.prisma.pronunciationAssessment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deadlineAt: { lte: now },
          hiddenAt: null,
        }),
        data: expect.objectContaining({ status: 'TIMED_OUT' }),
      }),
    );
    expect(s.outbox.dispatchBatch).toHaveBeenCalledTimes(1);
    expect(s.assessments.recoverLearning).toHaveBeenCalledWith(
      'owner',
      'assessment-1',
    );
    expect(s.cleanup.processDue).toHaveBeenCalledWith(now);
    await s.lifecycle.tick(new Date(now.getTime() + 1000));
    expect(s.outbox.dispatchBatch).toHaveBeenCalledTimes(2);
    expect(s.cleanup.processDue).toHaveBeenCalledTimes(1);
  });
  it('keeps deletion maintenance running while provider calls are disabled', async () => {
    const s = setup();
    s.adapters.config.providerEnabled = false;
    s.adapters.config.learningWriteEnabled = false;
    await s.lifecycle.tick();
    expect(s.outbox.dispatchBatch).not.toHaveBeenCalled();
    expect(s.assessments.recoverLearning).not.toHaveBeenCalled();
    expect(s.cleanup.processDue).toHaveBeenCalledTimes(1);
  });
  it('does not start workers or timers when all runtime capabilities are off', async () => {
    const s = setup();
    Object.keys(s.adapters.config).forEach((key) => {
      s.adapters.config[key as keyof typeof s.adapters.config] = false;
    });
    s.lifecycle.onApplicationBootstrap();
    await s.lifecycle.onModuleDestroy();
    expect(s.processor.worker.run).not.toHaveBeenCalled();
    expect(s.prisma.pronunciationAssessment.updateMany).not.toHaveBeenCalled();
  });
});
