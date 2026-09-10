export type CoachRuntimeConfig = Readonly<{
  enabled: boolean;
  liveModelEnabled: boolean;
  writeEnabled: boolean;
  modelName: string | null;
  modelVersion: string | null;
  modelPriceVersion: string | null;
  budgetPolicyVersion: string | null;
  evaluationDatasetVersion: string | null;
}>;

export type RagRuntimeConfig = Readonly<{
  enabled: boolean;
  shadowEnabled: boolean;
  ingestionEnabled: boolean;
  privateContentEnabled: boolean;
  embeddingProviderApproved: boolean;
  embeddingEndpoint: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  embeddingVersion: string | null;
  sourceRightsSnapshotVersion: string | null;
  chunkingVersion: string | null;
  retrievalConfigVersion: string | null;
  indexVersion: string | null;
  resultSchemaVersion: string | null;
  priceVersion: string | null;
  topK: number;
  minimumRelevance: number;
  contextTokenBudget: number;
  timeoutMs: number;
  maxRetries: number;
  testBudgetMicros: number | null;
}>;

const forbiddenValues = new Set([
  '',
  'placeholder',
  'replace-me',
  'todo',
  'tbd',
  'unknown',
]);

function optionalVersion(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function assertApprovedValue(name: string, value: string | null): void {
  if (!value || forbiddenValues.has(value.toLowerCase())) {
    throw new Error(`${name} must be an approved non-placeholder value`);
  }
}

function optionalInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return parsed;
}

function optionalNumber(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a number in [${minimum}, ${maximum}]`);
  }
  return parsed;
}

export function resolveCoachRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): CoachRuntimeConfig {
  const result: CoachRuntimeConfig = Object.freeze({
    enabled: enabled(environment.COACH_ENABLED),
    liveModelEnabled: enabled(environment.COACH_LIVE_MODEL_ENABLED),
    writeEnabled: enabled(environment.COACH_WRITE_ENABLED),
    modelName: optionalVersion(environment.COACH_MODEL_NAME),
    modelVersion: optionalVersion(environment.COACH_MODEL_VERSION),
    modelPriceVersion: optionalVersion(environment.COACH_MODEL_PRICE_VERSION),
    budgetPolicyVersion: optionalVersion(
      environment.COACH_BUDGET_POLICY_VERSION,
    ),
    evaluationDatasetVersion: optionalVersion(
      environment.COACH_EVAL_DATASET_VERSION,
    ),
  });

  if (result.liveModelEnabled && !result.enabled) {
    throw new Error('COACH_LIVE_MODEL_ENABLED requires COACH_ENABLED');
  }
  if (result.writeEnabled && !result.liveModelEnabled) {
    throw new Error('COACH_WRITE_ENABLED requires COACH_LIVE_MODEL_ENABLED');
  }

  if (result.liveModelEnabled || result.writeEnabled) {
    assertApprovedValue('COACH_MODEL_NAME', result.modelName);
    assertApprovedValue('COACH_MODEL_VERSION', result.modelVersion);
    assertApprovedValue('COACH_MODEL_PRICE_VERSION', result.modelPriceVersion);
    assertApprovedValue(
      'COACH_BUDGET_POLICY_VERSION',
      result.budgetPolicyVersion,
    );
    assertApprovedValue(
      'COACH_EVAL_DATASET_VERSION',
      result.evaluationDatasetVersion,
    );
  }

  return result;
}

export function resolveRagRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): RagRuntimeConfig {
  const dimensionsText = optionalVersion(environment.RAG_EMBEDDING_DIMENSIONS);
  const budgetText = optionalVersion(environment.RAG_TEST_BUDGET_MICROS);
  const result: RagRuntimeConfig = Object.freeze({
    enabled: enabled(environment.RAG_ENABLED),
    shadowEnabled: enabled(environment.RAG_SHADOW_ENABLED),
    ingestionEnabled: enabled(environment.RAG_INGESTION_ENABLED),
    privateContentEnabled: enabled(environment.RAG_PRIVATE_CONTENT_ENABLED),
    embeddingProviderApproved: enabled(
      environment.RAG_EMBEDDING_PROVIDER_APPROVED,
    ),
    embeddingEndpoint: optionalVersion(environment.RAG_EMBEDDING_ENDPOINT),
    embeddingModel: optionalVersion(environment.RAG_EMBEDDING_MODEL),
    embeddingDimensions: dimensionsText
      ? optionalInteger('RAG_EMBEDDING_DIMENSIONS', dimensionsText, 0, 1, 65535)
      : null,
    embeddingVersion: optionalVersion(environment.RAG_EMBEDDING_VERSION),
    sourceRightsSnapshotVersion: optionalVersion(
      environment.RAG_SOURCE_RIGHTS_SNAPSHOT_VERSION,
    ),
    chunkingVersion: optionalVersion(environment.RAG_CHUNKING_VERSION),
    retrievalConfigVersion: optionalVersion(
      environment.RAG_RETRIEVAL_CONFIG_VERSION,
    ),
    indexVersion: optionalVersion(environment.RAG_INDEX_VERSION),
    resultSchemaVersion: optionalVersion(environment.RAG_RESULT_SCHEMA_VERSION),
    priceVersion: optionalVersion(environment.RAG_PRICE_VERSION),
    topK: optionalInteger('RAG_TOP_K', environment.RAG_TOP_K, 8, 1, 20),
    minimumRelevance: optionalNumber(
      'RAG_MINIMUM_RELEVANCE',
      environment.RAG_MINIMUM_RELEVANCE,
      0.65,
      0,
      1,
    ),
    contextTokenBudget: optionalInteger(
      'RAG_CONTEXT_TOKEN_BUDGET',
      environment.RAG_CONTEXT_TOKEN_BUDGET,
      1200,
      1,
      32000,
    ),
    timeoutMs: optionalInteger(
      'RAG_TIMEOUT_MS',
      environment.RAG_TIMEOUT_MS,
      1500,
      1,
      60000,
    ),
    maxRetries: optionalInteger(
      'RAG_MAX_RETRIES',
      environment.RAG_MAX_RETRIES,
      0,
      0,
      3,
    ),
    testBudgetMicros: budgetText
      ? optionalInteger(
          'RAG_TEST_BUDGET_MICROS',
          budgetText,
          0,
          1,
          Number.MAX_SAFE_INTEGER,
        )
      : null,
  });

  const anyCapabilityEnabled =
    result.enabled ||
    result.shadowEnabled ||
    result.ingestionEnabled ||
    result.privateContentEnabled;
  if (
    (result.enabled || result.shadowEnabled) &&
    !enabled(environment.COACH_ENABLED)
  ) {
    throw new Error('RAG_ENABLED requires COACH_ENABLED');
  }
  if (result.privateContentEnabled && !result.ingestionEnabled) {
    throw new Error(
      'RAG_PRIVATE_CONTENT_ENABLED requires RAG_INGESTION_ENABLED',
    );
  }
  if (anyCapabilityEnabled && !result.embeddingProviderApproved) {
    throw new Error(
      'RAG_EMBEDDING_PROVIDER_APPROVED is required for enabled RAG capabilities',
    );
  }

  if (anyCapabilityEnabled || result.embeddingProviderApproved) {
    for (const [name, value] of [
      ['RAG_EMBEDDING_ENDPOINT', result.embeddingEndpoint],
      ['RAG_EMBEDDING_MODEL', result.embeddingModel],
      ['RAG_EMBEDDING_VERSION', result.embeddingVersion],
      [
        'RAG_SOURCE_RIGHTS_SNAPSHOT_VERSION',
        result.sourceRightsSnapshotVersion,
      ],
      ['RAG_CHUNKING_VERSION', result.chunkingVersion],
      ['RAG_RETRIEVAL_CONFIG_VERSION', result.retrievalConfigVersion],
      ['RAG_INDEX_VERSION', result.indexVersion],
      ['RAG_RESULT_SCHEMA_VERSION', result.resultSchemaVersion],
      ['RAG_PRICE_VERSION', result.priceVersion],
    ] as const) {
      assertApprovedValue(name, value);
    }
    if (!result.embeddingDimensions || !result.testBudgetMicros) {
      throw new Error(
        'RAG_EMBEDDING_DIMENSIONS and RAG_TEST_BUDGET_MICROS are required',
      );
    }
    let endpoint: URL;
    try {
      endpoint = new URL(result.embeddingEndpoint!);
    } catch {
      throw new Error('RAG_EMBEDDING_ENDPOINT must be an approved HTTPS URL');
    }
    if (endpoint.protocol !== 'https:') {
      throw new Error('RAG_EMBEDDING_ENDPOINT must use HTTPS');
    }
  }

  return result;
}
