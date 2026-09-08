export type NextAction = 'review' | 'practice' | 'continue';

export type NextActionEvidenceCode =
  | 'CURRENT_QUALITY_BELOW_FOUR'
  | 'DUE_ITEMS_AVAILABLE'
  | 'NO_LOW_QUALITY_OR_DUE_ITEMS'
  | 'PROFILE_SIGNAL_MISSING'
  | 'PROFILE_SIGNAL_STALE';

export type ProfileSignalState = Readonly<{
  dimension: string;
  status: 'AVAILABLE' | 'MISSING' | 'STALE' | 'NOT_APPLICABLE';
}>;

export type NextActionFacts = Readonly<{
  validCurrentQualities: readonly number[];
  dueCount: number;
  profileSignals: readonly ProfileSignalState[];
}>;

export type NextActionDecision = Readonly<{
  nextAction: NextAction;
  evidenceCodes: readonly NextActionEvidenceCode[];
}>;

function profileEvidence(
  signals: readonly ProfileSignalState[],
): NextActionEvidenceCode[] {
  const evidence: NextActionEvidenceCode[] = [];
  if (signals.some((signal) => signal.status === 'MISSING')) {
    evidence.push('PROFILE_SIGNAL_MISSING');
  }
  if (signals.some((signal) => signal.status === 'STALE')) {
    evidence.push('PROFILE_SIGNAL_STALE');
  }
  return evidence;
}

/**
 * Business-owned next-action decision. It intentionally accepts facts rather
 * than model prose, so a model cannot override the action or invent profile
 * values. Invalid qualities and due counts do not become recommendation facts.
 */
export function decideNextAction(facts: NextActionFacts): NextActionDecision {
  const qualities = facts.validCurrentQualities.filter(
    (quality) => Number.isInteger(quality) && quality >= 0 && quality <= 5,
  );
  const dueCount =
    Number.isInteger(facts.dueCount) && facts.dueCount > 0 ? facts.dueCount : 0;

  let nextAction: NextAction;
  let primaryEvidence: NextActionEvidenceCode;
  if (qualities.length > 0 && Math.min(...qualities) < 4) {
    nextAction = 'practice';
    primaryEvidence = 'CURRENT_QUALITY_BELOW_FOUR';
  } else if (dueCount > 0) {
    nextAction = 'review';
    primaryEvidence = 'DUE_ITEMS_AVAILABLE';
  } else {
    nextAction = 'continue';
    primaryEvidence = 'NO_LOW_QUALITY_OR_DUE_ITEMS';
  }

  return Object.freeze({
    nextAction,
    evidenceCodes: Object.freeze([
      primaryEvidence,
      ...profileEvidence(facts.profileSignals),
    ]),
  });
}

export function deterministicNextActionReason(
  decision: NextActionDecision,
): string {
  switch (decision.nextAction) {
    case 'practice':
      return '本次练习仍有薄弱项，建议针对错误再练一次。';
    case 'review':
      return '当前还有到期内容，建议按复习计划先完成复习。';
    case 'continue':
      return decision.evidenceCodes.includes('PROFILE_SIGNAL_MISSING')
        ? '当前没有需要立即复习的内容；部分学习画像尚未设置，可继续学习并逐步完善。'
        : '本次没有低质量结果或到期内容，可以继续学习新内容。';
  }
}
