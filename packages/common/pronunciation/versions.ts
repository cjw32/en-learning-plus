import { PRONUNCIATION_API_SCHEMA_VERSION } from "./api.schemas";
import { PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION } from "./provider.schemas";
import { PRONUNCIATION_RESULT_SCHEMA_VERSION } from "./result.schemas";

export const PRONUNCIATION_PROVIDER_ADAPTER_VERSION =
  "pronunciation-provider-adapter.v1" as const;
export const PRONUNCIATION_PROVIDER_API_CONTRACT_VERSION =
  "pronunciation-provider-api.v1" as const;
export const PRONUNCIATION_PROVIDER_CAPABILITY_VERSION =
  "pronunciation-provider-capability.v1" as const;
export const PRONUNCIATION_NORMALIZATION_VERSION =
  "pronunciation-normalization.v1" as const;
export const PRONUNCIATION_ALIGNMENT_VERSION =
  "pronunciation-alignment.v1" as const;
export const PRONUNCIATION_ASSESSMENT_RULE_VERSION =
  "pronunciation-assessment.v1" as const;
export const PRONUNCIATION_CONFIDENCE_POLICY_VERSION =
  "pronunciation-confidence.v1" as const;
export const PRONUNCIATION_LEARNING_MAPPING_VERSION =
  "pronunciation-quality.v1" as const;
export const PRONUNCIATION_SCHEDULER_VERSION = "SM2_V1" as const;
export const PRONUNCIATION_BUDGET_POLICY_SCHEMA_VERSION =
  "pronunciation-budget-policy.v1" as const;
export const PRONUNCIATION_PRICE_CATALOG_SCHEMA_VERSION =
  "pronunciation-price-catalog.v1" as const;

export const PRONUNCIATION_CONTRACT_VERSIONS = Object.freeze({
  apiSchema: PRONUNCIATION_API_SCHEMA_VERSION,
  resultSchema: PRONUNCIATION_RESULT_SCHEMA_VERSION,
  providerResultSchema: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  providerAdapter: PRONUNCIATION_PROVIDER_ADAPTER_VERSION,
  providerApi: PRONUNCIATION_PROVIDER_API_CONTRACT_VERSION,
  providerCapability: PRONUNCIATION_PROVIDER_CAPABILITY_VERSION,
  normalization: PRONUNCIATION_NORMALIZATION_VERSION,
  alignment: PRONUNCIATION_ALIGNMENT_VERSION,
  assessmentRule: PRONUNCIATION_ASSESSMENT_RULE_VERSION,
  confidencePolicy: PRONUNCIATION_CONFIDENCE_POLICY_VERSION,
  learningMapping: PRONUNCIATION_LEARNING_MAPPING_VERSION,
  scheduler: PRONUNCIATION_SCHEDULER_VERSION,
  budgetSchema: PRONUNCIATION_BUDGET_POLICY_SCHEMA_VERSION,
  priceSchema: PRONUNCIATION_PRICE_CATALOG_SCHEMA_VERSION,
});

export type PronunciationContractVersions =
  typeof PRONUNCIATION_CONTRACT_VERSIONS;
