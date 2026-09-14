import { z } from '@en/common/coach/zod';
import {
  idSchema,
  hashSchema,
  stringsSchema,
  contentRefSchema,
  moduleSchema,
  modeSchema,
  requirementsSchema,
  groupsSchema,
} from './case.schema';
import {
  runSchema,
  trustedControlSchema,
  scopeManifestSchema,
  versionSnapshotSchema,
  comparisonRecordSchema,
  itemResultSchema,
} from './run.schema';
import { artifactDescriptorSchema, usageSchema } from './evidence.schema';

const n = z.number().int().nonnegative().safe();
export const gateStatusSchema = z.enum([
  'PASS',
  'FAIL',
  'INCOMPLETE',
  'REVIEW',
]);
export const gateDecisionSchema = z
  .strictObject({
    status: gateStatusSchema,
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    scopeClaim: idSchema,
    reasons: stringsSchema,
    blockingItems: stringsSchema,
    missingRequirements: stringsSchema,
    reviewItems: stringsSchema,
    policyHash: hashSchema,
    comparisonRef: contentRefSchema.nullable(),
    executionCompleteness: z.enum(['complete', 'incomplete']),
  })
  .refine(
    (v) =>
      ({ PASS: 0, FAIL: 1, INCOMPLETE: 2, REVIEW: 3 })[v.status] === v.exitCode,
  );
export const countsSchema = z
  .strictObject({
    planned: n,
    completed: n,
    passed: n,
    failed: n,
    review: n,
    skipped: n,
    error: n,
    notRun: n,
    uniqueCases: n,
    attempts: n,
    repetitions: n,
  })
  .refine(
    (v) =>
      v.planned ===
        v.passed + v.failed + v.review + v.skipped + v.error + v.notRun &&
      v.completed === v.passed + v.failed + v.review,
  );
export const metricSchema = z
  .strictObject({
    metricId: idSchema,
    version: idSchema,
    module: moduleSchema,
    group: groupsSchema,
    side: z.enum(['candidate', 'baseline']),
    mode: modeSchema,
    unit: idSchema,
    direction: z.enum(['higher', 'lower', 'target']),
    value: z.number().finite().nullable(),
    unavailableReason: idSchema.nullable(),
    numerator: z.number().finite().nullable(),
    denominator: n,
    effectiveN: n,
    independentN: n,
    excludedCountsByReason: z.record(idSchema, n),
    calculationBasis: idSchema,
    repetitionSummary: z
      .strictObject({
        values: z.array(z.number().finite()),
        mean: z.number().finite().nullable(),
        median: z.number().finite().nullable(),
        minimum: z.number().finite().nullable(),
        maximum: z.number().finite().nullable(),
        standardDeviation: z.number().finite().nonnegative().nullable(),
      })
      .nullable(),
    uncertainty: z
      .strictObject({
        methodVersion: idSchema,
        seed: n,
        iterations: n.positive(),
        confidenceLevel: z.number().gt(0).lt(1),
        lower: z.number().finite(),
        upper: z.number().finite(),
        minimumN: n,
        criterionSource: idSchema,
      })
      .nullable(),
    thresholdRef: contentRefSchema.nullable(),
    comparisonDelta: z.number().finite().nullable(),
  })
  .refine(
    (v) =>
      (v.value !== null || v.unavailableReason !== null) &&
      (v.denominator > 0 || v.value === null) &&
      v.independentN <= v.effectiveN,
  );
export const gatePolicySchema = z.strictObject({
  id: idSchema,
  version: idSchema,
  hash: hashSchema,
  requiredScenarios: stringsSchema,
  requiredModes: z.array(modeSchema),
  requiredGroups: stringsSchema,
  zeroToleranceCodes: stringsSchema,
  metrics: z.array(
    z.strictObject({
      metricId: idSchema,
      bound: z.number().finite().nullable(),
      direction: z.enum(['higher', 'lower']),
      minimumN: n.nullable(),
      status: z.enum(['pending_measurement', 'approved']),
      sourceSpecCriteria: requirementsSchema,
      approvalRef: contentRefSchema.nullable(),
    }),
  ),
  approvalRef: contentRefSchema.nullable(),
});
export const reportSchema = z.strictObject({
  schemaVersion: z.literal('ai-evaluation-report.v1'),
  run: runSchema,
  control: trustedControlSchema,
  scope: scopeManifestSchema,
  versions: z.strictObject({
    candidate: versionSnapshotSchema,
    baseline: versionSnapshotSchema.nullable(),
  }),
  comparison: comparisonRecordSchema.nullable(),
  comparisonUnavailableReason: idSchema.nullable(),
  counts: countsSchema,
  cases: z.array(itemResultSchema),
  metrics: z.array(metricSchema),
  usage: z.strictObject({
    calls: z.array(
      z.strictObject({
        callId: idSchema,
        stage: idSchema,
        provider: idSchema,
        side: z.enum(['candidate', 'baseline']),
        usage: usageSchema,
      }),
    ),
    budgetMicros: n,
    reservedMicros: n,
    settledMicros: n,
  }),
  gate: gateDecisionSchema,
  artifacts: z.array(artifactDescriptorSchema),
  reproduction: z.strictObject({
    arguments: z.array(idSchema),
    prerequisites: stringsSchema,
    limitations: stringsSchema,
    configHash: hashSchema,
  }),
});
export type GateStatus = z.infer<typeof gateStatusSchema>;
export type GateDecision = z.infer<typeof gateDecisionSchema>;
