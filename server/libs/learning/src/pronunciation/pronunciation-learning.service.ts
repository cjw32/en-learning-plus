import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@libs/shared';
import { Prisma } from '@libs/shared/generated/prisma/client';
import {
  LearningDomainError,
  ownedResourceNotFound,
} from '../common/learning-errors';
import {
  scheduleSm2Review,
  type Sm2ReviewState,
} from '../review/sm2-review-scheduler';
import { PronunciationLearningEligibility } from './pronunciation-learning-eligibility';
import {
  pronunciationEvidenceFromWords,
  type PronunciationLearningEvidence,
  type PronunciationLearningWord,
} from './pronunciation-quality.policy';

export type PronunciationLearningAssessment = Readonly<{
  assessmentId: string;
  subjectId: string;
  status: string;
  confidence: number | null;
  confidenceTier: string | null;
  resultSchemaValid: boolean;
  audioValid: boolean;
  cancelled: boolean;
  timedOut: boolean;
  score: number;
  evidenceHash: string;
  resultSchemaVersion: string | null;
  learningMappingVersion: string | null;
  schedulerVersion: string | null;
  timezone: string;
  words: readonly PronunciationLearningWord[];
}>;

export type PronunciationLearningItemStateRecord = Sm2ReviewState &
  Readonly<{
    subjectId: string;
    targetType: 'PRONUNCIATION_WORD';
    targetKey: string;
    wordId: string;
    lastReviewedAt?: Date | null;
    lastQuality?: number | null;
    lastAttemptId?: string | null;
  }>;

export type PronunciationLearningAttemptRecord = Readonly<{
  id: string;
  subjectId: string;
  attemptType: 'PRONUNCIATION';
  exerciseId: null;
  submissionId: null;
  saveRequestId: null;
  pronunciationAssessmentId: string;
  score: number;
  evidenceHash: string;
  policyVersion: string;
  savedAt: Date;
}>;

export type PronunciationLearningReviewEventRecord = Readonly<{
  id: string;
  subjectId: string;
  attemptId: string;
  targetType: 'PRONUNCIATION_WORD';
  targetKey: string;
  wordId: string;
  quality: number;
  evidenceKind: 'PRONUNCIATION_WORD';
  schedulerVersion: 'SM2_V1';
  policyVersion: 'pronunciation-quality.v1';
  previousState: Sm2ReviewState;
  nextState: Sm2ReviewState;
}>;

export interface PronunciationLearningTransaction {
  lockOwnedAssessment(
    subjectId: string,
    assessmentId: string,
  ): Promise<PronunciationLearningAssessment | null>;
  findAttemptByAssessment(
    assessmentId: string,
  ): Promise<PronunciationLearningAttemptRecord | null>;
  findItemState(
    subjectId: string,
    targetKey: string,
  ): Promise<PronunciationLearningItemStateRecord | null>;
  createAttempt(attempt: PronunciationLearningAttemptRecord): Promise<void>;
  upsertItemState(state: PronunciationLearningItemStateRecord): Promise<void>;
  createReviewEvent(
    event: PronunciationLearningReviewEventRecord,
  ): Promise<void>;
  markLearningWriteStatus(
    assessmentId: string,
    status: 'NOT_ELIGIBLE' | 'SAVED' | 'FAILED',
  ): Promise<void>;
}

export interface PronunciationLearningRepository {
  transaction<T>(
    operation: (tx: PronunciationLearningTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PronunciationLearningFinalizationLedger {
  recordLearningFinalized(assessmentId: string): Promise<void>;
}

const noopFinalization: PronunciationLearningFinalizationLedger = {
  async recordLearningFinalized() {},
};

type LearningChange = Readonly<{
  targetPosition: number;
  word: string;
  previousReviewState: 'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED';
  nextReviewState: 'LEARNING' | 'REVIEW' | 'MASTERED';
  nextReviewAt: string;
}>;

export type PronunciationLearningSaveResult = Readonly<{
  status: 'saved' | 'replayed' | 'not_eligible';
  attemptId: string | null;
  changedItems: readonly LearningChange[];
  reasons: readonly string[];
}>;

function initialState(
  subjectId: string,
  evidence: PronunciationLearningEvidence,
): PronunciationLearningItemStateRecord {
  return {
    subjectId,
    targetType: 'PRONUNCIATION_WORD',
    targetKey: evidence.targetKey,
    wordId: evidence.wordId,
    reviewState: 'NEW',
    repetitionCount: 0,
    easeFactor: 2.5,
    intervalDays: 0,
  };
}

function stateSnapshot(state: Sm2ReviewState): Sm2ReviewState {
  return Object.freeze({
    reviewState: state.reviewState,
    repetitionCount: state.repetitionCount,
    easeFactor: state.easeFactor,
    intervalDays: state.intervalDays,
    ...(state.dueAt ? { dueAt: new Date(state.dueAt) } : {}),
  });
}

@Injectable()
export class PronunciationLearningService {
  private readonly eligibility = new PronunciationLearningEligibility();

  constructor(
    private readonly repository: PronunciationLearningRepository,
    private readonly finalization: PronunciationLearningFinalizationLedger = noopFinalization,
    private readonly createId: () => string = randomUUID,
  ) {}

  async save(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      sourceValid: boolean;
      reviewedAt?: Date;
    }>,
  ): Promise<PronunciationLearningSaveResult> {
    const reviewedAt = input.reviewedAt ?? new Date();
    const result = await this.repository.transaction(async (tx) => {
      const assessment = await tx.lockOwnedAssessment(
        input.subjectId,
        input.assessmentId,
      );
      if (!assessment) throw ownedResourceNotFound();
      const evidence = pronunciationEvidenceFromWords(assessment.words);
      const decision = this.eligibility.evaluate({
        subjectId: input.subjectId,
        assessmentSubjectId: assessment.subjectId,
        assessmentStatus: assessment.status,
        confidence: assessment.confidence,
        confidenceTier: assessment.confidenceTier,
        resultSchemaValid: assessment.resultSchemaValid,
        audioValid: assessment.audioValid,
        sourceValid: input.sourceValid,
        cancelled: assessment.cancelled,
        timedOut: assessment.timedOut,
        evidenceCount: evidence.length,
        versions: {
          resultSchema: assessment.resultSchemaVersion,
          learningMapping: assessment.learningMappingVersion,
          scheduler: assessment.schedulerVersion,
        },
      });
      if (!decision.eligible) {
        await tx.markLearningWriteStatus(
          assessment.assessmentId,
          'NOT_ELIGIBLE',
        );
        return {
          status: 'not_eligible' as const,
          attemptId: null,
          changedItems: [],
          reasons: decision.reasons,
          newlySaved: false,
        };
      }
      const existing = await tx.findAttemptByAssessment(
        assessment.assessmentId,
      );
      if (existing) {
        if (
          existing.subjectId !== input.subjectId ||
          existing.evidenceHash !== assessment.evidenceHash
        ) {
          throw new LearningDomainError(
            'STATE_CONFLICT',
            '发音学习证据与已保存记录不一致',
            409,
          );
        }
        return {
          status: 'replayed' as const,
          attemptId: existing.id,
          changedItems: [],
          reasons: [],
          newlySaved: false,
        };
      }

      const attemptId = this.createId();
      const transitions: Array<{
        previous: PronunciationLearningItemStateRecord;
        next: PronunciationLearningItemStateRecord;
        evidence: PronunciationLearningEvidence;
        change: LearningChange;
      }> = [];
      for (const item of evidence) {
        const previous =
          (await tx.findItemState(input.subjectId, item.targetKey)) ??
          initialState(input.subjectId, item);
        const scheduled = scheduleSm2Review({
          current: previous,
          quality: item.quality,
          reviewedAt,
          timezone: assessment.timezone,
        });
        const next: PronunciationLearningItemStateRecord = {
          ...previous,
          ...scheduled,
          wordId: previous.wordId || item.wordId,
          lastReviewedAt: reviewedAt,
          lastQuality: item.quality,
          lastAttemptId: attemptId,
        };
        transitions.push({
          previous,
          next,
          evidence: item,
          change: Object.freeze({
            targetPosition: item.targetPosition,
            word: item.word,
            previousReviewState: previous.reviewState,
            nextReviewState: scheduled.reviewState,
            nextReviewAt: scheduled.dueAt.toISOString(),
          }),
        });
      }
      await tx.createAttempt({
        id: attemptId,
        subjectId: input.subjectId,
        attemptType: 'PRONUNCIATION',
        exerciseId: null,
        submissionId: null,
        saveRequestId: null,
        pronunciationAssessmentId: assessment.assessmentId,
        score: Math.round(assessment.score),
        evidenceHash: assessment.evidenceHash,
        policyVersion: 'pronunciation-quality.v1',
        savedAt: reviewedAt,
      });
      for (const transition of transitions) {
        await tx.upsertItemState(transition.next);
        await tx.createReviewEvent({
          id: this.createId(),
          subjectId: input.subjectId,
          attemptId,
          targetType: 'PRONUNCIATION_WORD',
          targetKey: transition.evidence.targetKey,
          wordId: transition.evidence.wordId,
          quality: transition.evidence.quality,
          evidenceKind: 'PRONUNCIATION_WORD',
          schedulerVersion: 'SM2_V1',
          policyVersion: 'pronunciation-quality.v1',
          previousState: stateSnapshot(transition.previous),
          nextState: stateSnapshot(transition.next),
        });
      }
      await tx.markLearningWriteStatus(assessment.assessmentId, 'SAVED');
      return {
        status: 'saved' as const,
        attemptId,
        changedItems: transitions.map((transition) => transition.change),
        reasons: [],
        newlySaved: true,
      };
    });
    if (result.newlySaved) {
      await this.finalization.recordLearningFinalized(input.assessmentId);
    }
    const { newlySaved: _newlySaved, ...publicResult } = result;
    return Object.freeze(publicResult);
  }
}

function json(value: Sm2ReviewState): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify({
      ...value,
      dueAt: value.dueAt?.toISOString(),
    }),
  ) as Prisma.InputJsonValue;
}

@Injectable()
export class PrismaPronunciationLearningRepository implements PronunciationLearningRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(
    operation: (tx: PronunciationLearningTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (database) => {
      const stateIds = new Map<string, string>();
      const transaction: PronunciationLearningTransaction = {
        lockOwnedAssessment: async (subjectId, assessmentId) => {
          const locked = await database.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "PronunciationAssessment" WHERE "id" = ${assessmentId} AND "userId" = ${subjectId} AND "hiddenAt" IS NULL FOR UPDATE`,
          );
          if (locked.length === 0) return null;
          const row = await database.pronunciationAssessment.findFirst({
            where: { id: assessmentId, userId: subjectId, hiddenAt: null },
            include: { audioAsset: true, words: true },
          });
          if (!row) return null;
          const profile = await database.learnerProfile.findUnique({
            where: { userId: subjectId },
            select: { timezone: true },
          });
          return {
            assessmentId: row.id,
            subjectId: row.userId,
            status: row.status,
            confidence: row.confidence === null ? null : Number(row.confidence),
            confidenceTier: row.confidenceTier,
            resultSchemaValid: Boolean(
              row.resultHash &&
              row.resultSchemaVersion &&
              row.overallScore !== null,
            ),
            audioValid:
              row.audioAsset?.status === 'READY' &&
              row.audioAsset.qualityStatus === 'READY' &&
              row.audioAsset.expiresAt > new Date(),
            cancelled:
              row.cancelRequestedAt !== null || row.status === 'CANCELLED',
            timedOut: row.status === 'TIMED_OUT',
            score: Number(row.overallScore ?? 0),
            evidenceHash: row.resultHash ?? '',
            resultSchemaVersion: row.resultSchemaVersion,
            learningMappingVersion: row.weaknessMappingVersion,
            schedulerVersion: row.schedulerVersion,
            timezone: profile?.timezone ?? 'Asia/Shanghai',
            words: row.words.map((word) => ({
              targetPosition: word.targetPosition,
              word: word.word,
              wordId: word.wordId,
              status:
                word.status.toLowerCase() as PronunciationLearningWord['status'],
              score: word.score === null ? null : Number(word.score),
              alignmentReliable: word.alignmentReliable,
            })),
          };
        },
        findAttemptByAssessment: async (assessmentId) => {
          const attempt = await database.learningAttempt.findUnique({
            where: { pronunciationAssessmentId: assessmentId },
          });
          if (
            !attempt ||
            attempt.attemptType !== 'PRONUNCIATION' ||
            !attempt.pronunciationAssessmentId ||
            !attempt.evidenceHash ||
            !attempt.policyVersion
          ) {
            return null;
          }
          return {
            id: attempt.id,
            subjectId: attempt.userId,
            attemptType: 'PRONUNCIATION',
            exerciseId: null,
            submissionId: null,
            saveRequestId: null,
            pronunciationAssessmentId: attempt.pronunciationAssessmentId,
            score: attempt.score,
            evidenceHash: attempt.evidenceHash,
            policyVersion: attempt.policyVersion,
            savedAt: attempt.savedAt,
          };
        },
        findItemState: async (subjectId, targetKey) => {
          const state = await database.learningItemState.findUnique({
            where: {
              userId_targetType_targetKey: {
                userId: subjectId,
                targetType: 'PRONUNCIATION_WORD',
                targetKey,
              },
            },
          });
          if (!state?.wordId) return null;
          stateIds.set(targetKey, state.id);
          return {
            subjectId: state.userId,
            targetType: 'PRONUNCIATION_WORD',
            targetKey: state.targetKey,
            wordId: state.wordId,
            reviewState: state.reviewState,
            repetitionCount: state.repetitionCount,
            easeFactor: Number(state.easeFactor),
            intervalDays: state.intervalDays,
            dueAt: state.dueAt ?? undefined,
            lastReviewedAt: state.lastReviewedAt,
            lastQuality: state.lastQuality,
            lastAttemptId: state.lastAttemptId,
          };
        },
        createAttempt: async (attempt) => {
          await database.learningAttempt.create({
            data: {
              id: attempt.id,
              userId: attempt.subjectId,
              attemptType: 'PRONUNCIATION',
              exerciseId: null,
              submissionId: null,
              saveRequestId: null,
              pronunciationAssessmentId: attempt.pronunciationAssessmentId,
              score: attempt.score,
              errorTypes: [],
              gradingHash: null,
              evidenceHash: attempt.evidenceHash,
              policyVersion: attempt.policyVersion,
              savedAt: attempt.savedAt,
            },
          });
        },
        upsertItemState: async (state) => {
          const saved = await database.learningItemState.upsert({
            where: {
              userId_targetType_targetKey: {
                userId: state.subjectId,
                targetType: 'PRONUNCIATION_WORD',
                targetKey: state.targetKey,
              },
            },
            create: {
              userId: state.subjectId,
              targetType: 'PRONUNCIATION_WORD',
              targetKey: state.targetKey,
              wordId: state.wordId,
              reviewState: state.reviewState,
              repetitionCount: state.repetitionCount,
              easeFactor: state.easeFactor,
              intervalDays: state.intervalDays,
              dueAt: state.dueAt,
              lastReviewedAt: state.lastReviewedAt,
              lastQuality: state.lastQuality,
              lastAttemptId: state.lastAttemptId,
            },
            update: {
              wordId: state.wordId,
              reviewState: state.reviewState,
              repetitionCount: state.repetitionCount,
              easeFactor: state.easeFactor,
              intervalDays: state.intervalDays,
              dueAt: state.dueAt,
              lastReviewedAt: state.lastReviewedAt,
              lastQuality: state.lastQuality,
              lastAttemptId: state.lastAttemptId,
            },
            select: { id: true },
          });
          stateIds.set(state.targetKey, saved.id);
        },
        createReviewEvent: async (event) => {
          const itemStateId = stateIds.get(event.targetKey);
          if (!itemStateId) throw new Error('Missing pronunciation item state');
          await database.learningReviewEvent.create({
            data: {
              id: event.id,
              userId: event.subjectId,
              itemStateId,
              attemptId: event.attemptId,
              targetType: 'PRONUNCIATION_WORD',
              targetKey: event.targetKey,
              itemScore: event.quality * 20,
              quality: event.quality,
              evidenceKind: 'PRONUNCIATION_WORD',
              schedulerVersion: event.schedulerVersion,
              policyVersion: event.policyVersion,
              previousState: json(event.previousState),
              nextState: json(event.nextState),
            },
          });
        },
        markLearningWriteStatus: async (assessmentId, status) => {
          await database.pronunciationAssessment.update({
            where: { id: assessmentId },
            data: { learningWriteStatus: status },
          });
        },
      };
      return operation(transaction);
    });
  }
}
