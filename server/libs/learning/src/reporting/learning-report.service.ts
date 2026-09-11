import type {
  LearningReportRepository,
  LearningReportSnapshot,
} from './learning-report.repository';

export class LearningReportServiceError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'DATA_NOT_AVAILABLE') {
    super(
      code === 'VALIDATION_FAILED'
        ? 'The report request is invalid.'
        : 'Learning report data is unavailable.',
    );
    this.name = 'LearningReportServiceError';
  }
}

type Options = Readonly<{
  now: () => Date;
  summaryWindowDays: number;
  weaknessStaleAfterDays: number;
  weaknessMinimumEvidence: number;
}>;

const defaultOptions: Options = Object.freeze({
  now: () => new Date(),
  summaryWindowDays: 7,
  weaknessStaleAfterDays: 14,
  weaknessMinimumEvidence: 2,
});

function isoDateAt(date: Date, timezone: string): string {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(date)
        .filter(({ type }) => type !== 'literal')
        .map(({ type, value }) => [type, value]),
    );
    if (!parts.year || !parts.month || !parts.day) throw new Error('date');
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    throw new LearningReportServiceError('DATA_NOT_AVAILABLE');
  }
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function assertReportRange(from: string, to: string): void {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  const days = Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1_000)) + 1;
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(to) ||
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    days < 1 ||
    days > 90
  ) {
    throw new LearningReportServiceError('VALIDATION_FAILED');
  }
}

function validateOptions(options: Options): void {
  if (
    !Number.isInteger(options.summaryWindowDays) ||
    options.summaryWindowDays < 1 ||
    options.summaryWindowDays > 90 ||
    !Number.isInteger(options.weaknessStaleAfterDays) ||
    options.weaknessStaleAfterDays < 1 ||
    !Number.isInteger(options.weaknessMinimumEvidence) ||
    options.weaknessMinimumEvidence < 1
  ) {
    throw new LearningReportServiceError('VALIDATION_FAILED');
  }
}

function label(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized
    ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`.slice(
        0,
        300,
      )
    : 'Unavailable evidence';
}

export class LearningReportService {
  private readonly options: Options;

  constructor(
    private readonly repository: LearningReportRepository,
    options: Options = defaultOptions,
  ) {
    validateOptions(options);
    this.options = options;
  }

  async getDueReviews(
    input: Readonly<{
      userId: string;
      limit: number;
      cursor?: string;
      position?: Readonly<{ sortValue: string; tieBreaker: string }>;
    }>,
  ) {
    if (
      !input.userId.trim() ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50
    ) {
      throw new LearningReportServiceError('VALIDATION_FAILED');
    }
    const { snapshot, learningDate } = await this.load(input.userId);
    const now = this.options.now();
    const due = snapshot.reviews
      .filter(({ dueAt, completedAt }) => !completedAt && dueAt <= now)
      .sort(
        (left, right) =>
          left.dueAt.getTime() - right.dueAt.getTime() ||
          left.wordId.localeCompare(right.wordId),
      );
    const start = input.position
      ? Math.max(
          0,
          due.findIndex(
            (item) =>
              item.dueAt.toISOString() === input.position!.sortValue &&
              item.wordId === input.position!.tieBreaker,
          ) + 1,
        )
      : 0;
    const items = due.slice(start, start + input.limit).map((item) =>
      Object.freeze({
        wordId: item.wordId,
        word: item.word,
        reviewState: item.reviewState,
        dueAt: item.dueAt.toISOString(),
        priority: item.priority,
        reason: item.reason,
      }),
    );
    const last = items.at(-1);
    return Object.freeze({
      learningDate,
      timezone: snapshot.timezone,
      totalDue: due.length,
      items: Object.freeze(items),
      truncated: due.length > start + items.length,
      nextPosition:
        due.length > start + items.length && last
          ? Object.freeze({
              sortValue: last.dueAt,
              tieBreaker: last.wordId,
            })
          : null,
      contentVersion: snapshot.contentVersion,
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  async getSummary(
    input: Readonly<{
      userId: string;
      from?: string;
      to?: string;
    }>,
  ) {
    if (!input.userId.trim()) {
      throw new LearningReportServiceError('VALIDATION_FAILED');
    }
    const { snapshot, windowStart, windowEnd } = await this.load(input.userId, {
      from: input.from,
      to: input.to,
    });
    const scoreTotal = snapshot.attempts.reduce(
      (total, attempt) => total + attempt.score,
      0,
    );
    const attemptCount = snapshot.attempts.length;
    const hasAnyFacts =
      attemptCount > 0 ||
      snapshot.reviews.length > 0 ||
      snapshot.learnedWordCount !== null;
    const complete = attemptCount > 0 && snapshot.learnedWordCount !== null;
    return Object.freeze({
      report: Object.freeze({
        windowStart,
        windowEnd,
        attemptCount,
        averageScore:
          attemptCount === 0 ? null : Math.round(scoreTotal / attemptCount),
        reviewsDue: snapshot.reviews.length,
        reviewsCompleted: snapshot.reviews.filter(
          ({ completedAt }) => completedAt !== null,
        ).length,
        ...(snapshot.learnedWordCount === null
          ? {}
          : { learnedWordCount: snapshot.learnedWordCount }),
        dataCompleteness: complete
          ? ('complete' as const)
          : hasAnyFacts
            ? ('partial' as const)
            : ('insufficient' as const),
        policyVersion: 'learning-report.v1',
      }),
      contentVersion: snapshot.contentVersion,
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  async getWeaknesses(
    input: Readonly<{
      userId: string;
      limit: number;
      cursor?: string;
      position?: Readonly<{ sortValue: string; tieBreaker: string }>;
      from?: string;
      to?: string;
    }>,
  ) {
    if (
      !input.userId.trim() ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50
    ) {
      throw new LearningReportServiceError('VALIDATION_FAILED');
    }
    const { snapshot } = await this.load(input.userId, {
      from: input.from,
      to: input.to,
    });
    const grouped = new Map<
      string,
      {
        type: 'word' | 'error_type';
        key: string;
        count: number;
        lastSeenAt: Date;
      }
    >();
    for (const attempt of snapshot.attempts) {
      for (const [type, values] of [
        ['error_type', attempt.errorTypes],
        ['word', attempt.wordIds],
      ] as const) {
        for (const key of values) {
          const mapKey = `${type}:${key}`;
          const current = grouped.get(mapKey);
          grouped.set(mapKey, {
            type,
            key,
            count: (current?.count ?? 0) + 1,
            lastSeenAt:
              !current || attempt.occurredAt > current.lastSeenAt
                ? attempt.occurredAt
                : current.lastSeenAt,
          });
        }
      }
    }
    const staleBoundary =
      this.options.now().getTime() -
      this.options.weaknessStaleAfterDays * 24 * 60 * 60 * 1_000;
    const allItems = [...grouped.values()]
      .map((item) =>
        Object.freeze({
          type: item.type,
          key: item.key,
          label: label(item.key),
          count: item.count,
          lastSeenAt: item.lastSeenAt.toISOString(),
          evidenceStatus:
            item.count < this.options.weaknessMinimumEvidence
              ? ('insufficient' as const)
              : item.lastSeenAt.getTime() < staleBoundary
                ? ('stale' as const)
                : ('current' as const),
        }),
      )
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.type.localeCompare(right.type) ||
          left.key.localeCompare(right.key),
      );
    const start = input.position
      ? Math.max(
          0,
          allItems.findIndex(
            (item) =>
              String(item.count).padStart(10, '0') ===
                input.position!.sortValue &&
              `${item.type}:${item.key}` === input.position!.tieBreaker,
          ) + 1,
        )
      : 0;
    const items = allItems.slice(start, start + input.limit);
    const last = items.at(-1);
    const sufficientCount = allItems.filter(
      ({ evidenceStatus }) => evidenceStatus !== 'insufficient',
    ).length;
    return Object.freeze({
      dataCompleteness:
        allItems.length === 0
          ? ('insufficient' as const)
          : sufficientCount === allItems.length
            ? ('complete' as const)
            : ('partial' as const),
      items: Object.freeze(items),
      truncated: allItems.length > start + items.length,
      nextPosition:
        allItems.length > start + items.length && last
          ? Object.freeze({
              sortValue: String(last.count).padStart(10, '0'),
              tieBreaker: `${last.type}:${last.key}`,
            })
          : null,
      contentVersion: snapshot.contentVersion,
      updatedAt: new Date(snapshot.updatedAt),
    });
  }

  private async load(
    userId: string,
    range?: Readonly<{ from?: string; to?: string }>,
  ): Promise<
    Readonly<{
      snapshot: LearningReportSnapshot;
      learningDate: string;
      windowStart: string;
      windowEnd: string;
    }>
  > {
    const timezone = await this.repository.getTimezone(userId);
    const learningDate = isoDateAt(this.options.now(), timezone);
    const windowEnd = range?.to ?? learningDate;
    const windowStart =
      range?.from ?? addDays(windowEnd, -(this.options.summaryWindowDays - 1));
    assertReportRange(windowStart, windowEnd);
    const snapshot = await this.repository.loadSnapshot({
      userId,
      timezone,
      learningDate,
      windowStart,
      windowEnd,
    });
    return Object.freeze({ snapshot, learningDate, windowStart, windowEnd });
  }
}
