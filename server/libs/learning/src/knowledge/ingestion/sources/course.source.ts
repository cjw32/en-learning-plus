import { PublicLearningField } from '../chunkers/public-learning.chunker';
import { SourceRightsService } from '../source-rights.service';

export type CourseKnowledgeRecord = Readonly<{
  id: string;
  courseId: string;
  title: string;
  contentVersion: string;
  updatedAt: Date;
  chapters: readonly Readonly<{
    id: string;
    title: string;
    lessons: readonly Readonly<{
      id: string;
      title: string;
      content?: string | null;
      contentVersion?: string;
      accessScope?: 'OWNED_COURSE';
      knowledgePoints?: readonly Readonly<{
        id: string;
        title: string;
        content: string;
        contentVersion?: string;
        accessScope?: 'OWNED_COURSE';
      }>[];
    }>[];
  }>[];
}>;

type CourseSection = PublicLearningField &
  Readonly<{
    fieldName: 'content';
    chapterId: string;
    lessonId: string;
    knowledgePointId: string | null;
  }>;

export class CourseKnowledgeSourceAdapter {
  constructor(private readonly rights: SourceRightsService) {}

  async project(input: {
    sourceKey: string;
    record: CourseKnowledgeRecord | null;
    at?: Date;
  }): Promise<
    | Readonly<{
        available: false;
        reason:
          | 'SOURCE_RECORD_UNAVAILABLE'
          | 'NO_CONTENT'
          | 'CONTENT_SCOPE_MISMATCH';
      }>
    | Readonly<{
        available: true;
        source: string;
        sourceId: string;
        recordType: 'Course';
        recordId: string;
        title: string;
        courseId: string;
        contentVersion: string;
        accessScope: 'OWNED_COURSE';
        visibility: 'private';
        sourceUpdatedAt: Date;
        rightsVersion: string;
        sections: readonly CourseSection[];
      }>
  > {
    if (!input.record) {
      return { available: false, reason: 'SOURCE_RECORD_UNAVAILABLE' };
    }

    const sections: CourseSection[] = [];
    for (const chapter of input.record.chapters) {
      for (const lesson of chapter.lessons) {
        if (
          (lesson.contentVersion &&
            lesson.contentVersion !== input.record.contentVersion) ||
          (lesson.accessScope && lesson.accessScope !== 'OWNED_COURSE')
        ) {
          return { available: false, reason: 'CONTENT_SCOPE_MISMATCH' };
        }
        const lessonContent = lesson.content?.normalize('NFKC').trim();
        if (lessonContent) {
          sections.push({
            fieldName: 'content',
            key: `chapter:${chapter.id}:lesson:${lesson.id}`,
            category: 'COURSE_LESSON',
            content: lessonContent,
            factKey: `course:${input.record.courseId}:lesson:${lesson.id}`,
            authorityRank: null,
            chapterId: chapter.id,
            lessonId: lesson.id,
            knowledgePointId: null,
          });
        }
        for (const point of lesson.knowledgePoints ?? []) {
          if (
            (point.contentVersion &&
              point.contentVersion !== input.record.contentVersion) ||
            (point.accessScope && point.accessScope !== 'OWNED_COURSE')
          ) {
            return { available: false, reason: 'CONTENT_SCOPE_MISMATCH' };
          }
          const pointContent = point.content.normalize('NFKC').trim();
          if (!pointContent) continue;
          sections.push({
            fieldName: 'content',
            key: `chapter:${chapter.id}:lesson:${lesson.id}:point:${point.id}`,
            category: 'COURSE_LESSON',
            content: pointContent,
            factKey: `course:${input.record.courseId}:point:${point.id}`,
            authorityRank: null,
            chapterId: chapter.id,
            lessonId: lesson.id,
            knowledgePointId: point.id,
          });
        }
      }
    }
    if (sections.length === 0) return { available: false, reason: 'NO_CONTENT' };

    const authorization = await this.rights.authorize({
      sourceKey: input.sourceKey,
      recordType: 'Course',
      fieldNames: ['content'],
      usage: 'embedding',
      at: input.at,
    });
    return Object.freeze({
      available: true as const,
      source: authorization.sourceKey,
      sourceId: `course:${input.record.courseId}:${input.record.id}`,
      recordType: 'Course' as const,
      recordId: input.record.id,
      title: input.record.title.normalize('NFKC').trim(),
      courseId: input.record.courseId,
      contentVersion: input.record.contentVersion,
      accessScope: 'OWNED_COURSE' as const,
      visibility: 'private' as const,
      sourceUpdatedAt: input.record.updatedAt,
      rightsVersion: authorization.rightsVersion,
      sections: Object.freeze(sections.map((section) => Object.freeze(section))),
    });
  }
}
