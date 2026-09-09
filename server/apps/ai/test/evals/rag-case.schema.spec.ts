import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  existingRagFixtureCaseSchema,
  ragEvalCaseSchema,
} from './rag-case.schema';

const fixtureNames = [
  'rag-personalization.cases.jsonl',
  'rag-degradation.cases.jsonl',
  'rag-lifecycle.cases.jsonl',
] as const;

describe('versioned RAG evaluation case schema', () => {
  it.each(fixtureNames)('accepts every existing %s case', (name) => {
    const cases = readFileSync(resolve(__dirname, 'fixtures', name), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) {
      expect(existingRagFixtureCaseSchema.safeParse(item).success).toBe(true);
    }
  });

  it.each([
    ['version', { versions: undefined }],
    ['allowed sources', { access: { forbiddenSourceIds: [] } }],
    ['forbidden sources', { access: { allowedSourceIds: [] } }],
    ['judgement method', { expected: { judgement: undefined } }],
  ])('rejects a main case missing %s', (_name, override) => {
    const valid = {
      id: 'rag_schema_contract',
      caseVersion: 'rag-eval-case.v1',
      datasetVersion: 'rag-eval.synthetic.v1',
      category: 'word_meaning',
      input: {
        query: 'Define a synthetic word.',
        learnerLevel: 'B1',
        subjectAlias: 'synthetic_schema',
      },
      filters: {
        categories: ['WORD_MEANING'],
        courseIds: [],
        wordIds: ['word_synthetic'],
        accessScopes: ['PUBLIC'],
      },
      access: { allowedSourceIds: ['source_allowed'], forbiddenSourceIds: [] },
      expected: {
        retrievalStatus: 'success',
        relevantChunkIds: ['chunk_allowed'],
        citationIds: ['cit_allowed'],
        forbiddenCitationIds: [],
        securityFailureCodes: [],
        judgement: { mode: 'automatic', rubricVersion: null, disputed: false },
      },
      versions: {
        sourceRightsSnapshot: 'rights.synthetic.v1',
        content: 'content.synthetic.v1',
        prompt: 'coach.rag.v1',
        embedding: 'embedding.fake.8d.v1',
        chunking: 'chunking.v1',
        index: 'exact-cosine.v1',
        retrieval: 'retrieval.exact.v1',
        schema: 'coach.result.v2',
        price: 'rag-price.pending.v1',
      },
    } as Record<string, unknown>;
    const candidate = {
      ...valid,
      ...override,
      access: 'access' in override ? override.access : valid.access,
      expected:
        'expected' in override
          ? { ...(valid.expected as object), ...(override.expected as object) }
          : valid.expected,
    };
    expect(ragEvalCaseSchema.safeParse(candidate).success).toBe(false);
  });
});
