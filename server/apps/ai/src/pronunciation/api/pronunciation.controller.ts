import { PronunciationSubmitAdmissionService } from '../governance/pronunciation-submit-admission';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from '@en/common/coach/zod';
import {
  pronunciationAssessmentIdSchema,
  pronunciationIdempotencyKeySchema,
  type PronunciationAssessmentResource,
} from '@en/common/pronunciation';
import { AuthGuard, type CoachExecutionContext } from '@libs/shared';
import type { Request } from 'express';
import { PronunciationAssessmentService } from '../application/pronunciation-assessment.service';
import { PronunciationUploadGuard } from './pronunciation-upload.guard';
import { PronunciationCancellationService } from '../governance/pronunciation-cancellation.service';
import {
  PronunciationFailureError,
  mapPronunciationFailure,
} from '../observability/pronunciation-failure.mapper';
import { PronunciationDeletionService } from '../privacy/pronunciation-deletion.service';
import { PronunciationRetryService } from '../application/pronunciation-retry.service';

export const PRONUNCIATION_AUDIO_UPLOAD_WORKFLOW = Symbol(
  'PRONUNCIATION_AUDIO_UPLOAD_WORKFLOW',
);

type PronunciationRequest = Request & {
  coachContext?: CoachExecutionContext;
};

const listQuerySchema = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export interface PronunciationAudioUploadWorkflow {
  upload(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      idempotencyKey: string;
      file: Express.Multer.File | undefined;
    }>,
  ): Promise<PronunciationAssessmentResource>;
}

export class UnavailablePronunciationAudioUploadWorkflow implements PronunciationAudioUploadWorkflow {
  upload(): Promise<PronunciationAssessmentResource> {
    return Promise.reject(
      new PronunciationFailureError('STORAGE_NOT_APPROVED'),
    );
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PronunciationFailureError('VALIDATION_FAILED');
  }
  return parsed.data;
}

function subjectId(request: PronunciationRequest): string {
  if (!request.coachContext) {
    throw new PronunciationFailureError('AUTH_REQUIRED');
  }
  return request.coachContext.subjectId;
}

@Controller({ path: 'pronunciation', version: '1' })
@UseGuards(AuthGuard)
export class PronunciationController {
  constructor(
    private readonly assessments: PronunciationAssessmentService,
    private readonly cancellations: PronunciationCancellationService,
    @Inject(PRONUNCIATION_AUDIO_UPLOAD_WORKFLOW)
    private readonly uploads: PronunciationAudioUploadWorkflow,
    @Optional() private readonly deletions?: PronunciationDeletionService,
    @Optional() private readonly retries?: PronunciationRetryService,
    @Optional() private readonly admission?: PronunciationSubmitAdmissionService,
  ) {}

  @Post('assessments')
  async create(
    @Req() request: PronunciationRequest,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() body: unknown,
  ) {
    return this.respond(201, null, () =>
      this.assessments.create({
        subjectId: subjectId(request),
        idempotencyKey: parse(
          pronunciationIdempotencyKeySchema,
          idempotencyKey,
        ),
        body,
      }),
    );
  }

  @Get('assessments')
  async list(@Req() request: PronunciationRequest, @Query() query: unknown) {
    return this.respond(200, null, async () => {
      const parsed = parse(listQuerySchema, query);
      return this.assessments.list({
        subjectId: subjectId(request),
        cursor: parsed.cursor,
        limit: parsed.limit,
      });
    });
  }

  @Get('assessments/:assessmentId')
  async get(
    @Req() request: PronunciationRequest,
    @Param('assessmentId') assessmentId: unknown,
  ) {
    const id = parse(pronunciationAssessmentIdSchema, assessmentId);
    return this.respond(200, id, () =>
      this.assessments.get(subjectId(request), id),
    );
  }

  @Put('assessments/:assessmentId/audio')
  @UseGuards(PronunciationUploadGuard)
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @Req() request: PronunciationRequest,
    @Param('assessmentId') assessmentId: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const id = parse(pronunciationAssessmentIdSchema, assessmentId);
    return this.respond(200, id, () =>
      this.uploads.upload({
        subjectId: subjectId(request),
        assessmentId: id,
        idempotencyKey: parse(
          pronunciationIdempotencyKeySchema,
          idempotencyKey,
        ),
        file,
      }),
    );
  }

  @Post('assessments/:assessmentId/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @Req() request: PronunciationRequest,
    @Param('assessmentId') assessmentId: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
  ) {
    const id = parse(pronunciationAssessmentIdSchema, assessmentId);
    return this.respond(202, id, async () => {
      parse(pronunciationIdempotencyKeySchema, idempotencyKey);
      return this.assessments.submit(subjectId(request), id);
    });
  }

  @Post('assessments/:assessmentId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Req() request: PronunciationRequest,
    @Param('assessmentId') assessmentId: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
  ) {
    const id = parse(pronunciationAssessmentIdSchema, assessmentId);
    return this.respond(200, id, async () => {
      const owner = subjectId(request);
      await this.cancellations.cancel({
        subjectId: owner,
        assessmentId: id,
        idempotencyKey: parse(
          pronunciationIdempotencyKeySchema,
          idempotencyKey,
        ),
      });
      await this.admission?.release(owner, id).catch(() => undefined);
      return this.assessments.get(owner, id);
    });
  }

  @Post('assessments/:assessmentId/retry')
  @HttpCode(HttpStatus.CREATED)
  async retry(
    @Req() request: PronunciationRequest,
    @Param('assessmentId') assessmentId: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
  ) {
    const id = parse(pronunciationAssessmentIdSchema, assessmentId);
    return this.respond(201, id, async () => {
      const owner = subjectId(request);
      const retried = await this.retries?.retry({
        subjectId: owner,
        assessmentId: id,
        idempotencyKey: parse(
          pronunciationIdempotencyKeySchema,
          idempotencyKey,
        ),
      });
      if (!retried) throw new PronunciationFailureError('FEATURE_DISABLED');
      return this.assessments.get(owner, retried.assessment.id);
    });
  }

  @Delete('assessments/:assessmentId/audio')
  @HttpCode(HttpStatus.ACCEPTED)
  async deleteAudio(
    @Req() request: PronunciationRequest,
    @Param('assessmentId') assessmentId: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
  ) {
    return this.requestDeletion(
      request,
      assessmentId,
      idempotencyKey,
      'PRONUNCIATION_AUDIO',
    );
  }

  @Delete('assessments/:assessmentId')
  @HttpCode(HttpStatus.ACCEPTED)
  async deleteAssessment(
    @Req() request: PronunciationRequest,
    @Param('assessmentId') assessmentId: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
  ) {
    return this.requestDeletion(
      request,
      assessmentId,
      idempotencyKey,
      'PRONUNCIATION_ASSESSMENT',
    );
  }

  @Get('deletions/:deletionId')
  async deletionStatus(
    @Req() request: PronunciationRequest,
    @Param('deletionId') deletionId: unknown,
  ) {
    return this.respond(200, null, async () => {
      if (
        typeof deletionId !== 'string' ||
        !/^delete_[A-Za-z0-9_-]{10,48}$/.test(deletionId)
      ) {
        throw new PronunciationFailureError('VALIDATION_FAILED');
      }
      const result = await this.deletions?.status(
        subjectId(request),
        deletionId,
      );
      if (!result) throw new PronunciationFailureError('RESOURCE_NOT_FOUND');
      return result;
    });
  }

  private requestDeletion(
    request: PronunciationRequest,
    assessmentId: unknown,
    idempotencyKey: unknown,
    scope: 'PRONUNCIATION_AUDIO' | 'PRONUNCIATION_ASSESSMENT',
  ) {
    const id = parse(pronunciationAssessmentIdSchema, assessmentId);
    return this.respond(202, id, async () => {
      const result = await this.deletions?.request({
        subjectId: subjectId(request),
        assessmentId: id,
        scope,
        idempotencyKey: parse(
          pronunciationIdempotencyKeySchema,
          idempotencyKey,
        ),
      });
      if (!result) throw new PronunciationFailureError('RESOURCE_NOT_FOUND');
      return result;
    });
  }

  private async respond<T>(
    code: number,
    assessmentId: string | null,
    operation: () => Promise<T>,
  ): Promise<Readonly<{ code: number; data: T }>> {
    try {
      return Object.freeze({ code, data: await operation() });
    } catch (error) {
      const failure = mapPronunciationFailure(error, {
        assessmentId,
        traceId: assessmentId,
      });
      throw new HttpException(
        {
          code: failure.statusCode,
          error: {
            code: failure.code,
            category: failure.category,
            message: failure.message,
            retryable: failure.retryable,
            retryAfterSeconds: failure.retryAfterSeconds,
            assessmentId: failure.assessmentId,
            traceId: failure.traceId,
          },
        },
        failure.statusCode,
        { cause: error },
      );
    }
  }
}
