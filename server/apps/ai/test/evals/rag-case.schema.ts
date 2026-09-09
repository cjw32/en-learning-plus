import { readFileSync } from 'node:fs';
import { z } from '@en/common/coach/zod';

const version = z.string().trim().min(1).max(256);
const ids = z.array(z.string().trim().min(1).max(300)).max(100);

export const ragEvalJudgementSchema = z
  .object({
    mode: z.enum(['automatic', 'fixed_rubric', 'manual_review']),
    rubricVersion: version.nullable(),
    disputed: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode !== 'automatic' && value.rubricVersion === null) {
      context.addIssue({
        code: 'custom',
        path: ['rubricVersion'],
        message: 'reviewed judgements require a fixed rubric version',
      });
    }
  });

export const ragExpectedResultSchema = z
  .object({
    retrievalStatus: z.enum([
      'success',
      'insufficient',
      'failed',
      'not_applicable',
    ]),
    relevantChunkIds: ids,
    citationIds: ids,
    forbiddenCitationIds: ids,
    securityFailureCodes: ids,
    judgement: ragEvalJudgementSchema,
  })
  .strict();

export const ragEvalCaseSchema = z
  .object({
    id: z.string().regex(/^rag_[a-z0-9_-]+$/),
    caseVersion: z.literal('rag-eval-case.v1'),
    datasetVersion: version,
    category: z.enum([
      'word_meaning',
      'word_form',
      'example_collocation',
      'grammar',
      'course',
      'level_filter',
      'private_wrong_answer',
      'private_summary',
      'empty_recall',
      'low_relevance',
      'similar_wrong_fact',
      'source_conflict',
      'prompt_injection',
      'cross_user',
      'fabricated_citation',
      'content_update',
      'source_delete',
      'reembedding',
      'latency',
      'token_cost',
    ]),
    input: z
      .object({
        query: z.string().min(1).max(1000),
        learnerLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable(),
        subjectAlias: z.string().regex(/^synthetic_[a-z0-9_-]+$/),
      })
      .strict(),
    filters: z
      .object({
        categories: ids,
        courseIds: ids,
        wordIds: ids,
        accessScopes: z
          .array(z.enum(['PUBLIC', 'OWNED_COURSE', 'PRIVATE_OWNER']))
          .min(1)
          .max(3),
      })
      .strict(),
    access: z
      .object({
        allowedSourceIds: ids,
        forbiddenSourceIds: ids,
      })
      .strict(),
    expected: ragExpectedResultSchema,
    versions: z
      .object({
        sourceRightsSnapshot: version,
        content: version,
        prompt: version,
        embedding: version,
        chunking: version,
        index: version,
        retrieval: version,
        schema: version,
        price: version,
      })
      .strict(),
  })
  .strict();

/** Compatibility validation for the story-specific fixtures created before v1. */
export const existingRagFixtureCaseSchema = z
  .record(z.string(), z.unknown())
  .superRefine((input, context) => {
    const expected =
      input.expected && typeof input.expected === 'object'
        ? (input.expected as Record<string, unknown>)
        : {};
    const measurement =
      input.measurement && typeof input.measurement === 'object'
        ? (input.measurement as Record<string, unknown>)
        : {};
    const hasCaseVersion =
      typeof input.caseVersion === 'string' ||
      typeof input.schemaVersion === 'string';
    const versions =
      input.versions && typeof input.versions === 'object'
        ? Object.values(input.versions as Record<string, unknown>)
        : [];
    const hasAllowed =
      Array.isArray(expected.allowedSourceIds) ||
      Array.isArray(input.issuedCitationIds) ||
      Array.isArray(input.allowedSourceIds);
    const hasForbidden =
      Array.isArray(expected.forbiddenSourceIds) ||
      Array.isArray(input.proposedCitationIds) ||
      Array.isArray(input.forbiddenSourceIds);
    const hasJudgement =
      Array.isArray(input.measurementFields) ||
      typeof expected.status === 'string' ||
      typeof measurement.qualityCheck === 'string';
    for (const [valid, path, message] of [
      [hasCaseVersion, ['caseVersion'], 'case/schema version is required'],
      [
        versions.length > 0 &&
          versions.every((item) => typeof item === 'string' && item.length > 0),
        ['versions'],
        'component versions are required',
      ],
      [hasAllowed, ['allowedSourceIds'], 'allowed sources are required'],
      [hasForbidden, ['forbiddenSourceIds'], 'forbidden sources are required'],
      [hasJudgement, ['judgement'], 'judgement method is required'],
    ] as const) {
      if (!valid)
        context.addIssue({ code: 'custom', path: [...path], message });
    }
  });

export type RagEvalCase = z.infer<typeof ragEvalCaseSchema>;

export function loadRagEvalCases(path: string): RagEvalCase[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return ragEvalCaseSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `Invalid RAG eval case at line ${index + 1}: ${String(error)}`,
        );
      }
    });
}
