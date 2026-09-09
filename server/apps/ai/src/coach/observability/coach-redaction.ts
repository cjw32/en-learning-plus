import { createHmac } from 'node:crypto';
import type {
  RetrievalTraceFailureCode,
  RetrievalTraceMetadata,
  RetrievalTraceStatus,
} from './rag-trace.types';

const allowedKeys = new Set([
  'requestId',
  'traceId',
  'traceSubjectId',
  'status',
  'sequence',
  'stepName',
  'toolName',
  'durationMs',
  'ttftMs',
  'totalDurationMs',
  'inputTokens',
  'outputTokens',
  'toolCallCount',
  'schemaFailureCount',
  'retryCount',
  'errorCode',
  'resultType',
  'promptVersion',
  'promptHash',
  'modelProvider',
  'modelName',
  'modelVersion',
  'estimatedCostMicros',
  'currency',
  'sourceIds',
  'counts',
  'rag',
]);

const sensitivePatterns = [
  ['jwt', /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/i],
  ['refresh_token', /\brefresh[-_\s]?token\b/i],
  ['api_key', /\bsk-[A-Za-z0-9_-]{8,}\b/i],
  ['database_url', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/i],
  ['system_prompt', /\bsystem\s+prompt\b/i],
  ['reasoning', /\b(?:chain[- ]of[- ]thought|private\s+reasoning|raw\s+reasoning)\b/i],
  ['answer_key', /\banswer\s*key\b/i],
  ['stack', /(?:^|\n)\s*at\s+[^\n]+:\d+(?::\d+)?/i],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['phone', /(?<!\d)1[3-9]\d{9}(?!\d)/],
  ['cross_user_canary', /\bother[-_ ]user[-_ ][A-Za-z0-9_-]*canary\b/i],
  ['private_content', /\b(?:rag[-_ ]private[-_ ]document|private[-_ ]content)[-_ ][A-Za-z0-9_-]*canary\b/i],
  ['raw_user_id', /\braw[-_ ]user[-_ ]id[-_ ][A-Za-z0-9_-]*canary\b/i],
] as const;

const retrievalStatuses = new Set<RetrievalTraceStatus>([
  'success',
  'insufficient',
  'failed',
]);
const retrievalFailureCodes = new Set<RetrievalTraceFailureCode>([
  'RAG_DISABLED',
  'RETRIEVAL_INSUFFICIENT',
  'EMPTY_RECALL',
  'LOW_RELEVANCE',
  'SOURCE_UNAVAILABLE',
  'SOURCE_INVALID',
  'CITATION_UNAVAILABLE',
  'EMBEDDING_UNAVAILABLE',
  'TOOL_TIMEOUT',
  'CONFIGURATION_UNAPPROVED',
  'SCHEMA_INVALID',
  'CANCELLED',
  'INTERNAL_ERROR',
]);
const accessScopes = new Set(['PUBLIC', 'OWNED_COURSE', 'PRIVATE_OWNER']);
const rankingDecisions = new Set([
  'used',
  'unused',
  'deduplicated',
  'conflict_discarded',
  'below_threshold',
]);

export function findCoachSensitiveMatches(value: string): string[] {
  return sensitivePatterns
    .filter(([, pattern]) => pattern.test(value))
    .map(([name]) => name);
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return findCoachSensitiveMatches(value).length > 0 ? '[REDACTED]' : value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactValue(item),
      ]),
    );
  }
  return value;
}

export function createTraceSubjectId(
  subjectId: string,
  pepper: string,
): string {
  if (!subjectId.trim() || !pepper.trim()) {
    throw new Error('Trace subject inputs are required');
  }
  return `ts_${createHmac('sha256', pepper).update(subjectId).digest('hex')}`;
}

export function createRagDiagnosticHash(value: string, pepper: string): string {
  if (!value.trim() || !pepper.trim()) {
    throw new Error('RAG diagnostic hash inputs are required');
  }
  return `rd_${createHmac('sha256', pepper).update(value).digest('hex')}`;
}

function safeString(value: unknown, maxLength = 256): string | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    findCoachSensitiveMatches(value).length > 0
  ) {
    return undefined;
  }
  return value;
}

function safeStrings(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .slice(0, maxItems)
        .map((item) => safeString(item, 256))
        .filter((item): item is string => item !== undefined),
    ),
  ];
}

function safeCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Runtime counterpart to RetrievalTraceMetadata's compile-time allowlist.
 * Unknown and unsafe values are dropped, including all diagnostic body fields.
 */
export function redactRagTraceMetadata(
  payload: unknown,
): Partial<RetrievalTraceMetadata> {
  const input = objectValue(payload);
  const output: Record<string, unknown> = {};
  if (input.metadataVersion === 'rag-trace.v1') {
    output.metadataVersion = input.metadataVersion;
  }
  if (typeof input.queryHash === 'string' && /^[a-f0-9]{64}$/i.test(input.queryHash)) {
    output.queryHash = input.queryHash.toLowerCase();
  }
  const status = safeString(input.status, 20);
  if (status && retrievalStatuses.has(status as RetrievalTraceStatus)) {
    output.status = status;
  }
  if (input.failureCode === null) output.failureCode = null;
  const failureCode = safeString(input.failureCode, 64);
  if (
    failureCode &&
    retrievalFailureCodes.has(failureCode as RetrievalTraceFailureCode)
  ) {
    output.failureCode = failureCode;
  }

  const filters = objectValue(input.appliedFilters);
  if (Object.keys(filters).length > 0) {
    output.appliedFilters = {
      levels: safeStrings(filters.levels, 6),
      categories: safeStrings(filters.categories, 20),
      sources: safeStrings(filters.sources, 20),
      courseIds: safeStrings(filters.courseIds, 20),
      wordIds: safeStrings(filters.wordIds, 50),
      accessScopes: safeStrings(filters.accessScopes, 3).filter((value) =>
        accessScopes.has(value),
      ),
    };
  }

  const versions = objectValue(input.versions);
  const versionKeys = [
    'sourceRightsSnapshotVersion',
    'contentVersion',
    'chunkingVersion',
    'embeddingVersion',
    'retrievalConfigVersion',
    'indexVersion',
  ] as const;
  if (Object.keys(versions).length > 0) {
    output.versions = Object.fromEntries(
      versionKeys.flatMap((key) => {
        const value = safeString(versions[key], 256);
        return value ? [[key, value]] : [];
      }),
    );
  }

  const counts = objectValue(input.counts);
  const countKeys = [
    'rawRecall',
    'accessEligible',
    'relevanceEligible',
    'deduplicated',
    'contextSelected',
  ] as const;
  if (Object.keys(counts).length > 0) {
    output.counts = Object.fromEntries(
      countKeys.flatMap((key) => {
        const value = safeCount(counts[key]);
        return value === undefined ? [] : [[key, value]];
      }),
    );
  }

  for (const key of [
    'topK',
    'conflictCount',
    'deduplicatedCount',
    'retrievalDurationMs',
    'contextTokens',
  ] as const) {
    const value = safeCount(input[key]);
    if (value !== undefined) output[key] = value;
  }
  if (
    typeof input.minimumRelevance === 'number' &&
    Number.isFinite(input.minimumRelevance) &&
    input.minimumRelevance >= 0 &&
    input.minimumRelevance <= 1
  ) {
    output.minimumRelevance = input.minimumRelevance;
  }
  if (input.tokenCountMode === 'model' || input.tokenCountMode === 'fallback') {
    output.tokenCountMode = input.tokenCountMode;
  }
  output.usedCitationIds = safeStrings(input.usedCitationIds, 20);
  output.unusedCitationIds = safeStrings(input.unusedCitationIds, 100);

  if (Array.isArray(input.rankings)) {
    output.rankings = input.rankings.slice(0, 100).flatMap((item) => {
      const ranking = objectValue(item);
      const citationId = safeString(ranking.citationId, 64);
      const sourceIdHash = safeString(ranking.sourceIdHash, 64);
      const sourceCategory = safeString(ranking.sourceCategory, 64);
      const rank = safeCount(ranking.rank);
      const decision = safeString(ranking.decision, 32);
      if (
        !citationId ||
        !sourceIdHash ||
        !/^[a-f0-9]{64}$/i.test(sourceIdHash) ||
        !sourceCategory ||
        rank === undefined ||
        rank < 1 ||
        typeof ranking.relevanceScore !== 'number' ||
        ranking.relevanceScore < 0 ||
        ranking.relevanceScore > 1 ||
        !decision ||
        !rankingDecisions.has(decision)
      ) {
        return [];
      }
      return [{
        citationId,
        sourceIdHash: sourceIdHash.toLowerCase(),
        sourceCategory,
        rank,
        relevanceScore: ranking.relevanceScore,
        decision,
      }];
    });
  }

  if (Array.isArray(input.claimCitations)) {
    output.claimCitations = input.claimCitations.slice(0, 100).flatMap((item) => {
      const claim = objectValue(item);
      const claimPath = safeString(claim.claimPath, 256);
      if (!claimPath) return [];
      return [{
        claimPath,
        citationIds: safeStrings(claim.citationIds, 20),
      }];
    });
  }
  return Object.freeze(output) as Partial<RetrievalTraceMetadata>;
}

export function redactCoachPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(payload)
        .filter(([key]) => allowedKeys.has(key))
        .map(([key, value]) => [
          key,
          key === 'rag' ? redactRagTraceMetadata(value) : redactValue(value),
        ]),
    ),
  );
}
