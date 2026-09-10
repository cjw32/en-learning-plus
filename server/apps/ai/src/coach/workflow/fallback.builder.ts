import {
  COACH_RESULT_SCHEMA_VERSION,
  COACH_RESULT_V2_SCHEMA_VERSION,
  coachResultSchema,
  publicCoachResultV2Schema,
} from '@en/common/coach';
import type { CoachFailure } from '../governance/coach-failure.mapper';

export class RagRetrievalDegradationError extends Error {
  constructor(
    readonly outcome: 'insufficient' | 'failed',
    readonly diagnosticCode: string,
  ) {
    super(`RAG_${outcome.toUpperCase()}`);
    this.name = 'RagRetrievalDegradationError';
  }
}

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

export function buildRagDegradationFallback(
  traceId: string,
  outcome: Readonly<{
    status: 'insufficient' | 'failed';
    diagnosticCode: string;
  }>,
) {
  const explanation =
    outcome.status === 'insufficient'
      ? '当前学习材料不足以支持可靠的知识性回答。你仍可继续进行不依赖这些材料的学习操作。'
      : '学习材料检索暂时不可用。你仍可继续进行不依赖这些材料的学习操作。';
  return publicCoachResultV2Schema.parse({
    schemaVersion: COACH_RESULT_V2_SCHEMA_VERSION,
    responseType: 'degraded',
    correction: '',
    explanation,
    examples: [],
    errorTypes: [],
    score: null,
    nextAction: 'continue',
    citations: [],
    nextActionReason: '本次没有基于不足或失败材料生成练习、批改或学习写入。',
    traceId,
    knowledgeStatus: outcome.status,
    groundedClaims: [],
  });
}
