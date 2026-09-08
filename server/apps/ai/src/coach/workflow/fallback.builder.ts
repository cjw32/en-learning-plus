import {
  COACH_RESULT_SCHEMA_VERSION,
  coachResultSchema,
} from '@en/common/coach';
import type { CoachFailure } from '../governance/coach-failure.mapper';

export function buildCoachFailureFallback(
  traceId: string,
  failure: CoachFailure,
) {
  const result = coachResultSchema.parse({
    schemaVersion: COACH_RESULT_SCHEMA_VERSION,
    responseType: 'degraded',
    correction: '',
    explanation: failure.message,
    examples: [],
    errorTypes: [],
    score: null,
    nextAction: 'continue',
    citations: [],
    nextActionReason:
      failure.saveStatus === 'SAVED_ONCE'
        ? '此前完成的学习更新已经保存一次。'
        : '本次没有确认新的学习状态更新，可按提示处理。',
    traceId,
  });
  return Object.freeze({ failure, result });
}
