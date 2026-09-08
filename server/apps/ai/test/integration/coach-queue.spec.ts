import { Job, Queue } from 'bullmq';
import {
  COACH_EXECUTE_JOB,
  CoachQueueService,
  createCoachJobData,
} from '../../src/coach/queue/coach.queue';
import {
  CoachProcessor,
  CoachRequestExecutor,
} from '../../src/coach/queue/coach.processor';

describe('Coach queue boundary', () => {
  it('uses requestId as jobId and stores no identity or secret fields', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'request_00001' });
    const service = new CoachQueueService({ add } as unknown as Queue);

    await service.enqueue('request_00001');
    await service.enqueue('request_00001');

    expect(add).toHaveBeenCalledTimes(2);
    for (const call of add.mock.calls) {
      expect(call).toEqual([
        COACH_EXECUTE_JOB,
        { requestId: 'request_00001' },
        expect.objectContaining({ jobId: 'request_00001', attempts: 1 }),
      ]);
      expect(JSON.stringify(call)).not.toMatch(
        /userId|authorization|bearer|jwt|apiKey|prompt/i,
      );
    }
  });

  it('validates the payload and dispatches only the opaque request ID', async () => {
    const executor: CoachRequestExecutor = {
      executeRequest: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new CoachProcessor(executor);
    await processor.process({
      id: 'request_00001',
      name: COACH_EXECUTE_JOB,
      data: createCoachJobData('request_00001'),
    } as Job);
    expect(executor.executeRequest).toHaveBeenCalledWith('request_00001');
  });

  it('rejects mismatched job identity and extra payload fields', async () => {
    const executor: CoachRequestExecutor = {
      executeRequest: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new CoachProcessor(executor);
    await expect(
      processor.process({
        id: 'request_00002',
        name: COACH_EXECUTE_JOB,
        data: { requestId: 'request_00001', userId: 'user-b' },
      } as unknown as Job),
    ).rejects.toThrow();
    expect(executor.executeRequest).not.toHaveBeenCalled();
  });
});
