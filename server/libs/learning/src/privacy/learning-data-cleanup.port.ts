/**
 * A bounded participant in the existing account-deletion lifecycle.
 * Implementations own one data domain and must make both operations idempotent.
 */
export interface LearningDataCleanupPort {
  readonly cleanupKey: string;
  hideImmediately(subjectId: string, requestedAt: Date): Promise<void>;
  purgeOwnedData(subjectId: string): Promise<void>;
}
