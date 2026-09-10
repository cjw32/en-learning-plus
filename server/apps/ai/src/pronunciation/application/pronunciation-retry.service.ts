import { Injectable } from '@nestjs/common';
import { PRONUNCIATION_NORMALIZATION_VERSION } from '@en/common/pronunciation';
import type { PronunciationRuntimeConfig } from '../governance/pronunciation-config.schema';
import {
  hashPronunciationContent,
  PronunciationRepository,
  type OwnedPronunciationAssessment,
} from './pronunciation.repository';

const retryableRoots = new Set([
  'COMPLETED',
  'REFERENCE_ONLY',
  'UNRECOGNIZABLE',
  'REJECTED',
  'CANCELLED',
  'TIMED_OUT',
  'FAILED',
]);

export class PronunciationRetryError extends Error {
  constructor(
    readonly code:
      | 'FEATURE_DISABLED'
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'STATE_CONFLICT',
  ) {
    super(code);
    this.name = 'PronunciationRetryError';
  }
}

@Injectable()
export class PronunciationRetryService {
  constructor(
    private readonly repository: PronunciationRepository,
    private readonly config: PronunciationRuntimeConfig,
    private readonly createId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async retry(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      idempotencyKey: string;
    }>,
  ): Promise<OwnedPronunciationAssessment> {
    if (!this.config.captureEnabled) {
      throw new PronunciationRetryError('FEATURE_DISABLED');
    }
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
      throw new PronunciationRetryError('VALIDATION_FAILED');
    }
    const original = await this.repository.findOwnedWithTarget(
      input.subjectId,
      input.assessmentId,
    );
    if (!original) throw new PronunciationRetryError('RESOURCE_NOT_FOUND');
    if (!retryableRoots.has(original.assessment.status)) {
      throw new PronunciationRetryError('STATE_CONFLICT');
    }

    const created = await this.repository.createIdempotent({
      id: this.createId(),
      subjectId: input.subjectId,
      clientIdempotencyKey: input.idempotencyKey,
      requestBodyHash: hashPronunciationContent({
        operation: 'retry',
        retryOfAssessmentId: input.assessmentId,
      }),
      exerciseType: original.assessment.exerciseType,
      deadlineAt: new Date(this.now().getTime() + 30_000),
      retryOfAssessmentId: input.assessmentId,
      target: {
        ...original.target,
        exerciseType: original.assessment.exerciseType,
        wordCount: original.target.normalizedTokens.length,
        characterCount: Array.from(original.target.referenceText).length,
        normalizationVersion: PRONUNCIATION_NORMALIZATION_VERSION,
      },
    });
    const retry = await this.repository.findOwnedWithTarget(
      input.subjectId,
      created.assessment.id,
    );
    if (!retry) throw new PronunciationRetryError('STATE_CONFLICT');
    return retry;
  }
}
