import { CoachExecutionContext } from '@libs/shared';
import { CoachApiService } from '../../src/coach/api/coach-api.service';

const context = new CoachExecutionContext('user-a', 1_900_000_000);
const request = {
  id: 'request_queue_001',
  subjectId: 'user-a',
  conversationId: 'conversation-a',
  clientRequestKey: 'request-key-000001',
  requestBodyHash: 'hash',
  inputPayload: { type: 'MESSAGE', message: 'Explain went.' },
  inputType: 'MESSAGE',
  status: 'CREATED',
  deadlineAt: new Date('2030-01-01T00:01:00.000Z'),
  createdAt: new Date('2030-01-01T00:00:00.000Z'),
  updatedAt: new Date('2030-01-01T00:00:00.000Z'),
};

function fixture() {
  const requests = {
    create: jest
      .fn()
      .mockResolvedValueOnce({ replayed: false, request })
      .mockResolvedValue({
        replayed: true,
        request: { ...request, status: 'QUEUED' },
      }),
    transition: jest.fn(async () => ({ ...request, status: 'QUEUED' })),
  };
  const queue = { enqueue: jest.fn() };
  const admission = {
    consumeSubject: jest.fn(async () => undefined),
    acquireSubject: jest.fn(async () => undefined),
    releaseSubject: jest.fn(async () => undefined),
  };
  const retention = { assertSubjectActive: jest.fn(async () => undefined) };
  const service = new CoachApiService(
    {} as never,
    {} as never,
    requests as never,
    queue as never,
    { success: (value: unknown) => value } as never,
    { publishConnected: jest.fn(async () => undefined) } as never,
    {} as never,
    {} as never,
    {} as never,
    retention as never,
    admission as never,
  );
  return { service, requests, queue, admission };
}

describe('Coach API admission lease lifecycle', () => {
  it('releases admission after enqueue failure and safely re-enqueues the same queued request', async () => {
    const test = fixture();
    test.queue.enqueue
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(
      test.service.createRequest(
        context,
        'conversation-a',
        { type: 'MESSAGE', message: 'Explain went.' },
        'request-key-000001',
      ),
    ).rejects.toThrow('queue unavailable');
    expect(test.admission.releaseSubject).toHaveBeenCalledWith(
      'user-a',
      'request_queue_001',
    );

    await expect(
      test.service.createRequest(
        context,
        'conversation-a',
        { type: 'MESSAGE', message: 'Explain went.' },
        'request-key-000001',
      ),
    ).resolves.toMatchObject({
      requestId: 'request_queue_001',
      status: 'QUEUED',
    });
    expect(test.queue.enqueue).toHaveBeenCalledTimes(2);
    expect(test.admission.consumeSubject).toHaveBeenCalledTimes(2);
    expect(test.admission.acquireSubject).toHaveBeenCalledTimes(2);
    expect(test.admission.releaseSubject).toHaveBeenCalledTimes(1);
  });

  it('applies subject admission to retries and releases it when enqueue fails', async () => {
    const test = fixture();
    const retry = (
      test.service as unknown as {
        retry: { retry: jest.Mock };
      }
    ).retry;
    retry.retry = jest.fn(async () => ({
      replayed: false,
      request: { ...request, id: 'request_retry_001', status: 'QUEUED' },
    }));
    test.queue.enqueue.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(
      test.service.retryRequest(
        context,
        'request-source-001',
        'retry-key-000001',
      ),
    ).rejects.toThrow('queue unavailable');
    expect(test.admission.consumeSubject).toHaveBeenCalledWith('user-a');
    expect(test.admission.acquireSubject).toHaveBeenCalledWith(
      'user-a',
      'request_retry_001',
    );
    expect(test.admission.releaseSubject).toHaveBeenCalledWith(
      'user-a',
      'request_retry_001',
    );
  });
});
