export const SM2_VERSION = 'SM2_V1' as const;

export type Sm2ReviewState = {
  reviewState: 'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED';
  repetitionCount: number;
  easeFactor: number;
  intervalDays: number;
  dueAt?: Date;
};

export type Sm2Transition = Omit<Sm2ReviewState, 'dueAt' | 'reviewState'> & {
  reviewState: 'LEARNING' | 'REVIEW' | 'MASTERED';
  dueAt: Date;
  version: typeof SM2_VERSION;
};

function assertQuality(quality: number) {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new Error('SM-2 quality must be an integer from 0 to 5');
  }
}

export function aggregateLowestQuality(qualities: readonly number[]): number {
  if (qualities.length === 0) throw new Error('Target quality is required');
  for (const quality of qualities) assertQuality(quality);
  return Math.min(...qualities);
}

function assertTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new Error('Invalid IANA timezone');
  }
}

function localDateAt(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function zonedStartOfDay(date: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
    );
    guess += target - represented;
  }
  return new Date(guess);
}

export function scheduleSm2Review(input: {
  current: Sm2ReviewState;
  quality: number;
  reviewedAt: Date;
  timezone: string;
}): Sm2Transition {
  assertQuality(input.quality);
  assertTimeZone(input.timezone);
  if (Number.isNaN(input.reviewedAt.getTime())) {
    throw new Error('reviewedAt must be valid');
  }
  const delta = 0.1 - (5 - input.quality) * (0.08 + (5 - input.quality) * 0.02);
  const easeFactor = Math.max(
    1.3,
    Math.round((input.current.easeFactor + delta) * 100) / 100,
  );

  let repetitionCount: number;
  let intervalDays: number;
  let reviewState: Sm2Transition['reviewState'];
  if (input.quality < 3) {
    repetitionCount = 0;
    intervalDays = 1;
    reviewState = 'LEARNING';
  } else {
    repetitionCount = input.current.repetitionCount + 1;
    intervalDays =
      repetitionCount === 1
        ? 1
        : repetitionCount === 2
          ? 6
          : Math.ceil(input.current.intervalDays * easeFactor);
    reviewState =
      repetitionCount >= 3 && input.quality >= 4 && intervalDays >= 30
        ? 'MASTERED'
        : 'REVIEW';
  }
  const reviewedLocalDate = localDateAt(input.reviewedAt, input.timezone);
  return {
    version: SM2_VERSION,
    reviewState,
    repetitionCount,
    easeFactor,
    intervalDays,
    dueAt: zonedStartOfDay(
      addCalendarDays(reviewedLocalDate, intervalDays),
      input.timezone,
    ),
  };
}
