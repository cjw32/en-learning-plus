import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  pronunciationTargetInputSchema,
  type PronunciationLocale,
  type PronunciationTargetSource,
} from '@en/common/pronunciation';
import { PrismaService } from '@libs/shared';
import {
  normalizePronunciationTarget,
  type NormalizedPronunciationTarget,
} from './pronunciation-target-normalizer';

export type PronunciationTargetSourceEvidence = Readonly<{
  wordId: string | null;
  courseId: string | null;
  knowledgeCitationId: string | null;
  coachRequestId: string | null;
  exerciseId: string | null;
  itemId: string | null;
  sourceRecordType: string | null;
  sourceRecordId: string | null;
  sourceVersion: string | null;
  sourceContentHash: string | null;
  sourceRightsVersion: string | null;
}>;

export type ResolvedPronunciationTarget = NormalizedPronunciationTarget &
  PronunciationTargetSourceEvidence &
  Readonly<{
    sourceType: PronunciationTargetSource;
    languageTag: PronunciationLocale;
    targetHash: string;
    authorizedAt: Date;
    expiresAt: Date | null;
  }>;

export interface PronunciationTargetRepository {
  findWord(wordId: string): Promise<{
    id: string;
    word: string;
    updatedAt: Date;
  } | null>;
  findOwnedCoachExerciseItem(
    input: Readonly<{
      subjectId: string;
      coachRequestId: string;
      exerciseId: string;
      itemId: string;
      now: Date;
    }>,
  ): Promise<{
    prompt: string;
    schemaVersion: string;
    updatedAt: Date;
    expiresAt: Date;
  } | null>;
}

@Injectable()
export class PrismaPronunciationTargetRepository implements PronunciationTargetRepository {
  constructor(private readonly prisma: PrismaService) {}

  findWord(wordId: string) {
    return this.prisma.wordBook.findUnique({
      where: { id: wordId },
      select: { id: true, word: true, updatedAt: true },
    });
  }

  async findOwnedCoachExerciseItem(
    input: Readonly<{
      subjectId: string;
      coachRequestId: string;
      exerciseId: string;
      itemId: string;
      now: Date;
    }>,
  ) {
    const item = await this.prisma.exerciseItem.findFirst({
      where: {
        id: input.itemId,
        exerciseId: input.exerciseId,
        exercise: {
          userId: input.subjectId,
          requestId: input.coachRequestId,
          status: { in: ['READY', 'SUBMITTED', 'GRADED', 'SAVED'] },
          expiresAt: { gt: input.now },
        },
      },
      select: {
        prompt: true,
        exercise: {
          select: { schemaVersion: true, updatedAt: true, expiresAt: true },
        },
      },
    });
    return item
      ? {
          prompt: item.prompt,
          schemaVersion: item.exercise.schemaVersion,
          updatedAt: item.exercise.updatedAt,
          expiresAt: item.exercise.expiresAt,
        }
      : null;
  }
}

export class PronunciationTargetResolutionError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'RESOURCE_NOT_FOUND') {
    super(code);
    this.name = 'PronunciationTargetResolutionError';
  }
}

const emptyEvidence: PronunciationTargetSourceEvidence = Object.freeze({
  wordId: null,
  courseId: null,
  knowledgeCitationId: null,
  coachRequestId: null,
  exerciseId: null,
  itemId: null,
  sourceRecordType: null,
  sourceRecordId: null,
  sourceVersion: null,
  sourceContentHash: null,
  sourceRightsVersion: null,
});

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class PronunciationTargetService {
  constructor(
    private readonly repository: PronunciationTargetRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(
    input: Readonly<{
      subjectId: string;
      locale: PronunciationLocale;
      target: unknown;
    }>,
  ): Promise<ResolvedPronunciationTarget> {
    if (!input.subjectId) {
      throw new PronunciationTargetResolutionError('RESOURCE_NOT_FOUND');
    }
    const parsed = pronunciationTargetInputSchema.safeParse(input.target);
    if (!parsed.success) {
      throw new PronunciationTargetResolutionError('VALIDATION_FAILED');
    }
    const authorizedAt = this.now();
    let normalized: NormalizedPronunciationTarget;
    let evidence: PronunciationTargetSourceEvidence = emptyEvidence;
    let expiresAt: Date | null = null;

    if (parsed.data.sourceType === 'MANUAL') {
      normalized = normalizePronunciationTarget(parsed.data.text);
    } else if (parsed.data.sourceType === 'WORD_BOOK') {
      const word = await this.repository.findWord(parsed.data.wordId);
      if (!word)
        throw new PronunciationTargetResolutionError('RESOURCE_NOT_FOUND');
      normalized = normalizePronunciationTarget(word.word);
      evidence = Object.freeze({
        ...emptyEvidence,
        wordId: word.id,
        sourceRecordType: 'WORD_BOOK',
        sourceRecordId: word.id,
        sourceVersion: word.updatedAt.toISOString(),
        sourceContentHash: hash(normalized.referenceText),
      });
    } else if (parsed.data.sourceType === 'COACH_EXERCISE') {
      const item = await this.repository.findOwnedCoachExerciseItem({
        subjectId: input.subjectId,
        coachRequestId: parsed.data.coachRequestId,
        exerciseId: parsed.data.exerciseId,
        itemId: parsed.data.itemId,
        now: authorizedAt,
      });
      if (!item)
        throw new PronunciationTargetResolutionError('RESOURCE_NOT_FOUND');
      normalized = normalizePronunciationTarget(item.prompt);
      expiresAt = item.expiresAt;
      evidence = Object.freeze({
        ...emptyEvidence,
        coachRequestId: parsed.data.coachRequestId,
        exerciseId: parsed.data.exerciseId,
        itemId: parsed.data.itemId,
        sourceRecordType: 'COACH_EXERCISE_ITEM',
        sourceRecordId: parsed.data.itemId,
        sourceVersion: `${item.schemaVersion}:${item.updatedAt.toISOString()}`,
        sourceContentHash: hash(normalized.referenceText),
      });
    } else {
      throw new PronunciationTargetResolutionError('RESOURCE_NOT_FOUND');
    }

    return Object.freeze({
      ...normalized,
      ...evidence,
      sourceType: parsed.data.sourceType,
      languageTag: input.locale,
      targetHash: hash({
        sourceType: parsed.data.sourceType,
        locale: input.locale,
        referenceText: normalized.referenceText,
        normalizedTokens: normalized.normalizedTokens,
        sourceVersion: evidence.sourceVersion,
      }),
      authorizedAt,
      expiresAt,
    });
  }
}
