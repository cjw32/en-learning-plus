import { Injectable } from '@nestjs/common';
import {
  COACH_TOOL_SCHEMA_VERSION,
  getLearnerProfileInputSchema,
  getLearnerProfileOutputSchema,
  type GetLearnerProfileOutput,
} from '@en/common/coach';
import { LearnerProfileService, LearningDomainError } from '@libs/learning';
import { CoachExecutionContext } from '@libs/shared';

@Injectable()
export class GetLearnerProfileTool {
  readonly name = 'get_learner_profile' as const;
  readonly mode = 'read' as const;

  constructor(private readonly profiles: LearnerProfileService) {}

  async execute(
    context: CoachExecutionContext,
    untrustedInput: unknown,
  ): Promise<GetLearnerProfileOutput> {
    const input = getLearnerProfileInputSchema.safeParse(untrustedInput);
    if (!input.success) {
      return {
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: false,
        code: 'VALIDATION_FAILED',
        message: '学习画像工具参数无效',
        retryable: false,
      };
    }
    try {
      const snapshot = await this.profiles.getSnapshot(
        context.subjectId,
        input.data.perDimensionLimit,
      );
      return getLearnerProfileOutputSchema.parse({
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: true,
        snapshotAt: snapshot.snapshotAt.toISOString(),
        timezone: snapshot.timezone,
        level: snapshot.level,
        goal: snapshot.goal,
        activeCourse: snapshot.activeCourse,
        learnedWordSummary: snapshot.learnedWordSummary,
        weakItems: snapshot.weakItems.map((item) => ({
          ...item,
          dueAt: item.dueAt?.toISOString() ?? null,
        })),
        errorTypes: snapshot.errorTypes.map((item) => ({
          ...item,
          lastSeenAt: item.lastSeenAt.toISOString(),
        })),
        recentPerformance: {
          ...snapshot.recentPerformance,
          windowStart: snapshot.recentPerformance.windowStart.toISOString(),
        },
        signals: snapshot.signals.filter((signal) =>
          input.data.dimensions.includes(signal.dimension),
        ),
      });
    } catch (error) {
      const code =
        error instanceof LearningDomainError
          ? error.code
          : 'DATA_NOT_AVAILABLE';
      return getLearnerProfileOutputSchema.parse({
        schemaVersion: COACH_TOOL_SCHEMA_VERSION,
        ok: false,
        code,
        message: '学习画像暂时不可用',
        retryable: code === 'DATA_NOT_AVAILABLE',
      });
    }
  }
}
