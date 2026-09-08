import { Injectable } from '@nestjs/common';
import {
  COACH_TOOL_SCHEMA_VERSION,
  saveAttemptInputSchema,
  saveAttemptOutputSchema,
  type SaveAttemptOutput,
} from '@en/common/coach';
import { AttemptService, LearningDomainError } from '@libs/learning';
import type { CoachExecutionContext } from '@libs/shared';

export type SaveAttemptToolScope = Readonly<{
  requestId: string;
  gradingValidated: boolean;
  submissionId: string;
  gradingHash: string;
  cancelled?: boolean;
}>;

@Injectable()
export class SaveAttemptTool {
  readonly name = 'save_attempt' as const;
  readonly mode = 'write' as const;

  constructor(private readonly attempts: AttemptService) {}

  async execute(
    context: CoachExecutionContext,
    scope: SaveAttemptToolScope,
    untrustedInput: unknown,
  ): Promise<SaveAttemptOutput> {
    const parsed = saveAttemptInputSchema.safeParse(untrustedInput);
    if (!parsed.success) return this.failure('VALIDATION_FAILED', false);
    if (
      !scope.gradingValidated ||
      scope.cancelled ||
      scope.submissionId !== parsed.data.submissionId ||
      scope.gradingHash !== parsed.data.gradingHash
    ) {
      return this.failure('STATE_CONFLICT', false);
    }

    try {
      const result = await this.attempts.save({
        subjectId: context.subjectId,
        submissionId: parsed.data.submissionId,
        gradingHash: parsed.data.gradingHash,
        saveRequestId: scope.requestId,
        idempotencyKey: parsed.data.idempotencyKey,
        cancelled: scope.cancelled,
      });
      return saveAttemptOutputSchema.parse({
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: true,
        status: result.status,
        attemptId: result.attemptId,
        score: result.score,
        changes: result.changes.map((change) => ({
          ...change,
          nextReviewAt: change.nextReviewAt.toISOString(),
        })),
        savedAt: result.savedAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof LearningDomainError) {
        return this.failure(error.code, error.retryable);
      }
      return this.failure('INTERNAL_ERROR', true);
    }
  }

  private failure(
    code:
      | 'VALIDATION_FAILED'
      | 'RESOURCE_NOT_FOUND'
      | 'FORBIDDEN'
      | 'STATE_CONFLICT'
      | 'DATA_NOT_AVAILABLE'
      | 'INTERNAL_ERROR',
    retryable: boolean,
  ): SaveAttemptOutput {
    return {
      schemaVersion: COACH_TOOL_SCHEMA_VERSION,
      ok: false,
      code,
      message: '暂时无法保存本次学习记录',
      retryable,
    };
  }
}
