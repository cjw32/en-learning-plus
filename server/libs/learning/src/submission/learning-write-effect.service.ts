import { Injectable } from '@nestjs/common';
import {
  mcpConfirmationOperationSummarySchema,
  type McpConfirmationView,
} from '@en/common/mcp';
import { z } from '@en/common/coach/zod';

export type LearningWriteEffectSummary =
  McpConfirmationView['operationSummary'];

const inputSchema = z
  .object({
    answerCount: z.number().int().min(1).max(50),
  })
  .strict();

export class LearningWriteEffectError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor() {
    super('The learning write effect could not be summarized.');
    this.name = 'LearningWriteEffectError';
  }
}

@Injectable()
export class LearningWriteEffectService {
  summarize(untrustedInput: unknown): LearningWriteEffectSummary {
    const input = inputSchema.safeParse(untrustedInput);
    if (!input.success) throw new LearningWriteEffectError();
    const summary = mcpConfirmationOperationSummarySchema.safeParse({
      answerCount: input.data.answerCount,
      willSaveAttempt: true,
      willUpdateMastery: true,
      willUpdateReviewSchedule: true,
      notice:
        input.data.answerCount === 1
          ? 'Your answer will be graded and saved; mastery and the review schedule will be updated.'
          : `Your ${input.data.answerCount} answers will be graded and saved; mastery and the review schedule will be updated.`,
    });
    if (!summary.success) throw new LearningWriteEffectError();
    return Object.freeze(summary.data);
  }
}
