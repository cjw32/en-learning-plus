import { createHash } from 'node:crypto';
import type {
  AuthorizedCourseMaterialRecord,
  LearningResourceRepository,
} from './learning-resource.repository';

export type CourseMaterialReadResult = Readonly<{
  courseId: string;
  materialId: string;
  title: string;
  summary: string;
  locator: string;
  source: Readonly<{
    citationId: string;
    source: string;
    title: string;
    excerpt: string;
    contentVersion: string;
    accessScope: 'OWNED_COURSE';
    status: 'active';
  }>;
  contentVersion: string;
  updatedAt: Date;
}>;

export class LearningResourceReadError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'SOURCE_RIGHTS_DENIED',
  ) {
    super('The resource is unavailable.');
    this.name = 'LearningResourceReadError';
  }
}

const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const unsafeContent =
  /\b(?:answer\s*key|correct\s*answer|grading\s*rubric|system\s*prompt|bearer\s+[A-Za-z0-9._~-]+)\b/iu;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function isConsistent(
  record: AuthorizedCourseMaterialRecord,
  input: Readonly<{ userId: string; courseId: string; materialId: string }>,
): boolean {
  return (
    record.courseId === input.courseId &&
    record.materialId === input.materialId &&
    record.entitledUserIds.length === 1 &&
    record.entitledUserIds[0] === input.userId &&
    record.contentVersion === record.releaseContentVersion &&
    record.rightsVersion === record.releaseRightsVersion &&
    record.chunks.length > 0 &&
    record.chunks.every(
      (chunk) =>
        chunk.courseId === input.courseId &&
        chunk.contentVersion === record.contentVersion,
    )
  );
}

export class LearningResourceReadService {
  constructor(
    private readonly repository: LearningResourceRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readCourseMaterial(
    input: Readonly<{
      userId: string;
      courseId: string;
      materialId: string;
    }>,
  ): Promise<CourseMaterialReadResult> {
    if (
      !input.userId.trim() ||
      !identifier.test(input.courseId) ||
      !identifier.test(input.materialId)
    ) {
      throw new LearningResourceReadError('VALIDATION_FAILED');
    }
    const record = await this.repository.findAuthorizedCourseMaterial({
      ...input,
      at: this.now(),
    });
    if (!record || !isConsistent(record, input)) {
      throw new LearningResourceReadError('RESOURCE_NOT_FOUND');
    }

    const summary = normalize(
      record.chunks.map(({ content }) => content).join(' '),
    ).slice(0, 8_000);
    if (!summary || unsafeContent.test(summary)) {
      throw new LearningResourceReadError('SOURCE_RIGHTS_DENIED');
    }
    const citationId = `cit_${hash(
      `${record.sourceKey}\0${record.documentId}\0${record.contentVersion}`,
    ).slice(0, 24)}`;

    return Object.freeze({
      courseId: record.courseId,
      materialId: record.materialId,
      title: normalize(record.title).slice(0, 300),
      summary,
      locator: `course/${record.courseId}/materials/${record.materialId}`,
      source: Object.freeze({
        citationId,
        source: record.sourceKey,
        title: record.sourceName,
        excerpt: summary.slice(0, 2_000),
        contentVersion: record.contentVersion,
        accessScope: 'OWNED_COURSE' as const,
        status: 'active' as const,
      }),
      contentVersion: record.contentVersion,
      updatedAt: new Date(record.sourceUpdatedAt),
    });
  }
}
