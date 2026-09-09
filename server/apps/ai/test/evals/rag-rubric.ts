import { readFileSync } from 'node:fs';
import { z } from '@en/common/coach/zod';

const criterion = z
  .object({
    id: z.enum(['relevance', 'citation_support', 'faithfulness', 'conflict_handling']),
    scale: z.tuple([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    anchors: z
      .object({
        '0': z.string().min(1),
        '1': z.string().min(1),
        '2': z.string().min(1),
        '3': z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const ragQualityRubricSchema = z
  .object({
    rubricVersion: z.literal('rag-quality.v1'),
    status: z.literal('fixed_before_run'),
    scorer: z.literal('human_or_independent_model'),
    criteria: z.array(criterion).length(4),
    passState: z
      .object({
        minimumPerCriterion: z.literal(2),
        fabricatedCitationCount: z.literal(0),
        unsupportedRequiredClaimCount: z.literal(0),
      })
      .strict(),
    reviewerPrivacy: z
      .object({
        identityFieldsVisible: z.literal(false),
        privateContentAllowed: z.literal(false),
        permittedFields: z.array(z.string()).min(1),
      })
      .strict(),
    disputeReview: z
      .object({
        preserveOriginalScores: z.literal(true),
        resolver: z.literal('independent_reviewer'),
        requiredEvidence: z.array(z.string()).min(1),
        excludeUntilResolved: z.literal(true),
      })
      .strict(),
  })
  .strict();

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function loadFixedRagRubric(path: string) {
  return deepFreeze(
    ragQualityRubricSchema.parse(JSON.parse(readFileSync(path, 'utf8'))),
  );
}
