export type LearnerCefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type LearnerGoalType =
  | 'GENERAL'
  | 'EXAM'
  | 'BUSINESS'
  | 'TRAVEL'
  | 'CUSTOM';
export type ProfileSignalStatus =
  | 'AVAILABLE'
  | 'MISSING'
  | 'STALE'
  | 'NOT_APPLICABLE';

export type LearnerProfileRecord = {
  cefrLevel: LearnerCefrLevel | null;
  levelSource: 'USER_DECLARED' | null;
  goalType: LearnerGoalType | null;
  goalText: string | null;
  activeCourseId: string | null;
  timezone: string;
  updatedAt: Date;
  activeCourse?: { id: string; name: string; value: string } | null;
};

export type LearnerSignalSnapshot = {
  legacyCompletedCount: number;
  coachEngagedCount: number;
  recentWords: Array<{
    wordId: string;
    word: string;
    state: 'LEGACY_COMPLETED' | 'LEARNING' | 'REVIEW' | 'MASTERED';
  }>;
  weakItems: Array<{
    targetType: 'WORD' | 'ERROR_TYPE';
    targetKey: string;
    label: string;
    reviewState: 'LEARNING' | 'REVIEW' | 'MASTERED';
    lastQuality: number | null;
    dueAt: Date | null;
  }>;
  errorTypes: Array<{
    type: string;
    count: number;
    lastSeenAt: Date;
  }>;
  recentPerformance: {
    attemptCount: number;
    averageScore: number | null;
    windowStart: Date;
  };
};

export interface LearnerProfileRepository {
  findProfile(subjectId: string): Promise<LearnerProfileRecord | null>;
  findPurchasedCourse(
    subjectId: string,
    courseId: string,
  ): Promise<{ id: string; name: string; value: string } | null>;
  upsertProfile(
    subjectId: string,
    update: Partial<LearnerProfileRecord>,
  ): Promise<LearnerProfileRecord>;
  readSignals(
    subjectId: string,
    limit: number,
  ): Promise<LearnerSignalSnapshot>;
}

export type LearnerProfileSnapshot = {
  snapshotAt: Date;
  level: { cefr: LearnerCefrLevel; source: 'USER_DECLARED' } | null;
  goal: { type: LearnerGoalType; text: string | null } | null;
  activeCourse: { id: string; name: string; value: string } | null;
  timezone: string;
  learnedWordSummary: Pick<
    LearnerSignalSnapshot,
    'legacyCompletedCount' | 'coachEngagedCount' | 'recentWords'
  >;
  weakItems: LearnerSignalSnapshot['weakItems'];
  errorTypes: LearnerSignalSnapshot['errorTypes'];
  recentPerformance: LearnerSignalSnapshot['recentPerformance'];
  signals: Array<{
    dimension:
      | 'LEVEL'
      | 'GOAL'
      | 'LEARNED_WORDS'
      | 'WEAK_ITEMS'
      | 'ERROR_TYPES'
      | 'RECENT_PERFORMANCE'
      | 'ACTIVE_COURSE';
    status: ProfileSignalStatus;
  }>;
};
