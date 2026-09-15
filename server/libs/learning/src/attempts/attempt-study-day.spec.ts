import { PrismaAttemptRepository } from './attempt.service';
describe('Coach attempt participation transaction', () => {
  it('saves the day in the same transaction as a new attempt', async () => {
    const tx = {
      learningAttempt: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: { update: jest.fn() },
    };
    const repo = new PrismaAttemptRepository({
      $transaction: async (fn: any) => fn(tx),
    } as never);
    await repo.transaction((t) =>
      t.createAttempt({
        id: 'attempt-1',
        subjectId: 'user-a',
        savedAt: new Date('2026-09-15T00:00:00Z'),
      } as any),
    );
    expect(tx.learningAttempt.create).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-a' },
        data: { dayNumber: { increment: 1 } },
      }),
    );
  });
  it('does not count an unsuccessful attempt write', async () => {
    const tx = {
      learningAttempt: {
        create: jest.fn().mockRejectedValue(new Error('write failed')),
      },
      $executeRaw: jest.fn(),
      user: { update: jest.fn() },
    };
    const repo = new PrismaAttemptRepository({
      $transaction: async (fn: any) => fn(tx),
    } as never);
    await expect(
      repo.transaction((t) => t.createAttempt({ subjectId: 'user-a' } as any)),
    ).rejects.toThrow('write failed');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
