export type LegacyUserSnapshot = {
  id: string;
  wordNumber: number;
};

export type LegacyWordRecordSnapshot = {
  userId: string;
  wordId: string;
  isMaster: boolean;
  updatedAt: Date;
};

export type LegacyWordStateSnapshot = {
  userId: string;
  targetKey: string;
  wordId: string | null;
};

export type MasteredWordStateSeed = {
  userId: string;
  targetType: 'WORD';
  targetKey: string;
  wordId: string;
  reviewState: 'REVIEW';
  repetitionCount: 1;
  easeFactor: number;
  intervalDays: 1;
  dueAt: Date;
  lastReviewedAt: Date;
};

export interface LegacyLearningStateBackfillRepository {
  listLegacyUsers(): Promise<LegacyUserSnapshot[]>;
  listLegacyWordRecords(): Promise<LegacyWordRecordSnapshot[]>;
  listWordStates(): Promise<LegacyWordStateSnapshot[]>;
  upsertMasteredWordState(state: MasteredWordStateSeed): Promise<void>;
}

export type LegacyLearningStateBackfillSummary = {
  rolloutAt: string;
  legacyUserCount: number;
  legacyMasteredCount: number;
  expectedStateCount: number;
  stateCount: number;
  missingStateCount: number;
  duplicateLegacyKeyCount: number;
  legacyCountMismatchUserCount: number;
  auditOnly: boolean;
  writeSafe: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function stateKey(userId: string, wordId: string): string {
  return `${userId}\u0000${wordId}`;
}

function dueAtFor(record: LegacyWordRecordSnapshot, rolloutAt: Date): Date {
  const legacyDueAt = new Date(record.updatedAt.getTime() + DAY_MS);
  return legacyDueAt > rolloutAt ? legacyDueAt : new Date(rolloutAt);
}

export async function runLegacyLearningStateBackfill(
  repository: LegacyLearningStateBackfillRepository,
  options: { rolloutAt: Date; auditOnly?: boolean },
): Promise<LegacyLearningStateBackfillSummary> {
  if (Number.isNaN(options.rolloutAt.getTime())) {
    throw new Error('A fixed valid rolloutAt is required');
  }

  const [users, records] = await Promise.all([
    repository.listLegacyUsers(),
    repository.listLegacyWordRecords(),
  ]);
  const mastered = records.filter((record) => record.isMaster);
  const uniqueMastered = new Map<string, LegacyWordRecordSnapshot>();
  for (const record of mastered) {
    uniqueMastered.set(stateKey(record.userId, record.wordId), record);
  }

  if (!options.auditOnly) {
    for (const record of uniqueMastered.values()) {
      await repository.upsertMasteredWordState({
        userId: record.userId,
        targetType: 'WORD',
        targetKey: record.wordId,
        wordId: record.wordId,
        reviewState: 'REVIEW',
        repetitionCount: 1,
        easeFactor: 2.5,
        intervalDays: 1,
        dueAt: dueAtFor(record, options.rolloutAt),
        lastReviewedAt: new Date(record.updatedAt),
      });
    }
  }

  const wordStates = await repository.listWordStates();
  const stateKeys = new Set(
    wordStates
      .filter((state) => state.wordId !== null)
      .map((state) => stateKey(state.userId, state.targetKey)),
  );
  const missingStateCount = [...uniqueMastered.keys()].filter(
    (key) => !stateKeys.has(key),
  ).length;
  const masteredCountByUser = new Map<string, number>();
  for (const record of uniqueMastered.values()) {
    masteredCountByUser.set(
      record.userId,
      (masteredCountByUser.get(record.userId) ?? 0) + 1,
    );
  }
  const legacyCountMismatchUserCount = users.filter(
    (user) => user.wordNumber !== (masteredCountByUser.get(user.id) ?? 0),
  ).length;
  const duplicateLegacyKeyCount = mastered.length - uniqueMastered.size;

  return {
    rolloutAt: options.rolloutAt.toISOString(),
    legacyUserCount: users.length,
    legacyMasteredCount: mastered.length,
    expectedStateCount: uniqueMastered.size,
    stateCount: stateKeys.size,
    missingStateCount,
    duplicateLegacyKeyCount,
    legacyCountMismatchUserCount,
    auditOnly: Boolean(options.auditOnly),
    writeSafe:
      missingStateCount === 0 &&
      duplicateLegacyKeyCount === 0 &&
      legacyCountMismatchUserCount === 0,
  };
}
