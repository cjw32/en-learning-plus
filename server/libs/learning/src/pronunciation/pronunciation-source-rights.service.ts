import { createHash } from 'node:crypto';
import type { PronunciationLocale } from '@en/common/pronunciation';
import { normalizePronunciationTarget } from './pronunciation-target-normalizer';
import type { ResolvedPronunciationTarget } from './pronunciation-target.service';

export const PRONUNCIATION_SOURCE_RIGHTS_REPOSITORY = Symbol(
  'PRONUNCIATION_SOURCE_RIGHTS_REPOSITORY',
);

export type PronunciationContentRight = 'pronunciationAssessment';

export type PronunciationAuthorizedSourceRecord = Readonly<{
  ownerUserId: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'DELETED';
  referenceText: string;
  sourceRecordType: string;
  sourceRecordId: string;
  sourceVersion: string;
  sourceContentHash: string;
  sourceRightsVersion: string;
  allowedUses: readonly string[];
  validFrom: Date | null;
  validUntil: Date | null;
}>;

export interface PronunciationSourceRightsRepository {
  findOwnedCourseWord(
    input: Readonly<{
      subjectId: string;
      courseId: string;
      wordId: string;
    }>,
  ): Promise<PronunciationAuthorizedSourceRecord | null>;
  findOwnedCitation(
    input: Readonly<{
      subjectId: string;
      citationId: string;
    }>,
  ): Promise<PronunciationAuthorizedSourceRecord | null>;
}

export class UnavailablePronunciationSourceRightsRepository implements PronunciationSourceRightsRepository {
  findOwnedCourseWord(): Promise<null> {
    return Promise.resolve(null);
  }
  findOwnedCitation(): Promise<null> {
    return Promise.resolve(null);
  }
}

export class PronunciationSourceRightsError extends Error {
  readonly code = 'SOURCE_UNAVAILABLE';

  constructor() {
    super('Pronunciation source is unavailable');
    this.name = 'PronunciationSourceRightsError';
  }
}

export type PronunciationSourceSnapshot = Readonly<{
  sourceVersion: string;
  sourceContentHash: string;
  sourceRightsVersion: string;
}>;

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export class PronunciationSourceRightsService {
  constructor(
    private readonly repository: PronunciationSourceRightsRepository,
    private readonly enabled = false,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(
    input: Readonly<{
      subjectId: string;
      locale: PronunciationLocale;
      target:
        | Readonly<{
            sourceType: 'COURSE_WORD';
            courseId: string;
            wordId: string;
          }>
        | Readonly<{
            sourceType: 'RAG_CITATION';
            citationId: string;
            selection: Readonly<{ start: number; end: number }>;
          }>;
      expected?: PronunciationSourceSnapshot;
    }>,
  ): Promise<ResolvedPronunciationTarget> {
    if (!this.enabled || !input.subjectId) this.unavailable();
    const authorizedAt = this.now();
    const record =
      input.target.sourceType === 'COURSE_WORD'
        ? await this.repository.findOwnedCourseWord({
            subjectId: input.subjectId,
            courseId: input.target.courseId,
            wordId: input.target.wordId,
          })
        : await this.repository.findOwnedCitation({
            subjectId: input.subjectId,
            citationId: input.target.citationId,
          });
    this.assertAuthorized(
      record,
      input.subjectId,
      authorizedAt,
      input.expected,
    );

    const selectedText =
      input.target.sourceType === 'RAG_CITATION'
        ? record.referenceText.slice(
            input.target.selection.start,
            input.target.selection.end,
          )
        : record.referenceText;
    if (
      input.target.sourceType === 'RAG_CITATION' &&
      (input.target.selection.start < 0 ||
        input.target.selection.end <= input.target.selection.start ||
        input.target.selection.end > record.referenceText.length)
    ) {
      this.unavailable();
    }
    const normalized = normalizePronunciationTarget(selectedText);
    const sourceType = input.target.sourceType;
    const targetHash = contentHash(
      JSON.stringify({
        sourceType,
        locale: input.locale,
        referenceText: normalized.referenceText,
        sourceVersion: record.sourceVersion,
        sourceRightsVersion: record.sourceRightsVersion,
      }),
    );
    return Object.freeze({
      ...normalized,
      sourceType,
      languageTag: input.locale,
      targetHash,
      wordId:
        input.target.sourceType === 'COURSE_WORD' ? input.target.wordId : null,
      courseId:
        input.target.sourceType === 'COURSE_WORD'
          ? input.target.courseId
          : null,
      knowledgeCitationId:
        input.target.sourceType === 'RAG_CITATION'
          ? input.target.citationId
          : null,
      coachRequestId: null,
      exerciseId: null,
      itemId: null,
      sourceRecordType: record.sourceRecordType,
      sourceRecordId: record.sourceRecordId,
      sourceVersion: record.sourceVersion,
      sourceContentHash: record.sourceContentHash,
      sourceRightsVersion: record.sourceRightsVersion,
      authorizedAt,
      expiresAt: record.validUntil,
    });
  }

  async revalidate(
    input: Readonly<{
      subjectId: string;
      sourceType: 'COURSE_WORD' | 'RAG_CITATION';
      courseId: string | null;
      wordId: string | null;
      knowledgeCitationId: string | null;
      expected: PronunciationSourceSnapshot;
    }>,
  ): Promise<void> {
    if (!this.enabled || !input.subjectId) this.unavailable();
    const record =
      input.sourceType === 'COURSE_WORD' && input.courseId && input.wordId
        ? await this.repository.findOwnedCourseWord({
            subjectId: input.subjectId,
            courseId: input.courseId,
            wordId: input.wordId,
          })
        : input.sourceType === 'RAG_CITATION' && input.knowledgeCitationId
          ? await this.repository.findOwnedCitation({
              subjectId: input.subjectId,
              citationId: input.knowledgeCitationId,
            })
          : null;
    this.assertAuthorized(record, input.subjectId, this.now(), input.expected);
  }

  private assertAuthorized(
    record: PronunciationAuthorizedSourceRecord | null,
    subjectId: string,
    at: Date,
    expected?: PronunciationSourceSnapshot,
  ): asserts record is PronunciationAuthorizedSourceRecord {
    if (
      !record ||
      record.ownerUserId !== subjectId ||
      record.status !== 'ACTIVE' ||
      !record.allowedUses.includes('pronunciationAssessment') ||
      (record.validFrom !== null && at < record.validFrom) ||
      (record.validUntil !== null && at >= record.validUntil) ||
      record.sourceContentHash !== contentHash(record.referenceText) ||
      (expected !== undefined &&
        (record.sourceVersion !== expected.sourceVersion ||
          record.sourceContentHash !== expected.sourceContentHash ||
          record.sourceRightsVersion !== expected.sourceRightsVersion))
    ) {
      this.unavailable();
    }
  }

  private unavailable(): never {
    throw new PronunciationSourceRightsError();
  }
}
