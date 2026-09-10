import { createHash } from 'node:crypto';
import {
  citationIdSchema,
  publicCoachCitationV2Schema,
  publicCoachResultV2Schema,
  storedCoachResultV2Schema,
  type CitationLocator,
  type PublicCoachCitationV2,
  type PublicCoachResultV2,
  type StoredCoachResultV2,
} from '@en/common/coach';
import type {
  CitationProjectionCandidate,
  CitationProjectionRepository,
} from './citation.repository';

const invalidCitationId = 'cit_unavailable_000000';
const unsafeExcerpt =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:bearer\s+)?eyJ[A-Za-z0-9_-]{8,}\./i;

function normalizeExcerpt(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function unavailable(citationId: string): PublicCoachCitationV2 {
  return publicCoachCitationV2Schema.parse({
    citationId,
    status: 'unavailable',
    reason: 'SOURCE_UNAVAILABLE',
  });
}

function safeLocator(
  candidate: CitationProjectionCandidate,
): CitationLocator | null {
  const document = candidate.document;
  const chunk = candidate.chunk;
  if (!document || !chunk) return null;
  const wordId = chunk.wordId ?? document.wordId;
  if (wordId && /^[A-Za-z0-9_-]{1,128}$/.test(wordId)) {
    return { kind: 'word', id: wordId };
  }
  const courseId = chunk.courseId ?? document.courseId;
  if (courseId && /^[A-Za-z0-9_-]{1,128}$/.test(courseId)) {
    return { kind: 'course', id: courseId };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(document.sourceRecordId)) return null;
  if (document.sourceRecordType === 'Grammar') {
    return { kind: 'grammar', id: document.sourceRecordId };
  }
  if (document.sourceRecordType === 'Exercise') {
    return { kind: 'exercise', id: document.sourceRecordId };
  }
  return null;
}

export class CitationProjectionService {
  constructor(
    private readonly repository: CitationProjectionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(input: {
    subjectId: string;
    citationId: string;
  }): Promise<PublicCoachCitationV2> {
    const safeId = citationIdSchema.safeParse(input.citationId);
    if (!safeId.success || !input.subjectId.trim()) {
      return unavailable(invalidCitationId);
    }
    const candidate = await this.repository.findForSubject(
      input.subjectId,
      safeId.data,
    );
    if (!(await this.isCurrentlyAuthorized(input.subjectId, candidate))) {
      return unavailable(safeId.data);
    }
    const chunk = candidate!.chunk!;
    const document = candidate!.document!;
    const excerpt = normalizeExcerpt(candidate!.storedExcerpt!);
    return publicCoachCitationV2Schema.parse({
      citationId: candidate!.citationId,
      status: 'active',
      source: chunk.source,
      title: chunk.title,
      category: chunk.category,
      excerpt,
      accessScope: document.accessScope,
      locator: safeLocator(candidate!),
    });
  }

  async resolveMany(input: {
    subjectId: string;
    citationIds: readonly string[];
  }): Promise<readonly PublicCoachCitationV2[]> {
    const unique = [...new Set(input.citationIds)];
    return Promise.all(
      unique.map((citationId) =>
        this.resolve({ subjectId: input.subjectId, citationId }),
      ),
    );
  }

  async projectResult(
    subjectId: string,
    input: StoredCoachResultV2 | PublicCoachResultV2,
  ): Promise<PublicCoachResultV2> {
    const stored = storedCoachResultV2Schema.safeParse(input);
    const citationIds = stored.success
      ? stored.data.citationIds
      : publicCoachResultV2Schema
          .parse(input)
          .citations.map((citation) => citation.citationId);
    const stable = stored.success
      ? (() => {
          const { citationIds: _citationIds, ...rest } = stored.data;
          return rest;
        })()
      : (() => {
          const { citations: _citations, ...rest } =
            publicCoachResultV2Schema.parse(input);
          return rest;
        })();
    return publicCoachResultV2Schema.parse({
      ...stable,
      citations: await this.resolveMany({ subjectId, citationIds }),
    });
  }

  private async isCurrentlyAuthorized(
    subjectId: string,
    candidate: CitationProjectionCandidate | null,
  ): Promise<boolean> {
    if (!candidate || !candidate.chunk || !candidate.document) return false;
    const { chunk, document } = candidate;
    const source = document.knowledgeSource;
    const now = this.now();
    if (
      candidate.requestUserId !== subjectId ||
      candidate.citationStatus !== 'ACTIVE' ||
      chunk.status !== 'ACTIVE' ||
      document.status !== 'ACTIVE' ||
      document.release.status !== 'ACTIVE' ||
      source.status !== 'ACTIVE' ||
      !source.allowExcerptDisplay ||
      source.verifiedAt === null ||
      source.revokedAt !== null ||
      source.deletedAt !== null ||
      (source.validFrom !== null && source.validFrom > now) ||
      (source.validUntil !== null && source.validUntil <= now) ||
      candidate.contentVersion !== chunk.contentVersion ||
      candidate.contentVersion !== document.contentVersion ||
      candidate.contentVersion !== document.release.contentVersion
    ) {
      return false;
    }
    const storedExcerpt = candidate.storedExcerpt
      ? normalizeExcerpt(candidate.storedExcerpt)
      : '';
    const currentChunk = normalizeExcerpt(chunk.content);
    if (
      !storedExcerpt ||
      storedExcerpt.length > 2000 ||
      unsafeExcerpt.test(storedExcerpt) ||
      hash(storedExcerpt) !== candidate.excerptHash ||
      !currentChunk.includes(storedExcerpt)
    ) {
      return false;
    }
    if (document.accessScope === 'PUBLIC') return true;
    if (document.accessScope === 'PRIVATE_OWNER') {
      return document.userId === subjectId && chunk.userId === subjectId;
    }
    const courseId = document.courseId;
    if (
      document.accessScope !== 'OWNED_COURSE' ||
      !courseId ||
      chunk.courseId !== courseId
    ) {
      return false;
    }
    return this.repository.hasPurchasedCourse(subjectId, courseId);
  }
}
