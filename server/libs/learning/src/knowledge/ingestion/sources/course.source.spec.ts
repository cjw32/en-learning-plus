import {
  InMemoryKnowledgeSourceRightsRepository,
  SourceRightsService,
} from '../source-rights.service';
import { CourseKnowledgeSourceAdapter } from './course.source';

const now = new Date('2026-09-08T00:00:00.000Z');

function adapter() {
  return new CourseKnowledgeSourceAdapter(
    new SourceRightsService(
      new InMemoryKnowledgeSourceRightsRepository([
        {
          sourceKey: 'course-source',
          name: 'Synthetic course',
          sourceType: 'COURSE',
          rightsVersion: 'rights.test.v1',
          status: 'ACTIVE',
          allowEmbedding: true,
          allowExcerptDisplay: true,
          allowEvaluation: true,
          verifiedAt: now,
          validFrom: null,
          validUntil: null,
          fieldPolicies: [
            {
              recordType: 'Course',
              fieldName: 'content',
              allowEmbedding: true,
              allowExcerptDisplay: true,
              allowEvaluation: true,
              contentCategory: 'COURSE_LESSON',
              policyVersion: 'policy.v1',
            },
          ],
        },
      ]),
    ),
  );
}

describe('CourseKnowledgeSourceAdapter', () => {
  it('keeps real chapter, lesson and knowledge-point boundaries', async () => {
    const result = await adapter().project({
      sourceKey: 'course-source',
      at: now,
      record: {
        id: 'course-record-1',
        courseId: 'course-1',
        title: 'Synthetic course',
        contentVersion: 'course-content.v1',
        updatedAt: now,
        chapters: [
          {
            id: 'chapter-1',
            title: 'Chapter 1',
            lessons: [
              {
                id: 'lesson-1',
                title: 'Lesson 1',
                content: 'Lesson content remains its own semantic unit.',
                knowledgePoints: [
                  {
                    id: 'point-1',
                    title: 'Point 1',
                    content: 'Knowledge point content remains a separate unit.',
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result).toMatchObject({
      available: true,
      accessScope: 'OWNED_COURSE',
      courseId: 'course-1',
      contentVersion: 'course-content.v1',
    });
    if (!result.available) throw new Error('expected available course source');
    expect(result.sections.map((section) => section.key)).toEqual([
      'chapter:chapter-1:lesson:lesson-1',
      'chapter:chapter-1:lesson:lesson-1:point:point-1',
    ]);
  });

  it('returns unavailable without course body and rejects mixed versions', async () => {
    await expect(
      adapter().project({
        sourceKey: 'course-source',
        at: now,
        record: {
          id: 'empty',
          courseId: 'course-1',
          title: 'Empty',
          contentVersion: 'course-content.v1',
          updatedAt: now,
          chapters: [],
        },
      }),
    ).resolves.toEqual({ available: false, reason: 'NO_CONTENT' });

    await expect(
      adapter().project({
        sourceKey: 'course-source',
        at: now,
        record: {
          id: 'mixed',
          courseId: 'course-1',
          title: 'Mixed',
          contentVersion: 'course-content.v1',
          updatedAt: now,
          chapters: [
            {
              id: 'chapter-1',
              title: 'Chapter 1',
              lessons: [
                {
                  id: 'lesson-1',
                  title: 'Lesson 1',
                  content: 'Wrong-version content.',
                  contentVersion: 'course-content.v2',
                },
              ],
            },
          ],
        },
      }),
    ).resolves.toEqual({
      available: false,
      reason: 'CONTENT_SCOPE_MISMATCH',
    });
  });
});
