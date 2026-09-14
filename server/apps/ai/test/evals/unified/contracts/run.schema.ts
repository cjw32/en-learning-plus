import { z } from '@en/common/coach/zod';
import {
  idSchema,
  hashSchema,
  stringsSchema,
  timeSchema,
  moduleSchema,
  modeSchema,
  riskSchema,
  purposeSchema,
  contentRefSchema,
  requirementsSchema,
} from './case.schema';
import { stepObservationSchema, identityValueSchema } from './evidence.schema';

const nonnegative = z.number().int().nonnegative().safe();
export const limitsSchema = z.strictObject({
  concurrency: nonnegative.positive(),
  caseTimeoutMs: nonnegative.positive().max(2147483647),
  runTimeoutMs: nonnegative.positive().max(2147483647),
  repeatCount: nonnegative.positive(),
  retryLimit: nonnegative,
  stopGraceMs: nonnegative.max(2147483647),
  budgetMicros: nonnegative,
  currency: z.string().regex(/^[A-Z]{3}$/),
  maxTokens: nonnegative,
});
export const intentionalDifferencesSchema = z
  .array(
    z.enum([
      'prompt',
      'model',
      'provider',
      'chunking',
      'embedding',
      'index',
      'retrieval-config',
      'tool-schema',
    ]),
  )
  .refine((v) => new Set(v).size === v.length);
export const runRequestSchema = z
  .strictObject({
    schemaVersion: z.literal('ai-eval-request.v1'),
    purpose: purposeSchema,
    profile: z.enum(['quick', 'full']),
    modules: z
      .array(moduleSchema)
      .min(1)
      .refine((v) => new Set(v).size === v.length),
    modes: z
      .array(modeSchema)
      .min(1)
      .refine((v) => new Set(v).size === v.length),
    filters: z.strictObject({
      caseIds: stringsSchema,
      tags: stringsSchema,
      risks: z.array(riskSchema),
      changedSince: idSchema.nullable(),
    }),
    candidate: idSchema,
    baseline: z
      .strictObject({
        kind: z.enum(['registration', 'checkout']),
        reference: idSchema,
      })
      .nullable(),
    intentionalDifferences: intentionalDifferencesSchema,
    datasetRef: contentRefSchema,
    controlRef: contentRefSchema,
    configRef: contentRefSchema.nullable(),
    outputRoot: idSchema,
    limits: limitsSchema,
    parentRunId: idSchema.nullable(),
  })
  .refine(
    (v) =>
      v.profile !== 'quick' ||
      (!v.modes.includes('live') && v.limits.budgetMicros === 0),
    'quick cannot call live',
  );
export const executionItemSchema = z.strictObject({
  itemId: idSchema,
  caseId: idSchema,
  module: moduleSchema,
  side: z.enum(['candidate', 'baseline']),
  client: idSchema.nullable(),
  required: z.boolean(),
  declaredMode: modeSchema,
  expectedRepeatCount: nonnegative.positive(),
});
export const terminalSchema = z.enum([
  'passed',
  'failed',
  'review',
  'skipped',
  'error',
  'not_run',
]);
export const itemResultSchema = executionItemSchema
  .extend({
    terminalState: terminalSchema,
    reasonCodes: stringsSchema,
    allAttempts: stringsSchema,
    requirements: requirementsSchema,
    expectedRef: contentRefSchema.nullable(),
    actualRef: contentRefSchema.nullable(),
    evidenceRefs: z.array(contentRefSchema),
    steps: z.array(stepObservationSchema),
  })
  .refine(
    (v) => v.terminalState === 'passed' || v.reasonCodes.length > 0,
    'reason required',
  );
export const attemptSchema = z.strictObject({
  attemptId: idSchema,
  itemId: idSchema,
  repeatIndex: nonnegative,
  retryIndex: nonnegative,
  parentAttemptId: idSchema.nullable(),
  stepResults: z.array(stepObservationSchema),
  startedAt: timeSchema,
  endedAt: timeSchema,
  terminalState: terminalSchema,
  reasonCodes: stringsSchema,
  evaluatorRefs: z.array(contentRefSchema),
  evidenceRefs: z.array(contentRefSchema),
});
export const scopeManifestSchema = z.strictObject({
  requested: stringsSchema,
  expanded: stringsSchema,
  selectedItems: z.array(executionItemSchema),
  requiredItems: stringsSchema,
  requiredGroups: stringsSchema,
  requiredModes: z.array(modeSchema),
  excludedCases: z.array(
    z.strictObject({ caseId: idSchema, reason: idSchema }),
  ),
  notApplicable: z.array(
    z.strictObject({
      caseId: idSchema,
      reason: idSchema,
      sourceRequirement: idSchema,
    }),
  ),
  missingRequirements: stringsSchema,
  policyRef: contentRefSchema,
  selectionReason: stringsSchema,
  scopeClaim: idSchema,
});
export const trustedControlSchema = z.strictObject({
  controlCommit: idSchema,
  controlHash: hashSchema,
  adapterHash: hashSchema,
  catalogHash: hashSchema,
  policyHash: hashSchema,
  evaluatorHash: hashSchema,
  impactHash: hashSchema,
  baselineRegistryRef: contentRefSchema,
  approvalRegistryRef: contentRefSchema,
  trust: z.enum(['local', 'maintainer', 'ci']),
  subject: idSchema,
  time: timeSchema,
});
const identities = z.record(idSchema, identityValueSchema);
export const versionSnapshotSchema = z.strictObject({
  code: z.strictObject({
    commit: idSchema,
    branchLabel: idSchema,
    dirty: z.boolean(),
    trackedDiffHash: hashSchema,
    includedUntrackedSourceHash: hashSchema,
    lockfileHash: hashSchema,
    candidateTreeHash: hashSchema,
    inputFiles: stringsSchema,
  }),
  evaluation: z.strictObject({
    controlCommit: idSchema,
    adapterVersion: idSchema,
    datasetHash: hashSchema,
    goldHash: hashSchema,
    splitHash: hashSchema,
    exposureHash: hashSchema,
    evaluatorHash: hashSchema,
    rubricHash: hashSchema,
    calibrationHash: hashSchema.nullable(),
    aggregationVersion: idSchema,
  }),
  runtime: z.strictObject({
    node: idSchema,
    pnpm: idSchema,
    os: idSchema,
    arch: idSchema,
    workerVersion: idSchema,
    limits: limitsSchema,
    seed: nonnegative,
    cache: z.enum(['warm', 'cold', 'disabled']),
    isolationFingerprint: idSchema,
  }),
  ai: identities,
  rag: identities,
  pronunciation: identities,
  mcp: identities,
});
export const baselineRegistrationSchema = z
  .strictObject({
    baselineId: idSchema,
    runId: idSchema,
    reportHash: hashSchema,
    snapshotRef: contentRefSchema,
    datasetHash: hashSchema,
    evaluatorHash: hashSchema,
    approvalRef: contentRefSchema.nullable(),
    approvedBy: idSchema.nullable(),
    approvedAt: timeSchema.nullable(),
    reason: idSchema,
    supersedes: idSchema.nullable(),
    status: z.enum(['pending', 'approved', 'revoked', 'evidence_deleted']),
  })
  .refine(
    (v) =>
      v.status !== 'approved' ||
      Boolean(v.approvalRef && v.approvedBy && v.approvedAt),
  );
export const comparisonRecordSchema = z.strictObject({
  candidateId: idSchema,
  baselineId: idSchema,
  intentionalDifferences: intentionalDifferencesSchema,
  matchedConditions: stringsSchema,
  mismatches: stringsSchema,
  comparability: z.enum(['comparable', 'incomparable', 'review_required']),
  pairedCaseIds: stringsSchema,
  missingPairs: stringsSchema,
});
export const runSchema = z.strictObject({
  id: idSchema,
  parentRunId: idSchema.nullable(),
  createdAt: timeSchema,
  startedAt: timeSchema.nullable(),
  endedAt: timeSchema.nullable(),
  state: z.enum([
    'CREATED',
    'PREFLIGHT',
    'RUNNING',
    'STOPPING',
    'FINALIZING',
    'FINISHED',
  ]),
  purpose: purposeSchema,
  profile: z.enum(['quick', 'full']),
  executionCompleteness: z.enum(['complete', 'incomplete']),
  revisionOf: contentRefSchema.nullable(),
});
export type ExecutionItem = z.infer<typeof executionItemSchema>;
export type ItemResult = z.infer<typeof itemResultSchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;
