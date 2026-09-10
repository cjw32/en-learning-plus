import { createHash } from 'node:crypto';
import { KnowledgeDomainError } from '../domain/knowledge.types';

export type SavedLearningFact = Readonly<{
  attemptId: string;
  savedAt: Date;
  targetType: 'WORD' | 'ERROR_TYPE' | 'COURSE_TOPIC';
  targetKey: string;
  quality: number;
  reviewState: 'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED';
  submissionStatus?: string;
}>;

export class PrivateLearningSummaryService {
  summarize(input: { subjectId: string; facts: readonly SavedLearningFact[] }) {
    const facts = input.facts
      .filter(
        (fact) => !fact.submissionStatus || fact.submissionStatus === 'SAVED',
      )
      .slice()
      .sort(
        (left, right) =>
          left.savedAt.getTime() - right.savedAt.getTime() ||
          left.attemptId.localeCompare(right.attemptId),
      );
    if (facts.length === 0) return [] as const;

    const first = facts[0];
    if (
      facts.some(
        (fact) =>
          fact.targetType !== first.targetType ||
          fact.targetKey !== first.targetKey,
      )
    ) {
      throw new KnowledgeDomainError(
        'CONTENT_STRUCTURE_INVALID',
        'A private summary may contain only one topic',
      );
    }
    if (facts.some((fact) => fact.quality < 0 || fact.quality > 5)) {
      throw new KnowledgeDomainError(
        'CONTENT_STRUCTURE_INVALID',
        'Saved learning quality must be between 0 and 5',
      );
    }

    const last = facts[facts.length - 1];
    const evidence = facts.map((fact) => ({
      attemptId: fact.attemptId,
      savedAt: fact.savedAt.toISOString(),
      quality: fact.quality,
      reviewState: fact.reviewState,
    }));
    const evidenceHash = createHash('sha256')
      .update(JSON.stringify(evidence))
      .digest('hex');
    return Object.freeze({
      source: 'private-learning-summary',
      sourceId: `summary:${input.subjectId}:${first.targetType}:${first.targetKey}`,
      sourceRecordType: 'PrivateLearningSummary' as const,
      sourceRecordId: `${first.targetType}:${first.targetKey}`,
      category: 'LEARNING_SUMMARY' as const,
      accessScope: 'PRIVATE_OWNER' as const,
      visibility: 'private' as const,
      ownerUserId: input.subjectId,
      topicType: first.targetType,
      topicKey: first.targetKey,
      windowStart: first.savedAt,
      windowEnd: last.savedAt,
      summaryFacts: Object.freeze({
        attemptCount: facts.length,
        lastQuality: last.quality,
        reviewState: last.reviewState,
      }),
      evidenceVersion: `summary-evidence.sha256.${evidenceHash}`,
      contentVersion: `learning-summary.sha256.${evidenceHash}`,
      sourceUpdatedAt: last.savedAt,
    });
  }
}
