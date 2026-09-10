import type { PronunciationAssessmentResource } from '@en/common/pronunciation';
import type { PronunciationAssessmentService } from '../../src/pronunciation/application/pronunciation-assessment.service';
import type { PronunciationRepository } from '../../src/pronunciation/application/pronunciation.repository';
import { PronunciationAudioService } from '../../src/pronunciation/application/pronunciation-audio.service';
import type { PronunciationAudioInspector } from '../../src/pronunciation/audio/pronunciation-audio-inspector';
import type { PronunciationAudioStorage } from '../../src/pronunciation/storage/pronunciation-audio.storage';

const expiresAt = new Date('2026-09-11T00:00:00.000Z');

function resource(
  status = 'AUDIO_VALIDATING',
): PronunciationAssessmentResource {
  return {
    assessmentId: 'assessment_1',
    status: status as PronunciationAssessmentResource['status'],
    exerciseType: 'WORD',
    locale: 'en-US',
    referenceText: 'hello',
    retryOfAssessmentId: null,
    result: null,
    diagnostic: null,
    learningWriteStatus: 'NOT_ELIGIBLE',
    audio: {
      status: 'VALIDATING',
      available: false,
      expiresAt: expiresAt.toISOString(),
    },
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:01.000Z',
    traceId: 'trace_1',
  };
}

function dependencies() {
  const storage: jest.Mocked<PronunciationAudioStorage> = {
    assertPrivateLifecycleReady: jest.fn().mockResolvedValue(undefined),
    putQuarantined: jest.fn().mockResolvedValue({
      objectKey: 'pronunciation/quarantine/raw',
      byteSize: 4,
      sha256: 'raw-hash',
      expiresAt,
    }),
    putCanonical: jest.fn().mockResolvedValue({
      objectKey: 'pronunciation/canonical/wav',
      byteSize: 4,
      sha256: 'canonical-hash',
      expiresAt,
    }),
    read: jest
      .fn()
      .mockResolvedValue(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])),
    revoke: jest.fn().mockResolvedValue(undefined),
    purge: jest.fn().mockResolvedValue(undefined),
  };
  const inspector: jest.Mocked<PronunciationAudioInspector> = {
    assertRuntimeReady: jest.fn().mockResolvedValue(undefined),
    inspectAndCanonicalize: jest.fn().mockResolvedValue({
      detectedMediaType: 'audio/webm',
      container: 'matroska,webm',
      codec: 'opus',
      durationMs: 1_000,
      sampleRate: 16_000,
      channelCount: 1,
      qualityStatus: 'READY',
      canonicalAudio: Uint8Array.from([82, 73, 70, 70]),
    }),
  };
  const assessments = {
    get: jest.fn().mockResolvedValue(resource()),
    uploadMetadata: jest.fn().mockResolvedValue(resource()),
  } as unknown as jest.Mocked<PronunciationAssessmentService>;
  const repository = {
    bindAudioIntent: jest.fn().mockResolvedValue('BOUND'),
    markAudioReady: jest.fn().mockResolvedValue(true),
    markAudioInvalid: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<PronunciationRepository>;
  return { storage, inspector, assessments, repository };
}

function file(): Express.Multer.File {
  return {
    buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    mimetype: 'audio/webm',
    size: 4,
    originalname: 'recording.webm',
  } as Express.Multer.File;
}

describe('PronunciationAudioService durable pipeline', () => {
  it('moves quarantine through validation to canonical storage and purges raw bytes', async () => {
    const deps = dependencies();
    const service = new PronunciationAudioService(
      deps.storage,
      deps.inspector,
      deps.assessments,
      deps.repository,
      () => new Date('2026-09-10T00:00:00.000Z'),
    );
    await expect(
      service.upload({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        idempotencyKey: 'upload-key-000001',
        file: file(),
      }),
    ).resolves.toEqual(resource());
    expect(
      deps.storage.putQuarantined.mock.invocationCallOrder[0],
    ).toBeLessThan(
      deps.inspector.inspectAndCanonicalize.mock.invocationCallOrder[0],
    );
    expect(deps.storage.putCanonical).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: 'assessment_1',
        bytes: Uint8Array.from([82, 73, 70, 70]),
      }),
    );
    expect(deps.repository.markAudioReady).toHaveBeenCalledWith(
      expect.objectContaining({
        rawObjectKey: 'pronunciation/quarantine/raw',
        canonicalObjectKey: 'pronunciation/canonical/wav',
        durationMs: 1_000,
      }),
    );
    expect(deps.storage.purge).toHaveBeenCalledWith(
      'pronunciation/quarantine/raw',
    );
  });

  it('replays the existing resource without allocating storage for the same upload intent', async () => {
    const deps = dependencies();
    deps.repository.bindAudioIntent.mockResolvedValueOnce('REPLAYED');
    deps.assessments.get.mockResolvedValueOnce(resource('AUDIO_READY'));
    const service = new PronunciationAudioService(
      deps.storage,
      deps.inspector,
      deps.assessments,
      deps.repository,
      () => new Date('2026-09-10T00:00:00.000Z'),
    );

    await expect(
      service.upload({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        idempotencyKey: 'upload-key-000001',
        file: file(),
      }),
    ).resolves.toEqual(resource('AUDIO_READY'));
    expect(deps.storage.putQuarantined).not.toHaveBeenCalled();
    expect(deps.inspector.inspectAndCanonicalize).not.toHaveBeenCalled();
  });

  it('does not invalidate the winning upload when a competing intent conflicts', async () => {
    const deps = dependencies();
    deps.repository.bindAudioIntent.mockRejectedValueOnce(
      new Error('idempotency conflict'),
    );
    const service = new PronunciationAudioService(
      deps.storage,
      deps.inspector,
      deps.assessments,
      deps.repository,
      () => new Date('2026-09-10T00:00:00.000Z'),
    );

    await expect(
      service.upload({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        idempotencyKey: 'upload-key-000001',
        file: file(),
      }),
    ).rejects.toThrow('idempotency conflict');
    expect(deps.repository.markAudioInvalid).not.toHaveBeenCalled();
    expect(deps.storage.putQuarantined).not.toHaveBeenCalled();
  });

  it.each([
    ['metadata', 'uploadMetadata'],
    ['inspection', 'inspectAndCanonicalize'],
    ['canonical write', 'putCanonical'],
    ['ready transaction', 'markAudioReady'],
  ] as const)(
    'revokes and purges every allocated object after %s failure',
    async (_name, failingMethod) => {
      const deps = dependencies();
      const owner =
        failingMethod === 'uploadMetadata'
          ? deps.assessments
          : failingMethod === 'inspectAndCanonicalize'
            ? deps.inspector
            : failingMethod === 'putCanonical'
              ? deps.storage
              : deps.repository;
      (owner[failingMethod] as jest.Mock).mockRejectedValueOnce(
        new Error('injected failure'),
      );
      const service = new PronunciationAudioService(
        deps.storage,
        deps.inspector,
        deps.assessments,
        deps.repository,
        () => new Date('2026-09-10T00:00:00.000Z'),
      );
      await expect(
        service.upload({
          subjectId: 'user-a',
          assessmentId: 'assessment_1',
          idempotencyKey: 'upload-key-000001',
          file: file(),
        }),
      ).rejects.toThrow('injected failure');
      expect(deps.storage.revoke).toHaveBeenCalledWith(
        'pronunciation/quarantine/raw',
      );
      expect(deps.storage.purge).toHaveBeenCalledWith(
        'pronunciation/quarantine/raw',
      );
      if (failingMethod === 'markAudioReady') {
        expect(deps.storage.revoke).toHaveBeenCalledWith(
          'pronunciation/canonical/wav',
        );
        expect(deps.storage.purge).toHaveBeenCalledWith(
          'pronunciation/canonical/wav',
        );
      }
      expect(deps.repository.markAudioInvalid).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: 'assessment_1',
          publicErrorCode: expect.any(String),
        }),
      );
    },
  );

  it('rejects a failed quality policy before canonical storage', async () => {
    const deps = dependencies();
    deps.inspector.inspectAndCanonicalize.mockResolvedValueOnce({
      detectedMediaType: 'audio/webm',
      container: 'matroska,webm',
      codec: 'opus',
      durationMs: 1_000,
      sampleRate: 16_000,
      channelCount: 1,
      qualityStatus: 'SILENT',
      canonicalAudio: Uint8Array.from([82, 73, 70, 70]),
    });
    const service = new PronunciationAudioService(
      deps.storage,
      deps.inspector,
      deps.assessments,
      deps.repository,
      () => new Date('2026-09-10T00:00:00.000Z'),
    );
    await expect(
      service.upload({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        idempotencyKey: 'upload-key-000001',
        file: file(),
      }),
    ).rejects.toMatchObject({ code: 'AUDIO_SILENT' });
    expect(deps.storage.putCanonical).not.toHaveBeenCalled();
  });
});
