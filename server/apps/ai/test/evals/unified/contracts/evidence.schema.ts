import { z } from '@en/common/coach/zod';
import {
  idSchema,
  hashSchema,
  timeSchema,
  stringsSchema,
  contentRefSchema,
  relativePathSchema,
  requirementsSchema,
  modeSchema,
  moduleSchema,
} from './case.schema';

export const measuredValueSchema = z
  .strictObject({
    value: z.number().finite().nonnegative().nullable(),
    unavailableReason: idSchema.nullable(),
  })
  .refine((v) =>
    v.value === null
      ? v.unavailableReason !== null
      : v.unavailableReason === null,
  );
export const identityValueSchema = z
  .strictObject({
    value: idSchema.nullable(),
    unavailableReason: idSchema.nullable(),
  })
  .refine((v) =>
    v.value === null
      ? v.unavailableReason !== null
      : v.unavailableReason === null,
  );
export const usageSchema = z.strictObject({
  inputTokens: measuredValueSchema,
  outputTokens: measuredValueSchema,
  audioMs: measuredValueSchema,
  embeddingTokens: measuredValueSchema,
  actualCostMicros: measuredValueSchema,
  estimatedCostMicros: measuredValueSchema,
  potentialCostMicros: measuredValueSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  priceVersion: identityValueSchema,
  calculationBasis: idSchema,
});
export const stepObservationSchema = z
  .strictObject({
    stage: z.enum([
      'auth',
      'retrieval',
      'model',
      'tool',
      'audio',
      'judge',
      'write',
      'rule',
    ]),
    actualMode: modeSchema,
    dependencyKind: z.enum(['real', 'mock', 'replay', 'none']),
    inputHash: hashSchema,
    outputHash: hashSchema.nullable(),
    observationRef: contentRefSchema.nullable(),
    traceId: idSchema.nullable(),
    requestId: idSchema.nullable(),
    callId: idSchema.nullable(),
    version: idSchema,
    usage: usageSchema.nullable(),
    sideEffectEvidence: z.array(contentRefSchema),
    errorCategory: idSchema.nullable(),
    expectedFault: z.boolean(),
  })
  .refine(
    (v) => v.actualMode !== 'live' || v.dependencyKind === 'real',
    'live cannot use a substitute',
  );
export const approvalSchema = z.strictObject({
  id: idSchema,
  subjectHash: hashSchema,
  approvedBy: idSchema,
  approvedAt: timeSchema,
  reason: idSchema,
  status: z.enum(['pending', 'approved', 'revoked']),
});
export const budgetReservationSchema = z.strictObject({
  callId: idSchema,
  itemId: idSchema,
  attemptId: idSchema,
  purpose: z.enum(['candidate', 'baseline', 'embedding', 'judge', 'client']),
  provider: idSchema,
  priceVersion: idSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  upperBoundMicros: z.number().int().nonnegative().safe(),
  state: z.enum(['RESERVED', 'DISPATCHED', 'SETTLED', 'RELEASED', 'UNCERTAIN']),
  actualCostMicros: z.number().int().nonnegative().safe().nullable(),
  uncertainReason: idSchema.nullable(),
});
export const evaluatorDefinitionSchema = z.strictObject({
  id: idSchema,
  version: idSchema,
  type: z.enum(['rule', 'human', 'model']),
  rubricVersion: idSchema,
  dimensions: stringsSchema.min(1),
  inputSchemaHash: hashSchema,
  outputSchemaHash: hashSchema,
  ruleOrPromptHash: hashSchema,
  expectedEvidenceKinds: stringsSchema,
  requiresCalibration: z.boolean(),
});
export const judgeResultSchema = z.strictObject({
  provider: idSchema,
  model: idSchema,
  modelVersion: identityValueSchema,
  promptHash: hashSchema,
  rubricVersion: idSchema,
  scores: z
    .array(
      z
        .strictObject({
          dimension: idSchema,
          value: z.number().finite(),
          minimum: z.number().finite(),
          maximum: z.number().finite(),
          reason: idSchema,
          evidencePointers: z.array(contentRefSchema).min(1),
        })
        .refine((v) => v.minimum <= v.value && v.value <= v.maximum),
    )
    .min(1),
  usage: usageSchema,
  validity: z.enum(['valid', 'invalid', 'review']),
});
export const calibrationRecordSchema = z.strictObject({
  id: idSchema,
  version: idSchema,
  evaluatorId: idSchema,
  modelHash: hashSchema,
  promptHash: hashSchema,
  rubricHash: hashSchema,
  datasetHash: hashSchema,
  goldHash: hashSchema,
  authorizationRef: contentRefSchema,
  procedureRef: contentRefSchema,
  reviewerQualificationsRef: contentRefSchema,
  comparisons: z
    .array(
      z.strictObject({
        caseId: idSchema,
        humanScore: z.number().finite(),
        modelScore: z.number().finite(),
      }),
    )
    .min(1),
  scope: stringsSchema.min(1),
  approvalRef: contentRefSchema,
});
export const reviewDecisionSchema = z.strictObject({
  reviewId: idSchema,
  targetId: idSchema,
  priorDecisionHash: hashSchema,
  reviewer: idSchema,
  time: timeSchema,
  originalScoreRefs: z.array(contentRefSchema).min(1),
  evidenceRefs: z.array(contentRefSchema).min(1),
  decision: z.enum(['uphold', 'revise', 'inconclusive']),
  reason: idSchema,
  version: idSchema,
});
export const retentionPolicySchema = z.strictObject({
  policyId: idSchema,
  version: idSchema,
  artifactKinds: stringsSchema.min(1),
  roles: stringsSchema.min(1),
  ttlMs: z.number().int().positive().safe(),
  revocationDeadlineMs: z.number().int().positive().safe(),
  deleteMechanism: idSchema,
  replicaScopes: stringsSchema.min(1),
  approvalRef: contentRefSchema,
});
export const artifactDescriptorSchema = z.strictObject({
  artifactId: idSchema,
  runId: idSchema,
  kind: idSchema,
  relativePath: relativePathSchema,
  contentHash: hashSchema,
  size: z.number().int().nonnegative().safe(),
  sensitivity: z.enum([
    'synthetic_public',
    'restricted_metadata',
    'restricted_content',
    'audio',
  ]),
  accessPolicyRef: contentRefSchema,
  retentionPolicyRef: contentRefSchema,
  expiresAt: timeSchema,
  sourceAuthorizationRefs: z.array(contentRefSchema),
  replicas: stringsSchema,
  deletionState: z.enum(['active', 'pending', 'deleted', 'failed']),
  deletedAt: timeSchema.nullable(),
});
export const resourceIdentitySchema = z.strictObject({
  host: idSchema,
  database: idSchema,
  role: idSchema,
  namespace: idSchema,
  fingerprint: idSchema,
  productionAccess: z.literal(false),
});
export const testResourceLeaseSchema = z.strictObject({
  runId: idSchema,
  identity: resourceIdentitySchema,
  credentialRef: idSchema,
  subjectAlias: idSchema,
  createdResourceIds: stringsSchema,
  expiresAt: timeSchema,
  cleanupMethod: idSchema,
  cleanupState: z.enum(['pending', 'clean', 'failed']),
  reconciliationEvidence: z.array(contentRefSchema),
});
export const clientEvidenceSessionSchema = z.strictObject({
  sessionId: idSchema,
  runId: idSchema,
  itemId: idSchema,
  challenge: idSchema,
  candidateHash: hashSchema,
  client: z.enum([
    'Codex',
    'Claude Desktop',
    'Visual Studio Code',
    'MCP Inspector',
  ]),
  clientVersion: idSchema,
  model: identityValueSchema,
  protocol: idSchema,
  caseIds: stringsSchema.min(1),
  operator: idSchema,
  deadline: timeSchema,
  budgetReservation: idSchema,
  serverTraceIds: stringsSchema,
  redactedTranscriptRef: contentRefSchema.nullable(),
  evidenceHashes: z.array(hashSchema),
  state: z.enum(['pending', 'attached', 'verified', 'rejected', 'expired']),
});
