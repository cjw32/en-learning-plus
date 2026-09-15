import { DigestService } from '../../src/digest/digest.service';
import { DigestProcessor } from '../../src/digest/digest.processor';
import { digestWindow } from '../../src/digest/digest-window';
import { digestQueueName } from '../../src/digest/digest.queue';
import { createAgent } from 'langchain';
jest.mock('langchain', () => ({ createAgent: jest.fn() }));
jest.mock('../../src/llm/llm.config', () => ({ createDeepSeek: jest.fn() }));
function fixture() {
  const user = {
    id: 'user',
    email: 'user@example.test',
    isTimingTask: true,
    timingTaskTime: '20:00:00',
    learnerProfile: { timezone: 'Asia/Shanghai' },
  };
  const prisma = {
    user: {
      findMany: jest.fn(async () => [user]),
      findUnique: jest.fn(async () => ({ ...user })),
    },
    wordBookRecord: {
      findMany: jest.fn(async () => [{ word: { word: 'hello' } }]),
    },
  };
  const queue = {
    add: jest.fn(),
    getRepeatableJobs: jest.fn(async () => [
      {
        name: digestQueueName.task.everyDayDigest,
        pattern: '0 0 * * *',
        key: 'old',
      },
    ]),
    removeRepeatableByKey: jest.fn(),
  };
  const service = new DigestService(prisma as any, queue as any);
  const invoke = jest.fn(async () => ({
    messages: [{ content: 'Learn <script>bad</script>' }],
  }));
  (createAgent as jest.Mock).mockReturnValue({ invoke });
  return { user, prisma, queue, service, invoke };
}
describe('Daily digest delivery windows', () => {
  it('selects the preceding daily period at the configured local time', () => {
    expect(
      digestWindow(
        new Date('2026-09-14T12:00:20Z'),
        'Asia/Shanghai',
        '20:00:00',
      ),
    ).toMatchObject({
      start: '2026-09-13T12:00:00.000Z',
      end: '2026-09-14T12:00:00.000Z',
      localDate: '2026-09-14',
    });
    expect(
      digestWindow(
        new Date('2026-09-14T00:00:00Z'),
        'Asia/Shanghai',
        '20:00:00',
      ),
    ).toBeNull();
    expect(
      digestWindow(
        new Date('2026-09-14T16:00:10Z'),
        'Asia/Shanghai',
        '23:59:30',
      )?.localDate,
    ).toBe('2026-09-14');
    expect(digestWindow(new Date(), 'invalid/zone', '20:00:00')).toBeNull();
  });
  it('uses wall-clock boundaries across daylight saving time', () => {
    const window = digestWindow(
      new Date('2026-03-08T13:00:00Z'),
      'America/New_York',
      '09:00:00',
    )!;
    expect(
      new Date(window.end).getTime() - new Date(window.start).getTime(),
    ).toBe(23 * 3600_000);
  });
  it('replaces midnight generation and uses stable per-user date IDs', async () => {
    const f = fixture();
    await f.service.onModuleInit();
    expect(f.queue.removeRepeatableByKey).toHaveBeenCalledWith('old');
    f.queue.add.mockClear();
    await f.service.handleEmailDigest(new Date('2026-09-14T12:00:00Z'));
    await f.service.handleEmailDigest(new Date('2026-09-14T12:00:30Z'));
    expect(f.queue.add.mock.calls.map((call) => call[2].jobId)).toEqual([
      'digest-user-2026-09-14',
      'digest-user-2026-09-14',
    ]);
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it('queries that user/window at delivery and does not disclose email or ID to the model', async () => {
    const f = fixture();
    await f.service.handleEmailDigest(new Date('2026-09-13T12:00:00Z'));
    const job = f.queue.add.mock.calls[0][1];
    const result = await f.service.prepareEmailDigest(job);
    expect(f.prisma.wordBookRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user',
          createdAt: {
            gte: new Date('2026-09-12T12:00:00Z'),
            lt: new Date('2026-09-13T12:00:00Z'),
          },
        },
      }),
    );
    const prompt = f.invoke.mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain('user@example.test');
    expect(prompt).not.toContain('userId');
    expect(result?.text).toContain('&lt;script&gt;');
  });
  it('discards legacy jobs and honors opt-out before and after generation', async () => {
    const f = fixture();
    expect(
      await f.service.prepareEmailDigest({ email: 'old' } as any),
    ).toBeNull();
    await f.service.handleEmailDigest(new Date('2026-09-13T12:00:00Z'));
    const job = f.queue.add.mock.calls[0][1];
    f.user.isTimingTask = false;
    expect(await f.service.prepareEmailDigest(job)).toBeNull();
    expect(f.invoke).not.toHaveBeenCalled();
    f.user.isTimingTask = true;
    f.invoke.mockImplementation(async () => {
      f.user.isTimingTask = false;
      return { messages: [{ content: 'report' }] };
    });
    expect(await f.service.prepareEmailDigest(job)).toBeNull();
  });
  it('does not mark failed email delivery successful', async () => {
    const processor = new DigestProcessor(
      {
        prepareEmailDigest: async () => ({ email: 'local@test', text: 'test' }),
      } as any,
      { sendEmail: async () => false } as any,
    );
    await expect(
      processor.process({
        name: digestQueueName.task.emailDigest,
        data: {},
      } as any),
    ).rejects.toThrow('delivery failed');
  });
});
