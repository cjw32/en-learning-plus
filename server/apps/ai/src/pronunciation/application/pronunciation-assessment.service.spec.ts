/* eslint-disable @typescript-eslint/no-unsafe-argument -- Synchronous typed test doubles preserve async ports, and Jest assertions intentionally inspect mock methods. */

import type { PronunciationRuntimeConfig } from '../governance/pronunciation-config.schema';
import type {
  PronunciationSourceRightsService,
  PronunciationTargetService,
  ResolvedPronunciationTarget,
} from '@libs/learning';
import type {
  PronunciationRepository,
  OwnedPronunciationAssessment,
} from './pronunciation.repository';
import {
  PronunciationAssessmentRuleError,
  PronunciationAssessmentService,
} from './pronunciation-assessment.service';

const now = new Date('2026-09-10T00:00:00.000Z');
const config: PronunciationRuntimeConfig = {
  captureEnabled: true,
  uploadEnabled: true,
  providerEnabled: true,
  resultDisplayEnabled: false,
  learningShadowEnabled: false,
  learningWriteEnabled: false,
  coachSummaryEnabled: false,
  audioRuntimeApproved: true,
  storageApproved: true,
  providerApproved: true,
  providerModelVersion: 'model-v1',
  providerRegion: 'test',
  privacyEvidenceVersion: 'privacy-v1',
  priceVersion: 'price-v1',
  budgetPolicyVersion: 'budget-v1',
  evaluationApprovalVersion: null,
  maxCallCostMicros: 100,
  subjectDailyBudgetMicros: 1000,
  systemDailyBudgetMicros: 10000,
  systemMonthlyBudgetMicros: 100000,
};

const target: ResolvedPronunciationTarget = {
  referenceText: 'hello',
  normalizedTokens: ['hello'],
  exerciseType: 'WORD',
  wordCount: 1,
  characterCount: 5,
  normalizationVersion: 'pronunciation-normalization.v1',
  sourceType: 'WORD_BOOK',
  languageTag: 'en-US',
  targetHash: 'target-hash',
  wordId: 'word-1',
  courseId: null,
  knowledgeCitationId: null,
  coachRequestId: null,
  exerciseId: null,
  itemId: null,
  sourceRecordType: 'WORD_BOOK',
  sourceRecordId: 'word-1',
  sourceVersion: now.toISOString(),
  sourceContentHash: 'content-hash',
  sourceRightsVersion: null,
  authorizedAt: now,
  expiresAt: null,
};

function fixture() {
  const rows = new Map<string, OwnedPronunciationAssessment>();
  const keys = new Map<string, string>();
  const repository = {
    findByOwnerAndKey: jest.fn(async (subjectId: string, key: string) => {
      const id = keys.get(`${subjectId}:${key}`);
      return id ? (rows.get(id)?.assessment ?? null) : null;
    }),
    createIdempotent: jest.fn(async (input: any) => {
      const assessment = {
        id: input.id,
        subjectId: input.subjectId,
        clientIdempotencyKey: input.clientIdempotencyKey,
        requestBodyHash: input.requestBodyHash,
        status: 'CREATED' as const,
        exerciseType: input.exerciseType,
        deadlineAt: input.deadlineAt,
        cancelRequestedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(input.id, { assessment, target: input.target, audio: null });
      keys.set(`${input.subjectId}:${input.clientIdempotencyKey}`, input.id);
      return { disposition: 'CREATED' as const, assessment };
    }),
    findOwnedWithTarget: jest.fn(async (subjectId: string, id: string) => {
      const row = rows.get(id);
      return row?.assessment.subjectId === subjectId ? row : null;
    }),
    listOwnedWithTargets: jest.fn(async ({ subjectId }: any) => ({
      items: [...rows.values()].filter(
        (row) => row.assessment.subjectId === subjectId,
      ),
      nextCursor: null,
    })),
    transitionOwned: jest.fn(
      async ({ subjectId, assessmentId, from, to }: any) => {
        const row = rows.get(assessmentId);
        if (
          !row ||
          row.assessment.subjectId !== subjectId ||
          !from.includes(row.assessment.status)
        )
          return false;
        rows.set(assessmentId, {
          ...row,
          assessment: { ...row.assessment, status: to, updatedAt: now },
        });
        return true;
      },
    ),
    attachAudioMetadata: jest.fn(async (input: any) => {
      const row = rows.get(input.assessmentId);
      if (!row || row.assessment.subjectId !== input.subjectId) return false;
      rows.set(input.assessmentId, {
        ...row,
        audio: {
          objectKey: input.objectKey,
          declaredMediaType: input.declaredMediaType,
          detectedMediaType: null,
          byteSize: input.byteSize,
          durationMs: null,
          sha256: input.sha256,
          status: 'QUARANTINED',
          expiresAt: input.expiresAt,
        },
      });
      return true;
    }),
  } as unknown as PronunciationRepository;
  const targets = {
    resolve: jest.fn().mockResolvedValue(target),
  } as unknown as PronunciationTargetService;
  const sourceRights = {
    resolve: jest.fn(),
    revalidate: jest.fn(),
  } as unknown as PronunciationSourceRightsService;
  const admission = { assertCanSubmit: jest.fn() };
  let id = 0;
  const service = new PronunciationAssessmentService(
    repository,
    targets,
    sourceRights,
    config,
    () => `assessment-${++id}`,
    admission,
    () => now,
  );
  return {
    service,
    repository: repository as any,
    targets: targets as any,
    sourceRights: sourceRights as any,
    admission,
    rows,
  };
}

const createInput = {
  subjectId: 'user-1',
  idempotencyKey: 'create-key-0000001',
  body: {
    locale: 'en-US',
    target: { sourceType: 'WORD_BOOK', wordId: 'word-1' },
  },
};

describe('PronunciationAssessmentService', () => {
  it('creates an owned immutable target and replays the same intent once', async () => {
    const { service, repository, targets } = fixture();
    const first = await service.create(createInput);
    const replay = await service.create(createInput);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      assessmentId: 'assessment-1',
      referenceText: 'hello',
      status: 'CREATED',
    });
    expect(repository.createIdempotent).toHaveBeenCalledTimes(1);
    expect(targets.resolve).toHaveBeenCalledTimes(1);
  });

  it('orchestrates upload metadata without exposing the object key', async () => {
    const { service } = fixture();
    await service.create(createInput);
    const view = await service.uploadMetadata({
      subjectId: 'user-1',
      assessmentId: 'assessment-1',
      objectKey: 'private-object-key',
      declaredMediaType: 'audio/webm',
      byteSize: 100,
      sha256: 'a'.repeat(64),
      expiresAt: new Date('2026-09-11T00:00:00Z'),
    });
    expect(view.status).toBe('AUDIO_VALIDATING');
    expect(JSON.stringify(view)).not.toContain('private-object-key');
  });

  it('isolates get/list by authenticated owner', async () => {
    const { service } = fixture();
    await service.create(createInput);
    await expect(service.get('other-user', 'assessment-1')).rejects.toEqual(
      new PronunciationAssessmentRuleError('RESOURCE_NOT_FOUND'),
    );
    await expect(service.list({ subjectId: 'other-user' })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('revalidates source before submit and refuses a changed source', async () => {
    const { service, rows, targets, admission } = fixture();
    await service.create(createInput);
    const row = rows.get('assessment-1')!;
    rows.set('assessment-1', {
      ...row,
      assessment: { ...row.assessment, status: 'AUDIO_READY' },
      audio: {
        objectKey: 'internal',
        declaredMediaType: 'audio/webm',
        detectedMediaType: 'audio/wav',
        byteSize: 100,
        durationMs: 1000,
        sha256: 'a'.repeat(64),
        status: 'READY',
        expiresAt: new Date('2026-09-11T00:00:00Z'),
      },
    });
    targets.resolve.mockResolvedValue({ ...target, targetHash: 'changed' });
    await expect(
      service.submit('user-1', 'assessment-1'),
    ).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    });
    expect(admission.assertCanSubmit).not.toHaveBeenCalled();
    expect(rows.get('assessment-1')?.assessment.status).toBe('AUDIO_READY');
  });

  it('queues exactly once after revalidation and admission', async () => {
    const { service, rows, repository, admission } = fixture();
    await service.create(createInput);
    const row = rows.get('assessment-1')!;
    rows.set('assessment-1', {
      ...row,
      assessment: { ...row.assessment, status: 'AUDIO_READY' },
      audio: {
        objectKey: 'internal',
        declaredMediaType: 'audio/webm',
        detectedMediaType: 'audio/wav',
        byteSize: 100,
        durationMs: 1000,
        sha256: 'a'.repeat(64),
        status: 'READY',
        expiresAt: new Date('2026-09-11T00:00:00Z'),
      },
    });
    await expect(
      service.submit('user-1', 'assessment-1'),
    ).resolves.toMatchObject({ status: 'QUEUED' });
    await expect(
      service.submit('user-1', 'assessment-1'),
    ).resolves.toMatchObject({ status: 'QUEUED' });
    expect(admission.assertCanSubmit).toHaveBeenCalledTimes(1);
    expect(repository.transitionOwned).toHaveBeenCalledTimes(1);
  });

  it('replays a terminal submission without reopening admission checks', async () => {
    const { service, rows, repository, admission } = fixture();
    await service.create(createInput);
    const row = rows.get('assessment-1')!;
    rows.set('assessment-1', {
      ...row,
      assessment: { ...row.assessment, status: 'COMPLETED' },
    });

    await expect(
      service.submit('user-1', 'assessment-1'),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
    });
    expect(admission.assertCanSubmit).not.toHaveBeenCalled();
    expect(repository.transitionOwned).not.toHaveBeenCalled();
  });

  it('projects a persisted public failure as a safe terminal diagnostic', async () => {
    const { service, rows } = fixture();
    await service.create(createInput);
    const row = rows.get('assessment-1')!;
    rows.set('assessment-1', {
      ...row,
      assessment: {
        ...row.assessment,
        status: 'REJECTED',
        publicErrorCode: 'AUDIO_LOW_VOLUME',
      },
    });

    await expect(service.get('user-1', 'assessment-1')).resolves.toMatchObject({
      status: 'REJECTED',
      diagnostic: {
        code: 'AUDIO_LOW_VOLUME',
        message: expect.stringContaining('音量'),
        retryable: true,
      },
    });
  });
});
