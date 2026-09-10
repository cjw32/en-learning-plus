import { readFileSync } from 'node:fs';
import { z } from '@en/common/coach/zod';

const version = z.string().trim().min(1).max(128);
const word = z.string().trim().min(1).max(100);
const status = z.enum([
  'correct',
  'mispronounced',
  'omitted',
  'inserted',
  'uncertain',
]);

export const pronunciationEvalCaseSchema = z
  .object({
    schemaVersion: z.literal('pronunciation-eval-case.v1'),
    caseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
    datasetVersion: version,
    provenance: z
      .object({
        origin: z.enum(['SYNTHETIC', 'AUTHORIZED_HUMAN']),
        authorizationId: version,
        permittedUses: z.array(z.enum(['PRONUNCIATION_EVALUATION'])).length(1),
        deletion: z
          .object({
            revocable: z.boolean(),
            deleteBy: z.iso.datetime({ offset: true }).nullable(),
          })
          .strict(),
      })
      .strict(),
    audio: z
      .object({
        kind: z.enum(['SYNTHETIC_PCM', 'AUTHORIZED_HUMAN_AUDIO']),
        fixtureId: version,
        durationMs: z.number().int().min(500).max(30_000),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    annotation: z
      .object({
        version,
        referenceWords: z.array(word).min(1).max(30),
        hypothesisWords: z.array(word).max(90),
        goldStatuses: z.array(status).max(90),
        predictedStatuses: z.array(status).max(90),
        timestamps: z
          .array(
            z
              .object({
                goldMs: z.number().int().min(0).max(30_000),
                predictedMs: z.number().int().min(0).max(30_000),
              })
              .strict(),
          )
          .max(90),
        humanOverallScore: z.number().min(0).max(100).nullable(),
        predictedOverallScore: z.number().min(0).max(100).nullable(),
        shouldReject: z.boolean(),
        predictedReject: z.boolean(),
        accentGroup: version.nullable(),
        matchedHumanScore: z.number().min(0).max(100).nullable(),
      })
      .strict(),
    versions: z
      .object({
        provider: version,
        model: version,
        rule: version,
        resultSchema: version,
        normalization: version,
        budget: version,
        price: version,
      })
      .strict(),
    runtime: z
      .object({
        providerSuccess: z.boolean(),
        latencyMs: z.number().int().min(0).max(30_000),
        costMicros: z.number().int().min(0),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.provenance.origin === 'AUTHORIZED_HUMAN') !==
      (value.audio.kind === 'AUTHORIZED_HUMAN_AUDIO')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['audio', 'kind'],
        message: 'audio kind must exactly match its authorized provenance',
      });
    }
    if (
      (value.annotation.accentGroup === null) !==
      (value.annotation.matchedHumanScore === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['annotation', 'accentGroup'],
        message: 'accent residual labels must be complete or absent',
      });
    }
  });

export type PronunciationEvalCase = z.infer<typeof pronunciationEvalCaseSchema>;

export function loadPronunciationEvalCases(
  manifestPath: string,
): readonly PronunciationEvalCase[] {
  const lines = readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return Object.freeze(
    lines.map((line, index) => {
      let decoded: unknown;
      try {
        decoded = JSON.parse(line);
      } catch {
        throw new Error(`Invalid evaluation JSONL at line ${index + 1}`);
      }
      const item = pronunciationEvalCaseSchema.parse(decoded);
      if (seen.has(item.caseId)) {
        throw new Error(`Duplicate evaluation case: ${item.caseId}`);
      }
      seen.add(item.caseId);
      return Object.freeze(item);
    }),
  );
}
