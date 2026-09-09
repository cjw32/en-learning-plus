import { Injectable } from '@nestjs/common';
import {
  COACH_TOOL_SCHEMA_VERSION,
  gradeAnswerInputSchema,
  gradeAnswerOutputSchema,
  type GradeAnswerOutput,
} from '@en/common/coach';
import { LearningDomainError, OwnedGradingService } from '@libs/learning';
import type { CoachExecutionContext } from '@libs/shared';

@Injectable()
export class GradeAnswerTool {
  readonly name = 'grade_answer' as const;
  readonly mode = 'compute' as const;

  constructor(private readonly grading: OwnedGradingService) {}

  async execute(
    context: CoachExecutionContext,
    scope: Readonly<{ requestId: string }>,
    untrustedInput: unknown,
  ): Promise<GradeAnswerOutput> {
    const parsed = gradeAnswerInputSchema.safeParse(untrustedInput);
    if (!parsed.success) return this.failure('VALIDATION_FAILED', false);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await this.grading.gradeOwned({
          subjectId: context.subjectId,
          gradeRequestId: scope.requestId,
          exerciseId: parsed.data.exerciseId,
          answers: parsed.data.answers,
          idempotencyKey: parsed.data.idempotencyKey,
        });
        if (result.status === 'GRADED_VALID') {
          const output = gradeAnswerOutputSchema.safeParse({
            schemaVersion: COACH_TOOL_SCHEMA_VERSION,
            ok: true,
            submissionId: result.submissionId,
            answerVersion: result.answerVersion,
            gradingHash: result.gradingHash,
            score: result.score,
            correction: result.correction,
            explanation: result.explanation,
            examples: result.examples,
            errorTypes: result.errorTypes,
            items: result.items,
            citations: result.citations,
          });
          if (output.success) return output.data;
        }
      }
      return this.failure('SCHEMA_INVALID', false);
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
      | 'SCHEMA_INVALID'
      | 'RESOURCE_NOT_FOUND'
      | 'FORBIDDEN'
      | 'STATE_CONFLICT'
      | 'DATA_NOT_AVAILABLE'
      | 'INTERNAL_ERROR',
    retryable: boolean,
  ): GradeAnswerOutput {
    return {
      schemaVersion: COACH_TOOL_SCHEMA_VERSION,
      ok: false,
      code,
      message: '暂时无法可靠批改本次答案',
      retryable,
    };
  }
}
