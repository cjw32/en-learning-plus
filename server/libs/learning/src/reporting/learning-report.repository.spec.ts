import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaLearningReportRepository } from './learning-report.repository';

describe('PrismaLearningReportRepository', () => {
  it('uses user-scoped queries and stable tie-break ordering without a fallback', async () => {
    const prisma = {
      learnerProfile: {
        findUnique: jest.fn(async () => ({ timezone: 'Asia/Shanghai' })),
      },
      learningAttempt: { findMany: jest.fn(async () => []) },
      learningItemState: { findMany: jest.fn(async () => []) },
      wordBookRecord: { count: jest.fn(async () => 0) },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    const repository = new PrismaLearningReportRepository(prisma as never);
    await expect(repository.getTimezone('learner_a')).resolves.toBe(
      'Asia/Shanghai',
    );
    await repository.loadSnapshot({
      userId: 'learner_a',
      timezone: 'Asia/Shanghai',
      learningDate: '2026-09-11',
      windowStart: '2026-09-05',
      windowEnd: '2026-09-11',
    });

    expect(prisma.learnerProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'learner_a' },
      select: { timezone: true },
    });
    expect(prisma.learningAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'learner_a' }),
        orderBy: [{ savedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(prisma.learningItemState.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'learner_a' }),
        orderBy: [{ dueAt: 'asc' }, { targetKey: 'asc' }],
      }),
    );
    expect(prisma.wordBookRecord.count).toHaveBeenCalledWith({
      where: { userId: 'learner_a', isMaster: true },
    });
  });

  it('does not import MCP transport/request types or issue unscoped queries', () => {
    const source = readFileSync(
      resolve(__dirname, 'learning-report.repository.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/apps\/ai|mcp\/transport|McpRequestContext/);
    expect(source).not.toMatch(/findMany\(\{\s*(?:select|orderBy)/u);
  });
});
