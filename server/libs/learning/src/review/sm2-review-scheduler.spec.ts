import {
  aggregateLowestQuality,
  scheduleSm2Review,
} from './sm2-review-scheduler';

const base = {
  reviewState: 'NEW' as const,
  repetitionCount: 0,
  easeFactor: 2.5,
  intervalDays: 0,
};

describe('SM2_V1 review scheduler', () => {
  it.each([0, 1, 2] as const)('resets the sequence for q=%s', (quality) => {
    const result = scheduleSm2Review({
      current: { ...base, repetitionCount: 4, intervalDays: 30 },
      quality,
      reviewedAt: new Date('2026-09-02T12:00:00.000Z'),
      timezone: 'Asia/Shanghai',
    });
    expect(result).toMatchObject({
      reviewState: 'LEARNING',
      repetitionCount: 0,
      intervalDays: 1,
    });
    expect(result.dueAt.toISOString()).toBe('2026-09-02T16:00:00.000Z');
  });

  it('uses 1, 6, then ceil(previous interval × new EF)', () => {
    const first = scheduleSm2Review({
      current: base,
      quality: 5,
      reviewedAt: new Date('2026-09-02T02:00:00.000Z'),
      timezone: 'Asia/Shanghai',
    });
    const second = scheduleSm2Review({
      current: first,
      quality: 4,
      reviewedAt: new Date('2026-09-03T02:00:00.000Z'),
      timezone: 'Asia/Shanghai',
    });
    const third = scheduleSm2Review({
      current: second,
      quality: 4,
      reviewedAt: new Date('2026-09-09T02:00:00.000Z'),
      timezone: 'Asia/Shanghai',
    });
    expect([first.intervalDays, second.intervalDays, third.intervalDays]).toEqual([
      1,
      6,
      Math.ceil(6 * third.easeFactor),
    ]);
  });

  it('never lowers EF below 1.3 and masters only at the explicit threshold', () => {
    let current: Parameters<typeof scheduleSm2Review>[0]['current'] = {
      ...base,
      easeFactor: 1.3,
    };
    for (let index = 0; index < 3; index += 1) {
      current = scheduleSm2Review({
        current,
        quality: 3,
        reviewedAt: new Date(`2026-09-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`),
        timezone: 'UTC',
      });
    }
    expect(current.easeFactor).toBe(1.3);
    expect(current.reviewState).toBe('REVIEW');

    const mastered = scheduleSm2Review({
      current: {
        reviewState: 'REVIEW',
        repetitionCount: 3,
        easeFactor: 2.5,
        intervalDays: 15,
      },
      quality: 5,
      reviewedAt: new Date('2026-09-20T00:00:00.000Z'),
      timezone: 'UTC',
    });
    expect(mastered.intervalDays).toBe(39);
    expect(mastered.reviewState).toBe('MASTERED');
  });

  it('aggregates duplicate target evidence with the lowest valid quality', () => {
    expect(aggregateLowestQuality([5, 2, 4])).toBe(2);
    expect(() => aggregateLowestQuality([])).toThrow();
    expect(() => aggregateLowestQuality([6])).toThrow();
  });
});
