import { Injectable } from '@nestjs/common';
import type { PronunciationCoachSummary } from '@en/common/coach';
import { PrismaService } from '@libs/shared';
import type { PronunciationSourceRightsService } from './pronunciation-source-rights.service';

type SummaryStatus = PronunciationCoachSummary['assessmentStatus'];
type ConfidenceTier = PronunciationCoachSummary['confidenceTier'];
type LearningWriteStatus = PronunciationCoachSummary['learningWriteStatus'];

export type PronunciationContextRecord = Readonly<{
  assessmentId: string;
  subjectId: string;
  assessmentStatus: SummaryStatus;
  hiddenAt: Date | null;
  deletedAt: Date | null;
  confidenceTier: ConfidenceTier;
  scores: PronunciationCoachSummary['scores'];
  words: readonly Readonly<{
    targetPosition: number | null;
    word: string;
    status: 'correct' | 'mispronounced' | 'omitted' | 'inserted' | 'uncertain';
    score: number | null;
    alignmentReliable: boolean;
    wordId: string | null;
  }>[];
  reviewChanges: readonly Readonly<{
    targetPosition: number;
    word: string;
    nextReviewState: 'LEARNING' | 'REVIEW' | 'MASTERED';
    nextReviewAt: Date;
  }>[];
  learningWriteStatus: LearningWriteStatus;
  versions: PronunciationCoachSummary['versions'];
  source: Readonly<{
    sourceType:
      | 'MANUAL'
      | 'WORD_BOOK'
      | 'COURSE_WORD'
      | 'RAG_CITATION'
      | 'COACH_EXERCISE';
    courseId: string | null;
    wordId: string | null;
    knowledgeCitationId: string | null;
    sourceVersion: string | null;
    sourceContentHash: string | null;
    sourceRightsVersion: string | null;
  }>;
}>;

export interface PronunciationContextRepository {
  findOwned(
    subjectId: string,
    assessmentId: string,
  ): Promise<PronunciationContextRecord | null>;
}

export type PronunciationRecommendationDecision = Readonly<{
  nextAction: 'retry' | 'review' | 'continue';
  reason: string;
}>;

export function recommendPronunciationNextAction(
  input: Readonly<{
    assessmentStatus: string;
    confidenceTier: ConfidenceTier;
    sourceStatus: 'ACTIVE' | 'UNAVAILABLE';
    weakWordCount: number;
    reviewChangeCount: number;
  }>,
): PronunciationRecommendationDecision {
  if (input.sourceStatus !== 'ACTIVE') {
    return Object.freeze({
      nextAction: 'retry',
      reason: '原评测来源当前不可用，请选择仍有权限的内容后重新评测。',
    });
  }
  if (
    input.assessmentStatus !== 'COMPLETED' ||
    input.confidenceTier !== 'RELIABLE'
  ) {
    return Object.freeze({
      nextAction: 'retry',
      reason: '本次评测仅供参考，请改善录音条件后重新朗读。',
    });
  }
  if (input.weakWordCount > 0 || input.reviewChangeCount > 0) {
    return Object.freeze({
      nextAction: 'review',
      reason: `本次有 ${input.weakWordCount} 个可靠薄弱词，建议先复习再朗读。`,
    });
  }
  return Object.freeze({
    nextAction: 'continue',
    reason: '本次未发现可靠薄弱词，可以继续下一项学习。',
  });
}

@Injectable()
export class PronunciationContextService {
  constructor(
    private readonly repository: PronunciationContextRepository,
    private readonly sourceRights?: Pick<
      PronunciationSourceRightsService,
      'revalidate'
    >,
  ) {}

  async getOwnedSummary(
    subjectId: string,
    assessmentId: string,
  ): Promise<PronunciationCoachSummary | null> {
    const row = await this.repository.findOwned(subjectId, assessmentId);
    if (
      !row ||
      row.subjectId !== subjectId ||
      row.hiddenAt !== null ||
      row.deletedAt !== null
    ) {
      return null;
    }

    const sourceStatus = await this.sourceStatus(subjectId, row);
    const reliable =
      row.assessmentStatus === 'COMPLETED' &&
      row.confidenceTier === 'RELIABLE' &&
      sourceStatus === 'ACTIVE';
    const weakWords = reliable
      ? row.words
          .filter(
            (word) =>
              word.alignmentReliable &&
              word.wordId !== null &&
              word.targetPosition !== null &&
              (word.status === 'mispronounced' || word.status === 'omitted'),
          )
          .map((word) => ({
            targetPosition: word.targetPosition!,
            word: word.word,
            status: word.status as 'mispronounced' | 'omitted',
            score: word.score,
          }))
      : [];
    const reviewChanges = reliable ? [...row.reviewChanges] : [];
    const recommendation = recommendPronunciationNextAction({
      assessmentStatus: row.assessmentStatus,
      confidenceTier: row.confidenceTier,
      sourceStatus,
      weakWordCount: weakWords.length,
      reviewChangeCount: reviewChanges.length,
    });

    return {
      assessmentId: row.assessmentId,
      assessmentStatus: row.assessmentStatus,
      confidenceTier: row.confidenceTier,
      scores: { ...row.scores },
      weakWords,
      reviewChanges: reviewChanges.map((change) => ({
        ...change,
        nextReviewAt: change.nextReviewAt.toISOString(),
      })),
      learningWriteStatus: reliable ? row.learningWriteStatus : 'NOT_ELIGIBLE',
      sourceStatus,
      nextAction: recommendation.nextAction,
      recommendationReason: recommendation.reason,
      versions: { ...row.versions },
    };
  }

  private async sourceStatus(
    subjectId: string,
    row: PronunciationContextRecord,
  ): Promise<'ACTIVE' | 'UNAVAILABLE'> {
    if (
      row.source.sourceType !== 'COURSE_WORD' &&
      row.source.sourceType !== 'RAG_CITATION'
    ) {
      return 'ACTIVE';
    }
    if (
      !this.sourceRights ||
      !row.source.sourceVersion ||
      !row.source.sourceContentHash ||
      !row.source.sourceRightsVersion
    ) {
      return 'UNAVAILABLE';
    }
    try {
      await this.sourceRights.revalidate({
        subjectId,
        sourceType: row.source.sourceType,
        courseId: row.source.courseId,
        wordId: row.source.wordId,
        knowledgeCitationId: row.source.knowledgeCitationId,
        expected: {
          sourceVersion: row.source.sourceVersion,
          sourceContentHash: row.source.sourceContentHash,
          sourceRightsVersion: row.source.sourceRightsVersion,
        },
      });
      return 'ACTIVE';
    } catch {
      return 'UNAVAILABLE';
    }
  }
}

function number(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reviewState(
  value: unknown,
): { reviewState: 'LEARNING' | 'REVIEW' | 'MASTERED'; dueAt: Date } | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as { reviewState?: unknown; dueAt?: unknown };
  if (
    state.reviewState !== 'LEARNING' &&
    state.reviewState !== 'REVIEW' &&
    state.reviewState !== 'MASTERED'
  ) {
    return null;
  }
  if (typeof state.dueAt !== 'string') return null;
  const dueAt = new Date(state.dueAt);
  return Number.isFinite(dueAt.getTime())
    ? { reviewState: state.reviewState, dueAt }
    : null;
}

@Injectable()
export class PrismaPronunciationContextRepository implements PronunciationContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOwned(
    subjectId: string,
    assessmentId: string,
  ): Promise<PronunciationContextRecord | null> {
    const row = await this.prisma.pronunciationAssessment.findFirst({
      where: { id: assessmentId, userId: subjectId, hiddenAt: null },
      select: {
        id: true,
        userId: true,
        status: true,
        hiddenAt: true,
        deletedAt: true,
        confidenceTier: true,
        overallScore: true,
        accuracyScore: true,
        completenessScore: true,
        fluencyScore: true,
        prosodyScore: true,
        learningWriteStatus: true,
        resultSchemaVersion: true,
        assessmentRuleVersion: true,
        confidencePolicyVersion: true,
        weaknessMappingVersion: true,
        schedulerVersion: true,
        words: {
          orderBy: { sequence: 'asc' },
          select: {
            targetPosition: true,
            word: true,
            status: true,
            score: true,
            alignmentReliable: true,
            wordId: true,
          },
        },
        target: {
          select: {
            sourceType: true,
            courseId: true,
            wordId: true,
            knowledgeCitationId: true,
            sourceVersion: true,
            sourceContentHash: true,
            sourceRightsVersion: true,
          },
        },
        learningAttempt: {
          select: {
            reviewEvents: {
              where: { voidedAt: null },
              select: { targetKey: true, nextState: true },
            },
          },
        },
      },
    });
    if (!row?.target || !this.isSummaryStatus(row.status)) return null;
    if (
      !row.resultSchemaVersion ||
      !row.assessmentRuleVersion ||
      !row.confidencePolicyVersion ||
      !row.weaknessMappingVersion ||
      !row.schedulerVersion
    ) {
      return null;
    }
    const words = row.words.map((word) => ({
      targetPosition: word.targetPosition,
      word: word.word,
      status:
        word.status.toLowerCase() as PronunciationContextRecord['words'][number]['status'],
      score: number(word.score),
      alignmentReliable: word.alignmentReliable,
      wordId: word.wordId,
    }));
    const byWordId = new Map(
      words
        .filter((word) => word.wordId && word.targetPosition !== null)
        .map((word) => [word.wordId!, word] as const),
    );
    const reviewChanges = (row.learningAttempt?.reviewEvents ?? []).flatMap(
      (event) => {
        const word = byWordId.get(event.targetKey);
        const next = reviewState(event.nextState);
        return word && next && word.targetPosition !== null
          ? [
              {
                targetPosition: word.targetPosition,
                word: word.word,
                nextReviewState: next.reviewState,
                nextReviewAt: next.dueAt,
              },
            ]
          : [];
      },
    );
    return Object.freeze({
      assessmentId: row.id,
      subjectId: row.userId,
      assessmentStatus: row.status,
      hiddenAt: row.hiddenAt,
      deletedAt: row.deletedAt,
      confidenceTier: row.confidenceTier,
      scores: {
        overall: number(row.overallScore),
        accuracy: number(row.accuracyScore),
        completeness: number(row.completenessScore),
        fluency: number(row.fluencyScore),
        prosody: number(row.prosodyScore),
      },
      words,
      reviewChanges,
      learningWriteStatus: row.learningWriteStatus,
      versions: {
        resultSchema: row.resultSchemaVersion,
        assessmentRule: row.assessmentRuleVersion,
        confidencePolicy: row.confidencePolicyVersion,
        learningMapping: row.weaknessMappingVersion,
        scheduler: row.schedulerVersion,
      },
      source: row.target,
    });
  }

  private isSummaryStatus(value: string): value is SummaryStatus {
    return [
      'COMPLETED',
      'REFERENCE_ONLY',
      'UNRECOGNIZABLE',
      'REJECTED',
      'CANCELLED',
      'TIMED_OUT',
      'FAILED',
    ].includes(value);
  }
}
