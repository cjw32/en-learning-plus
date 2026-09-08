import type {
  NextActionDecision,
  NextActionEvidenceCode,
} from '../workflow/next-action.policy';

export const EXPLAIN_NEXT_ACTION_PROMPT_VERSION =
  'coach-next-action-explanation-v1';

const evidenceDescriptions: Record<NextActionEvidenceCode, string> = {
  CURRENT_QUALITY_BELOW_FOUR: '本次有效批改存在质量低于 4 的学习项',
  DUE_ITEMS_AVAILABLE: '当前存在已到期的复习内容',
  NO_LOW_QUALITY_OR_DUE_ITEMS: '没有低质量的本次结果，也没有到期内容',
  PROFILE_SIGNAL_MISSING: '部分学习画像信号缺失',
  PROFILE_SIGNAL_STALE: '部分学习画像信号已过期',
};

export function buildExplainNextActionPrompt(decision: NextActionDecision) {
  return Object.freeze({
    version: EXPLAIN_NEXT_ACTION_PROMPT_VERSION,
    system:
      '只解释服务端已经确定的下一步学习动作。不得改变动作，不得推测缺失画像，不得添加未提供的学习事实。只返回 JSON 对象 {"reason": string}。',
    action: decision.nextAction,
    evidence: decision.evidenceCodes.map((code) => ({
      code,
      description: evidenceDescriptions[code],
    })),
  });
}
