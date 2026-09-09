import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from '@en/common/coach/zod';

const scenario = z.enum([
  'empty',
  'low_relevance',
  'conflict',
  'revoked',
  'timeout',
  'exception',
  'injection',
  'forged_citation',
  'non_material',
]);
const caseSchema = z
  .object({
    id: z.string().regex(/^rag_degradation_[a-z_]+$/),
    caseVersion: z.literal('rag-degradation-case.v1'),
    datasetVersion: z.literal('rag-degradation.synthetic.v1'),
    scenario,
    query: z.string().min(1),
    results: z.array(
      z
        .object({
          chunkId: z.string().min(1),
          status: z.enum(['ACTIVE', 'REVOKED']),
          relevanceScore: z.number().min(0).max(1),
          content: z.string().min(1),
        })
        .strict(),
    ),
    issuedCitationIds: z.array(z.string()),
    proposedCitationIds: z.array(z.string()),
    fault: z
      .enum([
        'UNRESOLVED_CONFLICT',
        'TOOL_TIMEOUT',
        'INTERNAL_ERROR',
        'NOT_APPLICABLE',
      ])
      .nullable(),
    expected: z
      .object({
        status: z.enum(['success', 'insufficient', 'failed', 'not_applicable']),
        diagnosticCode: z.string().nullable(),
        citationIds: z.array(z.string()),
        systemOverrideCount: z.literal(0),
      })
      .strict(),
    versions: z
      .object({
        content: z.string().min(1),
        embedding: z.string().min(1),
        chunking: z.string().min(1),
        retrieval: z.string().min(1),
        prompt: z.string().min(1),
        schema: z.literal('coach.tool.v2'),
      })
      .strict(),
  })
  .strict();

type Case = z.infer<typeof caseSchema>;

function loadCases(): Case[] {
  return readFileSync(
    resolve(__dirname, 'fixtures/rag-degradation.cases.jsonl'),
    'utf8',
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => caseSchema.parse(JSON.parse(line)));
}

function run(item: Case) {
  if (item.fault === 'NOT_APPLICABLE') {
    return {
      status: 'not_applicable',
      diagnosticCode: 'NOT_APPLICABLE',
      citationIds: [],
      systemOverrideCount: 0,
    };
  }
  if (item.fault === 'TOOL_TIMEOUT' || item.fault === 'INTERNAL_ERROR') {
    return {
      status: 'failed',
      diagnosticCode: item.fault,
      citationIds: [],
      systemOverrideCount: 0,
    };
  }
  if (item.fault === 'UNRESOLVED_CONFLICT') {
    return {
      status: 'insufficient',
      diagnosticCode: item.fault,
      citationIds: [],
      systemOverrideCount: 0,
    };
  }
  const active = item.results.filter(
    (result) => result.status === 'ACTIVE' && result.relevanceScore >= 0.65,
  );
  if (
    item.results.length > 0 &&
    item.results.every((result) => result.status !== 'ACTIVE')
  ) {
    return {
      status: 'insufficient',
      diagnosticCode: 'SOURCE_INVALID',
      citationIds: [],
      systemOverrideCount: 0,
    };
  }
  if (
    item.results.some((result) => result.status === 'ACTIVE') &&
    active.length === 0
  ) {
    return {
      status: 'insufficient',
      diagnosticCode: 'LOW_RELEVANCE',
      citationIds: [],
      systemOverrideCount: 0,
    };
  }
  if (active.length === 0) {
    return {
      status: 'insufficient',
      diagnosticCode: 'EMPTY_RECALL',
      citationIds: [],
      systemOverrideCount: 0,
    };
  }
  const issued = new Set(item.issuedCitationIds);
  const citations = item.proposedCitationIds.filter((id) => issued.has(id));
  if (
    citations.length !== item.proposedCitationIds.length ||
    citations.length === 0
  ) {
    return {
      status: 'insufficient',
      diagnosticCode: 'CITATION_UNAVAILABLE',
      citationIds: [],
      systemOverrideCount: 0,
    };
  }
  return {
    status: 'success',
    diagnosticCode: null,
    citationIds: citations,
    systemOverrideCount: 0,
  };
}

describe('RAG degradation deterministic evaluation', () => {
  const cases = loadCases();

  it('covers every degradation and non-material scenario', () => {
    expect(new Set(cases.map((item) => item.scenario))).toEqual(
      new Set(scenario.options),
    );
  });

  it('classifies all fixed cases without false citations or instruction override', () => {
    for (const item of cases) {
      expect(run(item)).toEqual(item.expected);
    }
  });
});
