import { recordStudyDay, studyDate } from './study-day';
describe('study day boundaries and atomic accounting', () => {
  it('uses Beijing midnight independently of server and learner timezone', () => {
    expect(studyDate(new Date('2026-09-15T15:59:59.999Z'))).toBe('2026-09-15');
    expect(studyDate(new Date('2026-09-15T16:00:00Z'))).toBe('2026-09-16');
    expect(studyDate(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });
  it('increments only on a newly inserted account/day and binds user input', async () => {
    const database = {
      $executeRaw: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      user: { update: jest.fn() },
    };
    const now = new Date('2026-09-15T00:00:00Z');
    expect(await recordStudyDay(database as never, 'user-a', now)).toBe(true);
    expect(await recordStudyDay(database as never, 'user-a', now)).toBe(false);
    expect(database.user.update).toHaveBeenCalledTimes(1);
    expect(database.$executeRaw.mock.calls[0][0].values).toEqual([
      'user-a',
      '2026-09-15',
      now,
    ]);
  });
  it('propagates write errors to the enclosing learning transaction', async () => {
    const database = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: { update: jest.fn().mockRejectedValue(new Error('rollback')) },
    };
    await expect(recordStudyDay(database as never, 'user-a')).rejects.toThrow(
      'rollback',
    );
  });
});
