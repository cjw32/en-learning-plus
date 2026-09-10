import { createHash } from 'node:crypto';
import {
  PronunciationSourceRightsService,
  type PronunciationAuthorizedSourceRecord,
  type PronunciationSourceRightsRepository,
} from './pronunciation-source-rights.service';

const now = new Date('2026-09-10T00:00:00.000Z');
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function record(
  overrides: Partial<PronunciationAuthorizedSourceRecord> = {},
): PronunciationAuthorizedSourceRecord {
  const referenceText = overrides.referenceText ?? 'hello world';
  return {
    ownerUserId: 'user-1',
    status: 'ACTIVE',
    referenceText,
    sourceRecordType: 'COURSE_WORD',
    sourceRecordId: 'word-1',
    sourceVersion: 'content-v1',
    sourceContentHash: hash(referenceText),
    sourceRightsVersion: 'rights-v1',
    allowedUses: ['pronunciationAssessment'],
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validUntil: new Date('2027-01-01T00:00:00Z'),
    ...overrides,
  };
}

function service(
  value: PronunciationAuthorizedSourceRecord | null,
  enabled = true,
) {
  const repository: PronunciationSourceRightsRepository = {
    findOwnedCourseWord: jest.fn().mockResolvedValue(value),
    findOwnedCitation: jest.fn().mockResolvedValue(value),
  };
  return new PronunciationSourceRightsService(repository, enabled, () => now);
}

const courseTarget = {
  sourceType: 'COURSE_WORD' as const,
  courseId: 'course-1',
  wordId: 'word-1',
};

describe('PronunciationSourceRightsService', () => {
  it('is disabled by default', async () => {
    await expect(
      new PronunciationSourceRightsService({
        findOwnedCourseWord: jest.fn(),
        findOwnedCitation: jest.fn(),
      }).resolve({
        subjectId: 'user-1',
        locale: 'en-US',
        target: courseTarget,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });

  it('accepts only an explicit pronunciationAssessment right', async () => {
    await expect(
      service(record()).resolve({
        subjectId: 'user-1',
        locale: 'en-US',
        target: courseTarget,
      }),
    ).resolves.toMatchObject({
      sourceType: 'COURSE_WORD',
      referenceText: 'hello world',
      sourceVersion: 'content-v1',
      sourceContentHash: hash('hello world'),
    });
    await expect(
      service(record({ allowedUses: ['excerptDisplay'] })).resolve({
        subjectId: 'user-1',
        locale: 'en-US',
        target: courseTarget,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });

  it.each([
    { status: 'REVOKED' as const },
    { status: 'EXPIRED' as const },
    { validUntil: now },
    { ownerUserId: 'other-user' },
  ])('rejects revoked, expired or cross-owner source %#', async (override) => {
    await expect(
      service(record(override)).resolve({
        subjectId: 'user-1',
        locale: 'en-US',
        target: courseTarget,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });

  it('rejects wrong version/content/rights during revalidation', async () => {
    const targetService = service(record());
    for (const expected of [
      {
        sourceVersion: 'wrong',
        sourceContentHash: hash('hello world'),
        sourceRightsVersion: 'rights-v1',
      },
      {
        sourceVersion: 'content-v1',
        sourceContentHash: 'wrong',
        sourceRightsVersion: 'rights-v1',
      },
      {
        sourceVersion: 'content-v1',
        sourceContentHash: hash('hello world'),
        sourceRightsVersion: 'wrong',
      },
    ]) {
      await expect(
        targetService.resolve({
          subjectId: 'user-1',
          locale: 'en-US',
          target: courseTarget,
          expected,
        }),
      ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    }
  });

  it('takes RAG selection offsets only from the server-authorized excerpt', async () => {
    const citation = record({
      referenceText: 'Say hello clearly.',
      sourceContentHash: hash('Say hello clearly.'),
      sourceRecordType: 'KNOWLEDGE_CITATION',
      sourceRecordId: 'citation-1',
    });
    await expect(
      service(citation).resolve({
        subjectId: 'user-1',
        locale: 'en-US',
        target: {
          sourceType: 'RAG_CITATION',
          citationId: 'citation-1',
          selection: { start: 4, end: 9 },
        },
      }),
    ).resolves.toMatchObject({
      referenceText: 'hello',
      knowledgeCitationId: 'citation-1',
    });
    await expect(
      service(citation).resolve({
        subjectId: 'user-1',
        locale: 'en-US',
        target: {
          sourceType: 'RAG_CITATION',
          citationId: 'citation-1',
          selection: { start: 4, end: 99 },
        },
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });
});
