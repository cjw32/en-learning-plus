import { z } from '@en/common/coach/zod';

export const idSchema = z.string().min(1).max(256);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const timeSchema = z.iso.datetime();
export const stringsSchema = z
  .array(idSchema)
  .refine((v) => new Set(v).size === v.length, 'duplicate values');
export const moduleSchema = z.enum(['coach', 'rag', 'pronunciation', 'mcp']);
export const modeSchema = z.enum(['deterministic', 'mock', 'replay', 'live']);
export const riskSchema = z.enum(['low', 'medium', 'high', 'critical']);
export const purposeSchema = z.enum(['check', 'qualification', 'measurement']);
export const relativePathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      !value
        .split('/')
        .some((part) => !part || part === '.' || part === '..') &&
      !/^[a-z]+:/i.test(value),
    'must be a contained relative path',
  );
export const contentRefSchema = z.strictObject({
  path: relativePathSchema,
  hash: hashSchema,
});
export const requirementsSchema = z
  .array(z.strictObject({ spec: idSchema, ids: stringsSchema.min(1) }))
  .min(1);
export const evaluatorRefSchema = z.strictObject({
  evaluatorId: idSchema,
  version: idSchema,
  type: z.enum(['rule', 'human', 'model']),
  rubricRef: contentRefSchema.nullable(),
  required: z.boolean(),
  calibrationRef: contentRefSchema.nullable(),
});
export const provenanceSchema = z
  .strictObject({
    kind: z.enum(['synthetic', 'hand_authored', 'authorized']),
    source: idSchema,
    useBasis: idSchema,
    authorizationRef: contentRefSchema.nullable(),
    allowedPurposes: z.array(purposeSchema).min(1),
    expiresAt: timeSchema.nullable(),
    revocationRule: idSchema,
    deletionRule: idSchema,
  })
  .refine(
    (v) => v.kind !== 'authorized' || v.authorizationRef !== null,
    'authorization required',
  );
export const sideEffectExpectationSchema = z.strictObject({
  resource: idSchema,
  operation: idSchema,
  expectedDelta: z.number().int(),
  subjectAlias: idSchema,
});
export const groupsSchema = z.record(
  idSchema,
  z
    .strictObject({
      value: idSchema.nullable(),
      unavailableReason: idSchema.nullable(),
    })
    .refine((v) => v.value !== null || v.unavailableReason !== null),
);
export const exposureSchema = z.strictObject({
  groupId: idSchema,
  nearDuplicateIds: stringsSchema,
  events: z.array(
    z.strictObject({
      kind: z.enum(['viewed', 'tuned', 'reviewed', 'revoked']),
      at: timeSchema,
      taskRef: idSchema,
    }),
  ),
});
export const capabilitySchema = z.strictObject({
  capability: idSchema,
  required: z.boolean(),
  allowedNotApplicable: z.boolean(),
  sourceRequirement: idSchema,
});
export const evaluationCaseSchema = z
  .strictObject({
    caseId: idSchema,
    caseVersion: idSchema,
    module: moduleSchema,
    legacyRef: z
      .strictObject({
        path: relativePathSchema,
        id: idSchema,
        schema: idSchema,
        hash: hashSchema,
      })
      .nullable(),
    tags: stringsSchema,
    risk: riskSchema,
    requirements: requirementsSchema,
    inputRef: contentRefSchema,
    contextRef: contentRefSchema.nullable(),
    expectedRef: contentRefSchema,
    expectedSideEffects: z.array(sideEffectExpectationSchema),
    evaluators: z.array(evaluatorRefSchema).min(1),
    provenance: provenanceSchema,
    split: z.enum(['development', 'validation']),
    exposure: exposureSchema,
    groups: groupsSchema,
    capabilityRequirements: z.array(capabilitySchema),
    datasetVersion: idSchema,
  })
  .refine(
    (v) =>
      v.split !== 'validation' ||
      !v.exposure.events.some((e) => e.kind === 'tuned'),
    'exposed validation data',
  );
export const datasetManifestSchema = z.strictObject({
  schemaVersion: z.literal('ai-eval-dataset.v1'),
  datasetId: idSchema,
  version: idSchema,
  catalogHash: hashSchema,
  caseRefs: z.array(contentRefSchema).min(1),
  splitPolicyVersion: idSchema,
  exposureRegistryHash: hashSchema,
  expectedCoverage: stringsSchema.min(1),
  governanceRef: contentRefSchema,
  frozenAt: timeSchema,
});
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
