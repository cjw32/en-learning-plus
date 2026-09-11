import {
  PrismaLearningResourceRepository,
  type AuthorizedCourseMaterialRecord,
} from './learning-resource.repository';
import { LearningResourceReadService } from './learning-resource-read.service';

const at = new Date('2026-09-11T08:00:00.000Z');

const record: AuthorizedCourseMaterialRecord = Object.freeze({
  documentId: 'document_material_1',
  courseId: 'course_business',
  materialId: 'material_meeting_1',
  title: ' Leading a project meeting ',
  contentVersion: 'course-release.v3',
  sourceUpdatedAt: new Date('2026-09-10T08:00:00.000Z'),
  sourceKey: 'approved-course-source',
  sourceName: 'Approved business English course',
  rightsVersion: 'rights.v2',
  releaseContentVersion: 'course-release.v3',
  releaseRightsVersion: 'rights.v2',
  entitledUserIds: Object.freeze(['learner_a']),
  chunks: Object.freeze([
    Object.freeze({
      id: 'chunk_1',
      ordinal: 0,
      content: 'Open the meeting with a clear objective.',
      contentVersion: 'course-release.v3',
      courseId: 'course_business',
    }),
    Object.freeze({
      id: 'chunk_2',
      ordinal: 1,
      content: 'Close by confirming owners and deadlines.',
      contentVersion: 'course-release.v3',
      courseId: 'course_business',
    }),
  ]),
});

describe('LearningResourceReadService', () => {
  it('returns only an entitled, active, rights-approved projection', async () => {
    const repository = {
      findAuthorizedCourseMaterial: jest.fn(async () => record),
    };
    const service = new LearningResourceReadService(repository, () => at);
    await expect(
      service.readCourseMaterial({
        userId: 'learner_a',
        courseId: 'course_business',
        materialId: 'material_meeting_1',
      }),
    ).resolves.toMatchObject({
      courseId: 'course_business',
      materialId: 'material_meeting_1',
      title: 'Leading a project meeting',
      summary:
        'Open the meeting with a clear objective. Close by confirming owners and deadlines.',
      locator: 'course/course_business/materials/material_meeting_1',
      source: {
        citationId: expect.stringMatching(/^cit_[a-f0-9]{24}$/),
        source: 'approved-course-source',
        contentVersion: 'course-release.v3',
        accessScope: 'OWNED_COURSE',
        status: 'active',
      },
    });
    expect(repository.findAuthorizedCourseMaterial).toHaveBeenCalledWith({
      userId: 'learner_a',
      courseId: 'course_business',
      materialId: 'material_meeting_1',
      at,
    });
  });

  it.each([
    { entitledUserIds: ['learner_b'] },
    { releaseContentVersion: 'stale-release.v2' },
    { releaseRightsVersion: 'stale-rights.v1' },
    {
      chunks: [
        {
          ...record.chunks[0],
          courseId: 'course_other',
        },
      ],
    },
  ])(
    'fails closed for inconsistent ownership/version data %#',
    async (change) => {
      const repository = {
        findAuthorizedCourseMaterial: jest.fn(async () => ({
          ...record,
          ...change,
        })),
      };
      const service = new LearningResourceReadService(repository, () => at);
      await expect(
        service.readCourseMaterial({
          userId: 'learner_a',
          courseId: 'course_business',
          materialId: 'material_meeting_1',
        }),
      ).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'The resource is unavailable.',
      });
    },
  );

  it('rejects prohibited answer-key content rather than projecting it', async () => {
    const repository = {
      findAuthorizedCourseMaterial: jest.fn(async () => ({
        ...record,
        chunks: [
          {
            ...record.chunks[0],
            content: 'Answer key: the correct answer is private.',
          },
        ],
      })),
    };
    const service = new LearningResourceReadService(repository, () => at);
    await expect(
      service.readCourseMaterial({
        userId: 'learner_a',
        courseId: 'course_business',
        materialId: 'material_meeting_1',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_RIGHTS_DENIED' });
  });
});

describe('PrismaLearningResourceRepository', () => {
  it('constrains entitlement, active release, source rights, scope, and ordering in one query', async () => {
    const prisma = {
      knowledgeDocument: { findFirst: jest.fn(async () => null) },
    };
    const repository = new PrismaLearningResourceRepository(prisma as never);
    await repository.findAuthorizedCourseMaterial({
      userId: 'learner_a',
      courseId: 'course_business',
      materialId: 'material_meeting_1',
      at,
    });

    expect(prisma.knowledgeDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          courseId: 'course_business',
          sourceRecordId: 'material_meeting_1',
          accessScope: 'OWNED_COURSE',
          visibility: 'private',
          status: 'ACTIVE',
          course: {
            is: {
              courseRecords: {
                some: { userId: 'learner_a', isPurchased: true },
              },
            },
          },
          release: { is: { status: 'ACTIVE', invalidatedAt: null } },
          knowledgeSource: expect.objectContaining({
            is: expect.objectContaining({
              status: 'ACTIVE',
              allowExcerptDisplay: true,
              verifiedAt: { not: null },
              revokedAt: null,
              deletedAt: null,
            }),
          }),
        }),
        orderBy: [{ sourceUpdatedAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });
});
