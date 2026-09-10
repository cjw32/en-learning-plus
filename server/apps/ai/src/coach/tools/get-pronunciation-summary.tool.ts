import { Injectable } from '@nestjs/common';
import {
  COACH_TOOL_SCHEMA_VERSION,
  getPronunciationSummaryInputSchema,
  getPronunciationSummaryOutputSchema,
  type GetPronunciationSummaryOutput,
} from '@en/common/coach';
import { PronunciationContextService } from '@libs/learning';
import type { CoachExecutionContext } from '@libs/shared';

@Injectable()
export class GetPronunciationSummaryTool {
  readonly name = 'get_pronunciation_summary' as const;
  readonly mode = 'read' as const;

  constructor(
    private readonly contexts: Pick<
      PronunciationContextService,
      'getOwnedSummary'
    >,
    private readonly enabled = false,
  ) {}

  async execute(
    context: CoachExecutionContext,
    untrustedInput: unknown,
  ): Promise<GetPronunciationSummaryOutput> {
    const parsed = getPronunciationSummaryInputSchema.safeParse(untrustedInput);
    if (!parsed.success) return this.failure('VALIDATION_FAILED');
    if (!this.enabled) return this.failure('DATA_NOT_AVAILABLE');

    try {
      const summary = await this.contexts.getOwnedSummary(
        context.subjectId,
        parsed.data.assessmentId,
      );
      if (!summary) return this.failure('RESOURCE_NOT_FOUND');
      return getPronunciationSummaryOutputSchema.parse({
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: true,
        ...summary,
      });
    } catch {
      return this.failure('DATA_NOT_AVAILABLE', true);
    }
  }

  private failure(
    code: 'VALIDATION_FAILED' | 'RESOURCE_NOT_FOUND' | 'DATA_NOT_AVAILABLE',
    retryable = false,
  ): GetPronunciationSummaryOutput {
    return {
      schemaVersion: COACH_TOOL_SCHEMA_VERSION,
      ok: false,
      code,
      message:
        code === 'VALIDATION_FAILED'
          ? '发音评测摘要工具参数无效'
          : code === 'RESOURCE_NOT_FOUND'
            ? '发音评测摘要不存在或不可用'
            : '发音评测摘要暂不可用',
      retryable,
    };
  }
}
