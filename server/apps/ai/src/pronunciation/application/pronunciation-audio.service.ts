import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PronunciationAssessmentResource } from '@en/common/pronunciation';
import {
  PRONUNCIATION_AUDIO_INSPECTOR,
  type PronunciationAudioInspection,
  type PronunciationAudioInspector,
} from '../audio/pronunciation-audio-inspector';
import { PronunciationFailureError } from '../observability/pronunciation-failure.mapper';
import {
  PRONUNCIATION_AUDIO_STORAGE,
  type PronunciationAudioStorage,
} from '../storage/pronunciation-audio.storage';
import {
  PronunciationAssessmentRuleError,
  PronunciationAssessmentService,
} from './pronunciation-assessment.service';
import { PronunciationRepository } from './pronunciation.repository';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const AUDIO_RETENTION_MS = 24 * 60 * 60 * 1_000;
const AUDIO_DEADLINE_MS = 30_000;

function qualityError(
  inspection: PronunciationAudioInspection,
): PronunciationFailureError | null {
  switch (inspection.qualityStatus) {
    case 'READY':
      return null;
    case 'SILENT':
      return new PronunciationFailureError('AUDIO_SILENT');
    case 'LOW_VOLUME':
    case 'INSUFFICIENT_SPEECH':
      return new PronunciationFailureError('AUDIO_LOW_VOLUME');
    case 'CLIPPED':
      return new PronunciationFailureError('AUDIO_INVALID');
  }
}

@Injectable()
export class PronunciationAudioService {
  constructor(
    @Inject(PRONUNCIATION_AUDIO_STORAGE)
    private readonly storage: PronunciationAudioStorage,
    @Inject(PRONUNCIATION_AUDIO_INSPECTOR)
    private readonly inspector: PronunciationAudioInspector,
    private readonly assessments: PronunciationAssessmentService,
    private readonly repository: PronunciationRepository,
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  async upload(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      idempotencyKey: string;
      file: Express.Multer.File | undefined;
    }>,
  ): Promise<PronunciationAssessmentResource> {
    this.validateFile(input.file);
    const startedAt = this.now();
    const expiresAt = new Date(startedAt.getTime() + AUDIO_RETENTION_MS);
    const deadlineAt = new Date(startedAt.getTime() + AUDIO_DEADLINE_MS);
    let rawObjectKey: string | null = null;
    let canonicalObjectKey: string | null = null;
    let qualityStatus = 'INVALID';
    let ownsUploadIntent = false;
    try {
      const intent = await this.repository.bindAudioIntent({
        subjectId: input.subjectId,
        assessmentId: input.assessmentId,
        idempotencyKey: input.idempotencyKey,
        declaredMediaType: input.file.mimetype,
        byteSize: input.file.size,
        sha256: createHash('sha256').update(input.file.buffer).digest('hex'),
      });
      if (intent === 'REPLAYED') {
        return this.assessments.get(input.subjectId, input.assessmentId);
      }
      if (intent !== 'BOUND') {
        throw new PronunciationAssessmentRuleError(intent);
      }
      ownsUploadIntent = true;
      await this.storage.assertPrivateLifecycleReady();
      await this.inspector.assertRuntimeReady();
      const raw = await this.storage.putQuarantined({
        assessmentId: input.assessmentId,
        bytes: input.file.buffer,
        declaredMediaType: input.file.mimetype,
        expiresAt,
      });
      rawObjectKey = raw.objectKey;
      await this.assessments.uploadMetadata({
        subjectId: input.subjectId,
        assessmentId: input.assessmentId,
        objectKey: raw.objectKey,
        declaredMediaType: input.file.mimetype,
        byteSize: raw.byteSize,
        sha256: raw.sha256,
        expiresAt,
      });
      const inspection = await this.inspector.inspectAndCanonicalize({
        bytes: await this.storage.read(raw.objectKey),
        declaredMediaType: input.file.mimetype,
        deadlineAt,
      });
      qualityStatus = inspection.qualityStatus;
      const rejected = qualityError(inspection);
      if (rejected) throw rejected;
      const canonical = await this.storage.putCanonical({
        assessmentId: input.assessmentId,
        bytes: inspection.canonicalAudio,
        expiresAt,
      });
      canonicalObjectKey = canonical.objectKey;
      const ready = await this.repository.markAudioReady({
        subjectId: input.subjectId,
        assessmentId: input.assessmentId,
        rawObjectKey: raw.objectKey,
        canonicalObjectKey: canonical.objectKey,
        byteSize: canonical.byteSize,
        sha256: canonical.sha256,
        detectedMediaType: inspection.detectedMediaType,
        container: inspection.container,
        codec: inspection.codec,
        durationMs: inspection.durationMs,
        sampleRate: inspection.sampleRate,
        channelCount: inspection.channelCount,
        qualityStatus: inspection.qualityStatus,
        expiresAt,
      });
      if (!ready) throw new Error('Pronunciation audio state conflict');
      await this.storage.purge(raw.objectKey);
      rawObjectKey = null;
      return this.assessments.get(input.subjectId, input.assessmentId);
    } catch (error) {
      await this.cleanup(canonicalObjectKey);
      await this.cleanup(rawObjectKey);
      if (ownsUploadIntent) {
        const publicErrorCode =
          error instanceof PronunciationFailureError
            ? error.code
            : 'INTERNAL_ERROR';
        await this.repository
          .markAudioInvalid({
            subjectId: input.subjectId,
            assessmentId: input.assessmentId,
            qualityStatus,
            publicErrorCode,
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  private validateFile(
    file: Express.Multer.File | undefined,
  ): asserts file is Express.Multer.File {
    if (!file || file.size <= 0 || file.buffer.byteLength !== file.size) {
      throw new PronunciationFailureError('AUDIO_INVALID');
    }
    if (file.size > MAX_AUDIO_BYTES) {
      throw new PronunciationFailureError('AUDIO_TOO_LARGE');
    }
    const type = file.mimetype.toLowerCase().split(';', 1)[0];
    if (type !== 'audio/webm' && type !== 'audio/mp4') {
      throw new PronunciationFailureError('AUDIO_UNSUPPORTED');
    }
  }

  private async cleanup(objectKey: string | null): Promise<void> {
    if (!objectKey) return;
    await this.storage.revoke(objectKey).catch(() => undefined);
    await this.storage.purge(objectKey).catch(() => undefined);
  }
}
