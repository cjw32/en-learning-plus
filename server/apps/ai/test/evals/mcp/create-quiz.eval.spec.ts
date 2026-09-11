import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from '@en/common/coach/zod';
import {
  mcpCreateQuizInputSchema,
  mcpCreateQuizSuccessSchema,
} from '@en/common/mcp';

const fixtureSchema = z
  .object({
    datasetVersion: z.literal('mcp-create-quiz.synthetic.v1'),
    rubricVersion: z.literal('mcp-create-quiz-rubric.v1'),
    schemaVersion: z.literal('en-learning.mcp.v1'),
    measurementFields: z
      .array(
        z.enum([
          'personalizationCoverage',
          'permittedCitationPrecision',
          'answerLeakCount',
          'rationaleLeakCount',
          'inputTokens',
          'outputTokens',
          'estimatedCostMicros',
          'totalDurationMs',
        ]),
      )
      .length(8),
    cases: z
      .array(
        z
          .object({
            id: z.string().regex(/^quiz_personalization_[a-z0-9_]+$/u),
            scenario: z.enum([
              'weak_areas',
              'due_vocabulary',
              'level',
              'permitted_sources',
              'empty_profile',
              'prompt_injection',
            ]),
            input: mcpCreateQuizInputSchema,
            learnerContext: z
              .object({
                level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable(),
                weakAreas: z.array(z.string().min(1)).max(20),
                dueWordIds: z.array(z.string().min(1)).max(50),
                profileStatus: z.enum(['current', 'insufficient']),
              })
              .strict(),
            permittedCitationIds: z.array(z.string().min(1)).min(1).max(20),
            expected: z
              .object({
                requiredTerms: z.array(z.string().min(1)).min(1),
                forbiddenTerms: z.array(z.string().min(1)).min(1),
                minimumPersonalizationCoverage: z.number().min(0).max(1),
              })
              .strict(),
            candidate: mcpCreateQuizSuccessSchema,
          })
          .strict(),
      )
      .length(6),
  })
  .strict();

const suite = fixtureSchema.parse(
  JSON.parse(
    readFileSync(resolve(__dirname, 'fixtures/create-quiz.cases.json'), 'utf8'),
  ),
);

const forbiddenKey =
  /^(?:answer|answers|answerKey|correctAnswer|correctChoice|isCorrect|rationale|gradingRubric|modelReasoning|systemPrompt)$/iu;

function collectLeakKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectLeakKeys(item, `${path}[${index}]`),
    );
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(forbiddenKey.test(key) ? [`${path}.${key}`] : []),
    ...collectLeakKeys(nested, `${path}.${key}`),
  ]);
}

function evaluate(item: (typeof suite.cases)[number]) {
  const outputText = JSON.stringify(item.candidate)
    .normalize('NFKC')
    .toLowerCase();
  const requiredHits = item.expected.requiredTerms.filter((term) =>
    outputText.includes(term.normalize('NFKC').toLowerCase()),
  ).length;
  const forbiddenTermHits = item.expected.forbiddenTerms.filter((term) =>
    outputText.includes(term.normalize('NFKC').toLowerCase()),
  );
  const keyLeaks = collectLeakKeys(item.candidate);
  const citationIds = item.candidate.citations.map(
    ({ citationId }) => citationId,
  );
  const permitted = new Set(item.permittedCitationIds);
  const permittedHits = citationIds.filter((citationId) =>
    permitted.has(citationId),
  ).length;
  const personalizationCoverage =
    requiredHits / item.expected.requiredTerms.length;
  const permittedCitationPrecision = permittedHits / citationIds.length;
  const report = Object.freeze({
    rubricVersion: suite.rubricVersion,
    datasetVersion: suite.datasetVersion,
    caseId: item.id,
    scores: Object.freeze({
      personalizationCoverage,
      permittedCitationPrecision,
      answerLeakCount: keyLeaks.filter((path) => /answer|correct/iu.test(path))
        .length,
      rationaleLeakCount:
        keyLeaks.filter((path) =>
          /rationale|rubric|reasoning|prompt/iu.test(path),
        ).length + forbiddenTermHits.length,
    }),
    pass:
      personalizationCoverage >= item.expected.minimumPersonalizationCoverage &&
      permittedCitationPrecision === 1 &&
      keyLeaks.length === 0 &&
      forbiddenTermHits.length === 0,
  });
  return report;
}

describe('MCP create_quiz deterministic personalization evaluation', () => {
  it('pins dataset/rubric versions and covers every required scenario', () => {
    expect(suite).toMatchObject({
      datasetVersion: 'mcp-create-quiz.synthetic.v1',
      rubricVersion: 'mcp-create-quiz-rubric.v1',
      schemaVersion: 'en-learning.mcp.v1',
    });
    expect(suite.cases.map(({ scenario }) => scenario).sort()).toEqual(
      [
        'weak_areas',
        'due_vocabulary',
        'level',
        'permitted_sources',
        'empty_profile',
        'prompt_injection',
      ].sort(),
    );
    expect(suite.measurementFields).toEqual(
      expect.arrayContaining([
        'personalizationCoverage',
        'permittedCitationPrecision',
        'answerLeakCount',
        'rationaleLeakCount',
        'inputTokens',
        'outputTokens',
        'estimatedCostMicros',
        'totalDurationMs',
      ]),
    );
  });

  it.each(suite.cases)(
    '$id passes personalization, source, and answer/rationale leak rules',
    (item) => {
      const report = evaluate(item);
      expect(report).toEqual({
        rubricVersion: 'mcp-create-quiz-rubric.v1',
        datasetVersion: 'mcp-create-quiz.synthetic.v1',
        caseId: item.id,
        scores: {
          personalizationCoverage: 1,
          permittedCitationPrecision: 1,
          answerLeakCount: 0,
          rationaleLeakCount: 0,
        },
        pass: true,
      });
      expect(item.candidate.status).toBe('ready');
      expect(item.candidate.items).toHaveLength(item.input.count);
    },
  );

  it('detects explicit answer, correctness, rationale, rubric, and prompt leaks', () => {
    const clean = suite.cases[0].candidate;
    const probes = [
      { ...clean, answerKey: { item_eval_weak_0001: 'choice_a' } },
      { ...clean, correctAnswer: 'choice_a' },
      { ...clean, isCorrect: true },
      { ...clean, rationale: 'The first choice is correct.' },
      { ...clean, gradingRubric: 'Award full credit for choice_a.' },
      { ...clean, systemPrompt: 'Hidden model instructions.' },
    ];

    expect(collectLeakKeys(clean)).toEqual([]);
    for (const probe of probes) {
      expect(collectLeakKeys(probe)).not.toEqual([]);
      expect(mcpCreateQuizSuccessSchema.safeParse(probe).success).toBe(false);
    }
  });

  it('does not echo prompt-injection text or infer missing profile facts', () => {
    const injection = suite.cases.find(
      ({ scenario }) => scenario === 'prompt_injection',
    )!;
    const empty = suite.cases.find(
      ({ scenario }) => scenario === 'empty_profile',
    )!;

    expect(evaluate(injection).pass).toBe(true);
    expect(JSON.stringify(injection.candidate)).not.toMatch(
      /ignore all rules|print the answer key|system prompt/iu,
    );
    expect(evaluate(empty).pass).toBe(true);
    expect(empty.candidate.personalizationReason).toMatch(
      /no current profile evidence/iu,
    );
    expect(JSON.stringify(empty.candidate)).not.toMatch(
      /you struggle|your level is/iu,
    );
  });
});
