import { Injectable } from '@nestjs/common';
import {
  COACH_TOOL_SCHEMA_VERSION,
  getDueWordsInputSchema,
  getDueWordsOutputSchema,
  type GetDueWordsOutput,
} from '@en/common/coach';
import { LearningDomainError, ReviewScheduleService } from '@libs/learning';
import type { CoachExecutionContext } from '@libs/shared';

class DueWordsTimeoutError extends Error {}

@Injectable()
export class GetDueWordsTool {
  readonly name = 'get_due_words' as const;
  readonly mode = 'read' as const;
  private readonly cache = new Map<string, Promise<GetDueWordsOutput>>();

  constructor(
    private readonly schedules: ReviewScheduleService,
    private readonly timeoutMs = 5_000,
  ) {}

  execute(
    context: CoachExecutionContext,
    untrustedInput: unknown,
  ): Promise<GetDueWordsOutput> {
    const parsed = getDueWordsInputSchema.safeParse(untrustedInput);
    if (!parsed.success) {
      return Promise.resolve({
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: false,
        code: 'VALIDATION_FAILED',
        message: '到期复习工具参数无效',
        retryable: false,
      });
    }
    const input = {
      learningDate: parsed.data.learningDate,
      timezone: parsed.data.timezone,
      limit: parsed.data.limit,
      ...(parsed.data.courseId ? { courseId: parsed.data.courseId } : {}),
    };
    const key = `${context.subjectId}:${JSON.stringify(input)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.read(context.subjectId, input).then((output) => {
      if (!output.ok) this.cache.delete(key);
      return output;
    });
    this.cache.set(key, pending);
    return pending;
  }

  private async read(
    subjectId: string,
    input: {
      learningDate: string;
      timezone: string;
      limit: number;
      courseId?: string;
    },
  ): Promise<GetDueWordsOutput> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.schedules.getDueWords(subjectId, input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new DueWordsTimeoutError()),
            this.timeoutMs,
          );
        }),
      ]);
      return getDueWordsOutputSchema.parse({
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: true,
        asOf: result.asOf.toISOString(),
        words: result.words.map((word) => ({
          ...word,
          dueAt: word.dueAt.toISOString(),
        })),
        totalDue: result.totalDue,
        truncated: result.truncated,
      });
    } catch (error) {
      if (error instanceof DueWordsTimeoutError) {
        return {
          schemaVersion: COACH_TOOL_SCHEMA_VERSION,
          ok: false,
          code: 'TOOL_TIMEOUT',
          message: '读取到期复习内容超时',
          retryable: true,
        };
      }
      const code =
        error instanceof LearningDomainError
          ? error.code
          : 'DATA_NOT_AVAILABLE';
      return getDueWordsOutputSchema.parse({
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: false,
        code,
        message: '到期复习内容暂时不可用',
        retryable: code === 'DATA_NOT_AVAILABLE',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
