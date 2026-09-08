import { CoachRuntimeConfig } from './coach-config.schema';

export type CoachModelRole = 'writer' | 'grader' | 'reasoner';

export type CoachModelPolicy = Readonly<{
  provider: string;
  modelName: string;
  modelVersion: string;
  policyVersion: string;
  allowedRoles: readonly CoachModelRole[];
}>;

export class CoachModelPolicyRegistry {
  private readonly policies = new Map<string, CoachModelPolicy>();

  constructor(policies: readonly CoachModelPolicy[]) {
    for (const policy of policies) {
      this.policies.set(
        policy.policyVersion,
        Object.freeze({
          ...policy,
          allowedRoles: Object.freeze([...policy.allowedRoles]),
        }),
      );
    }
  }

  resolve(policyVersion: string, role: CoachModelRole): CoachModelPolicy {
    const policy = this.policies.get(policyVersion);
    if (!policy) throw new Error('Unknown Coach model policy version');
    if (!policy.allowedRoles.includes(role)) {
      throw new Error(`Coach model role ${role} is disabled`);
    }
    return policy;
  }
}

export function modelPoliciesFromConfig(
  config: CoachRuntimeConfig,
): CoachModelPolicy[] {
  if (
    !config.liveModelEnabled ||
    !config.modelName ||
    !config.modelVersion ||
    !config.modelPriceVersion
  ) {
    return [];
  }
  return [
    Object.freeze({
      provider: 'configured',
      modelName: config.modelName,
      modelVersion: config.modelVersion,
      policyVersion: config.modelPriceVersion,
      allowedRoles: Object.freeze(['writer', 'grader'] as const),
    }),
  ];
}
