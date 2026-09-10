/* eslint-disable @typescript-eslint/no-unsafe-argument -- Synchronous test doubles preserve async ports; request fixtures intentionally exercise controller validation. */

import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, CoachExecutionContext } from '@libs/shared';
import { PronunciationAssessmentRuleError } from '../application/pronunciation-assessment.service';
import type { PronunciationAssessmentService } from '../application/pronunciation-assessment.service';
import type { PronunciationCancellationService } from '../governance/pronunciation-cancellation.service';
import {
  PronunciationController,
  type PronunciationAudioUploadWorkflow,
} from './pronunciation.controller';

const resource = {
  assessmentId: 'assessment-owner',
  status: 'CREATED',
  exerciseType: 'WORD',
  locale: 'en-US',
  referenceText: 'hello',
  retryOfAssessmentId: null,
  result: null,
  diagnostic: null,
  learningWriteStatus: 'NOT_ELIGIBLE',
  audio: { status: 'MISSING', available: false, expiresAt: null },
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
  traceId: 'assessment-owner',
} as const;

function authenticatedRequest() {
  return {
    coachContext: new CoachExecutionContext('user-a', 4_000_000_000),
  } as any;
}

describe('PronunciationController authentication and ownership', () => {
  const assessments = {
    create: jest.fn(async () => resource),
    list: jest.fn(async () => ({ items: [resource], nextCursor: null })),
    get: jest.fn(async (owner: string, id: string) => {
      if (owner !== 'user-a' || id !== resource.assessmentId) {
        throw new PronunciationAssessmentRuleError('RESOURCE_NOT_FOUND');
      }
      return resource;
    }),
    submit: jest.fn(async (owner: string, id: string) => {
      if (owner !== 'user-a' || id !== resource.assessmentId) {
        throw new PronunciationAssessmentRuleError('RESOURCE_NOT_FOUND');
      }
      return { ...resource, status: 'QUEUED' };
    }),
  };
  const cancellations = {
    cancel: jest.fn(async () => ({ status: 'CANCELLED' })),
  };
  const uploads = {
    upload: jest.fn(async () => ({ ...resource, status: 'AUDIO_VALIDATING' })),
  };
  const deletions = {
    request: jest.fn(async (input: any) => ({
      deletionId: 'delete_00000000001',
      status:
        input.scope === 'PRONUNCIATION_ASSESSMENT'
          ? 'COMPENSATING'
          : 'ACCEPTED',
      hiddenAt: '2026-09-10T00:00:00.000Z',
      purgeDeadline: '2026-09-10T01:00:00.000Z',
      completedAt: null,
    })),
    status: jest.fn(async () => ({
      deletionId: 'delete_00000000001',
      status: 'PURGING',
      hiddenAt: '2026-09-10T00:00:00.000Z',
      purgeDeadline: '2026-09-10T01:00:00.000Z',
      completedAt: null,
    })),
  };
  const retries = {
    retry: jest.fn(async () => ({
      assessment: { id: 'assessment-retry' },
    })),
  };
  const controller = new PronunciationController(
    assessments as unknown as PronunciationAssessmentService,
    cancellations as unknown as PronunciationCancellationService,
    uploads as unknown as PronunciationAudioUploadWorkflow,
    deletions as never,
    retries as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('is protected by the shared access-token AuthGuard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PronunciationController),
    ).toContain(AuthGuard);
  });

  it('creates and lists envelopes using only the authenticated subject', async () => {
    await expect(
      controller.create(authenticatedRequest(), 'create-key-000001', {
        locale: 'en-US',
        target: { sourceType: 'MANUAL', text: 'hello' },
      }),
    ).resolves.toEqual({ code: 201, data: resource });
    expect(assessments.create).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 'user-a' }),
    );

    await expect(
      controller.list(authenticatedRequest(), { limit: '10' }),
    ).resolves.toEqual({
      code: 200,
      data: { items: [resource], nextCursor: null },
    });
    expect(assessments.list).toHaveBeenCalledWith({
      subjectId: 'user-a',
      cursor: undefined,
      limit: 10,
    });
  });

  it('returns the same safe not-found shape for foreign and absent IDs', async () => {
    const failures: unknown[] = [];
    for (const id of ['assessment-foreign', 'assessment-absent']) {
      try {
        await controller.get(authenticatedRequest(), id);
        throw new Error('expected get to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const response = (error as HttpException).getResponse() as any;
        expect(response.error).toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
          category: 'TARGET',
          retryable: false,
        });
        expect(JSON.stringify(response)).not.toContain('user');
        failures.push({
          ...response,
          error: { ...response.error, assessmentId: null, traceId: null },
        });
      }
    }
    expect(failures[0]).toEqual(failures[1]);
  });

  it('validates idempotency keys before submit and returns a durable 202', async () => {
    await expect(
      controller.submit(authenticatedRequest(), resource.assessmentId, 'short'),
    ).rejects.toMatchObject({ status: 400 });
    expect(assessments.submit).not.toHaveBeenCalled();

    await expect(
      controller.submit(
        authenticatedRequest(),
        resource.assessmentId,
        'submit-key-000001',
      ),
    ).resolves.toMatchObject({ code: 202, data: { status: 'QUEUED' } });
    expect(assessments.submit).toHaveBeenCalledWith(
      'user-a',
      resource.assessmentId,
    );
  });

  it('routes upload and cancellation without accepting a body owner', async () => {
    const file = { buffer: Buffer.from('fake-audio') } as Express.Multer.File;
    await expect(
      controller.upload(
        authenticatedRequest(),
        resource.assessmentId,
        'upload-key-000001',
        file,
      ),
    ).resolves.toMatchObject({ code: 200 });
    expect(uploads.upload).toHaveBeenCalledWith({
      subjectId: 'user-a',
      assessmentId: resource.assessmentId,
      idempotencyKey: 'upload-key-000001',
      file,
    });

    await expect(
      controller.cancel(
        authenticatedRequest(),
        resource.assessmentId,
        'cancel-key-000001',
      ),
    ).resolves.toMatchObject({ code: 200 });
    expect(cancellations.cancel).toHaveBeenCalledWith({
      subjectId: 'user-a',
      assessmentId: resource.assessmentId,
      idempotencyKey: 'cancel-key-000001',
    });
  });

  it('creates retry lineage from authenticated ownership only', async () => {
    assessments.get.mockImplementationOnce(async () => ({
      ...resource,
      assessmentId: 'assessment-retry',
      retryOfAssessmentId: resource.assessmentId,
    }));
    await expect(
      controller.retry(
        authenticatedRequest(),
        resource.assessmentId,
        'retry-key-00000001',
      ),
    ).resolves.toMatchObject({
      code: 201,
      data: {
        assessmentId: 'assessment-retry',
        retryOfAssessmentId: resource.assessmentId,
      },
    });
    expect(retries.retry).toHaveBeenCalledWith({
      subjectId: 'user-a',
      assessmentId: resource.assessmentId,
      idempotencyKey: 'retry-key-00000001',
    });
  });

  it('fails closed when the authenticated context is absent', async () => {
    await expect(controller.list({} as any, {})).rejects.toMatchObject({
      status: 401,
    });
    expect(assessments.list).not.toHaveBeenCalled();
  });

  it('keeps audio/full deletion scopes distinct and exposes owned status', async () => {
    await expect(
      controller.deleteAudio(
        authenticatedRequest(),
        resource.assessmentId,
        'delete-audio-key-00001',
      ),
    ).resolves.toMatchObject({ code: 202, data: { status: 'ACCEPTED' } });
    await expect(
      controller.deleteAssessment(
        authenticatedRequest(),
        resource.assessmentId,
        'delete-full-key-000001',
      ),
    ).resolves.toMatchObject({ code: 202, data: { status: 'COMPENSATING' } });
    expect(deletions.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        subjectId: 'user-a',
        scope: 'PRONUNCIATION_AUDIO',
      }),
    );
    expect(deletions.request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        subjectId: 'user-a',
        scope: 'PRONUNCIATION_ASSESSMENT',
      }),
    );
    await expect(
      controller.deletionStatus(authenticatedRequest(), 'delete_00000000001'),
    ).resolves.toMatchObject({ code: 200, data: { status: 'PURGING' } });
    expect(deletions.status).toHaveBeenCalledWith(
      'user-a',
      'delete_00000000001',
    );
  });
});
