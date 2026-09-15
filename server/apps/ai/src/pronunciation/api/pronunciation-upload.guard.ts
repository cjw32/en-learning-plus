import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { CoachExecutionContext } from '@libs/shared';
import { pronunciationIdempotencyKeySchema } from '@en/common/pronunciation';
import { PronunciationAssessmentRuleError } from '../application/pronunciation-assessment.service';
import { PronunciationAssessmentService } from '../application/pronunciation-assessment.service';
import {
  PRONUNCIATION_RUNTIME_CONFIG,
  type PronunciationRuntimeConfig,
} from '../governance/pronunciation-config.schema';
import { PronunciationFailureError } from '../observability/pronunciation-failure.mapper';

const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_CONTENT_LENGTH = 8 * 1024 * 1024 + MAX_MULTIPART_OVERHEAD_BYTES;

type UploadRequest = Readonly<{
  coachContext?: CoachExecutionContext;
  headers: Record<string, string | string[] | undefined>;
  params?: { assessmentId?: string };
}>;

export interface PronunciationUploadAdmission {
  assertCanBuffer(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
    }>,
  ): Promise<void>;
}

@Injectable()
export class PronunciationUploadAdmissionService implements PronunciationUploadAdmission {
  constructor(private readonly assessments: PronunciationAssessmentService) {}

  async assertCanBuffer(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
    }>,
  ): Promise<void> {
    const assessment = await this.assessments.get(
      input.subjectId,
      input.assessmentId,
    );
    if (
      !['CREATED', 'AUDIO_VALIDATING', 'AUDIO_READY'].includes(
        assessment.status,
      )
    ) {
      throw new PronunciationAssessmentRuleError('STATE_CONFLICT');
    }
  }
}

@Injectable()
export class PronunciationUploadGuard implements CanActivate {
  constructor(
    @Inject(PRONUNCIATION_RUNTIME_CONFIG)
    private readonly config: Pick<PronunciationRuntimeConfig, 'uploadEnabled'>,
    private readonly admission: PronunciationUploadAdmissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UploadRequest>();
    if (!request.coachContext) {
      throw new PronunciationFailureError('AUTH_REQUIRED');
    }
    if (!this.config.uploadEnabled) {
      throw new PronunciationFailureError('FEATURE_DISABLED');
    }
    if (
      !pronunciationIdempotencyKeySchema.safeParse(
        request.headers['idempotency-key'],
      ).success
    ) {
      throw new PronunciationFailureError('VALIDATION_FAILED');
    }
    const contentType = request.headers['content-type'];
    if (
      typeof contentType !== 'string' ||
      !/^multipart\/form-data;\s*boundary=/i.test(contentType)
    ) {
      throw new PronunciationFailureError('VALIDATION_FAILED');
    }
    const rawLength = request.headers['content-length'];
    if (typeof rawLength === 'string') {
      const contentLength = Number(rawLength);
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        contentLength > MAX_CONTENT_LENGTH
      ) {
        throw new PronunciationFailureError('AUDIO_TOO_LARGE');
      }
    }
    const assessmentId = request.params?.assessmentId;
    if (!assessmentId) {
      throw new PronunciationFailureError('VALIDATION_FAILED');
    }
    await this.admission.assertCanBuffer({
      subjectId: request.coachContext.subjectId,
      assessmentId,
    });
    return true;
  }
}
