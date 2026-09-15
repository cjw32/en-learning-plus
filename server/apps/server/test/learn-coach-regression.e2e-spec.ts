import { ResponseService } from '@libs/shared';
import { LegacyReviewInitializerService } from '@libs/learning';
import { LearnService } from '../src/learn/learn.service';

function fixture() {
  const records = new Set<string>();
  const states = new Map<string, Record<string, unknown>>();
  let wordNumber = 0;
  let dayNumber = 0;
  const days = new Set<string>();
  const transaction = {
    $executeRaw: jest.fn(async (sql: any) => {
      const key = sql.values.slice(0, 2).join(":");
      if (days.has(key)) return 0;
      days.add(key); return 1;
    }),
    wordBookRecord: {
      createMany: jest.fn(
        async ({
          data,
        }: {
          data: Array<{ userId: string; wordId: string }>;
        }) => {
          let count = 0;
          for (const record of data) {
            const key = `${record.userId}:${record.wordId}`;
            if (!records.has(key)) {
              records.add(key);
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    learnerProfile: {
      findUnique: jest.fn(async () => ({ timezone: 'Asia/Shanghai' })),
    },
    learningItemState: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const key = `${where.userId_targetType_targetKey.userId}:${where.userId_targetType_targetKey.targetKey}`;
        if (!states.has(key)) states.set(key, create);
        return states.get(key);
      }),
    },
    user: {
      update: jest.fn(async ({ data }: any) => {
        wordNumber += data.wordNumber?.increment ?? 0;
        dayNumber += data.dayNumber?.increment ?? 0;
        return { wordNumber, dayNumber };
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      async (operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
    ),
    courseRecord: { findFirst: jest.fn() },
    wordBook: { findMany: jest.fn() },
  };
  const initializer = new LegacyReviewInitializerService(
    prisma as never,
    () => new Date('2026-09-02T10:00:00.000Z'),
  );
  return {
    records,
    states,
    transaction,
    service: new LearnService(
      prisma as never,
      new ResponseService(),
      initializer,
    ),
  };
}

describe('legacy learn flow remains compatible with Coach state', () => {
  it('keeps the ten-word response contract and initializes review state atomically', async () => {
    const test = fixture();
    const wordIds = Array.from({ length: 10 }, (_, index) => `word-${index}`);
    await expect(
      test.service.saveWordMaster(wordIds, 'user-a'),
    ).resolves.toEqual({
      data: { wordNumber: 10, dayNumber: 1 },
      code: 0,
      message: 'Success',
    });
    expect(test.records.size).toBe(10);
    expect(test.states.size).toBe(10);
    expect(test.transaction.learningItemState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          reviewState: 'REVIEW',
          repetitionCount: 1,
          intervalDays: 1,
        }),
      }),
    );
  });

  it('deduplicates repeated IDs and repeat requests without inflating wordNumber', async () => {
    const test = fixture();
    const ids = ['word-1', 'word-1', 'word-2'];
    expect((await test.service.saveWordMaster(ids, 'user-a')).data).toEqual({
      wordNumber: 2,
      dayNumber: 1,
    });
    expect((await test.service.saveWordMaster(ids, 'user-a')).data).toEqual({
      wordNumber: 2,
      dayNumber: 1,
    });
    expect(test.records.size).toBe(2);
    expect(test.states.size).toBe(2);
  });
});
