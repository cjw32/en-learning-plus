import { readFileSync } from 'node:fs';
import { z } from '@en/common/coach/zod';
import { findCoachSensitiveMatches } from '../../src/coach/observability/coach-redaction';

const toolName = z.enum([
  'get_learner_profile',
  'get_due_words',
  'search_learning_materials',
  'create_exercise',
  'grade_answer',
  'save_attempt',
]);
const intent = z.enum([
  'ANSWER',
  'CORRECTION',
  'CREATE_EXERCISE',
  'GRADE_ANSWER',
  'REVIEW_RECOMMENDATION',
]);
const category = z.enum([
  'correction',
  'cefr_fit',
  'exercise_targeting',
  'tool_selection',
  'tool_parameters',
  'grading',
  'next_action',
  'schema',
  'citation',
  'security',
  'failure',
  'performance',
]);

export const evalCaseSchema = z
  .object({
    id: z.string().regex(/^eval_[a-z0-9_]+$/),
    caseVersion: z.literal('coach-eval-case.v1'),
    datasetVersion: z.literal('coach-eval-dataset.v1'),
    source: z.enum(['synthetic', 'hand_authored']),
    category,
    pairGroup: z.string().nullable(),
    profile: z
      .object({
        subjectAlias: z.string().regex(/^synthetic_[a-z0-9_]+$/),
        cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable(),
        weakItems: z.array(z.string()).max(10),
        errorTypes: z.array(z.string()).max(10),
        dueCount: z.number().int().min(0).max(100),
      })
      .strict(),
    request: z
      .object({
        type: z.enum(['MESSAGE', 'EXERCISE_SUBMISSION', 'RECOMMENDATION']),
        message: z.string().max(1000).nullable(),
        exerciseType: z
          .enum([
            'MULTIPLE_CHOICE',
            'FILL_BLANK',
            'TRANSLATION',
            'SITUATIONAL_DIALOGUE',
          ])
          .nullable(),
        fault: z.string().max(100).nullable(),
      })
      .strict(),
    session: z
      .object({ state: z.enum(['ACTIVE', 'RETRY', 'SUBMITTED']) })
      .strict(),
    accessibleSourceIds: z.array(z.string()).max(20),
    expected: z
      .object({
        intent,
        allowedTools: z.array(toolName),
        forbiddenTools: z.array(toolName),
        toolOrder: z.array(toolName),
        schemaVersion: z.literal('coach.result.v1'),
        safety: z.enum(['ALLOW', 'REFUSE_SAFE', 'DEGRADE_SAFE']),
        citationSourceIds: z.array(z.string()),
        gradeBeforeSave: z.boolean(),
        idempotent: z.boolean(),
      })
      .strict(),
    qualityRubrics: z.array(z.string()).min(1),
    measurementFields: z.array(
      z.enum([
        'ttftMs',
        'totalDurationMs',
        'inputTokens',
        'outputTokens',
        'estimatedCostMicros',
      ]),
    ),
  })
  .strict();

export type CoachEvalCase = z.infer<typeof evalCaseSchema>;

export function loadEvalCases(path: string): CoachEvalCase[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return evalCaseSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `Invalid eval case at line ${index + 1}: ${String(error)}`,
        );
      }
    });
}

export function validateDeterministicEvalSuite(input: {
  cases: readonly CoachEvalCase[];
  toolPaths: unknown;
  securityGates: unknown;
}) {
  const failures: string[] = [];
  const toolPaths = z
    .record(
      intent,
      z
        .object({
          allowedTools: z.array(toolName),
          forbiddenTools: z.array(toolName),
          toolOrder: z.array(toolName),
        })
        .strict(),
    )
    .safeParse(input.toolPaths);
  const security = z
    .object({
      version: z.string().min(1),
      zeroFailureGates: z.array(z.string()).min(1),
      forbiddenOutputPatterns: z.array(z.string()).min(1),
      requireOwnedResources: z.literal(true),
      requireGradeBeforeSave: z.literal(true),
      requireIdempotentWrite: z.literal(true),
    })
    .strict()
    .safeParse(input.securityGates);
  if (!toolPaths.success) failures.push('tool paths are incomplete or invalid');
  if (!security.success)
    failures.push('security gates are incomplete or invalid');

  const ids = new Set<string>();
  for (const item of input.cases) {
    if (ids.has(item.id)) failures.push(`${item.id}: duplicate id`);
    ids.add(item.id);
    const unsafe = findCoachSensitiveMatches(JSON.stringify(item));
    if (unsafe.length)
      failures.push(`${item.id}: sensitive data ${unsafe.join(',')}`);
    if (
      item.expected.intent === 'GRADE_ANSWER' &&
      !item.expected.gradeBeforeSave
    ) {
      failures.push(`${item.id}: grading must require grade-before-save`);
    }
    if (!item.expected.idempotent)
      failures.push(`${item.id}: idempotency missing`);
    if (
      item.expected.citationSourceIds.some(
        (sourceId) => !item.accessibleSourceIds.includes(sourceId),
      )
    ) {
      failures.push(`${item.id}: unsupported citation`);
    }
    if (toolPaths.success) {
      const expectedPath = toolPaths.data[item.expected.intent];
      if (
        JSON.stringify(item.expected.allowedTools) !==
          JSON.stringify(expectedPath.allowedTools) ||
        JSON.stringify(item.expected.forbiddenTools) !==
          JSON.stringify(expectedPath.forbiddenTools) ||
        JSON.stringify(item.expected.toolOrder) !==
          JSON.stringify(expectedPath.toolOrder)
      ) {
        failures.push(`${item.id}: tool path mismatch`);
      }
    }
  }

  const pairCounts = new Map<string, number>();
  for (const item of input.cases) {
    if (item.pairGroup) {
      pairCounts.set(item.pairGroup, (pairCounts.get(item.pairGroup) ?? 0) + 1);
    }
  }
  return Object.freeze({
    failures,
    intents: [...new Set(input.cases.map((item) => item.expected.intent))],
    levels: [
      ...new Set(input.cases.map((item) => item.profile.cefr ?? 'MISSING')),
    ],
    exerciseTypes: [
      ...new Set(
        input.cases
          .map((item) => item.request.exerciseType)
          .filter(
            (value): value is NonNullable<typeof value> => value !== null,
          ),
      ),
    ],
    categories: [...new Set(input.cases.map((item) => item.category))],
    personalizationPairCount: [...pairCounts.values()].filter(
      (count) => count >= 2,
    ).length,
  });
}
