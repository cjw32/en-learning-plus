import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ragEvalCaseSchema } from './rag-case.schema';

const requiredCategories = [
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
] as const;

describe('main RAG evaluation dataset', () => {
  const cases = readFileSync(
    resolve(__dirname, 'fixtures/rag-cases.jsonl'),
    'utf8',
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ragEvalCaseSchema.parse(JSON.parse(line)));

  it('covers every FR-077 category exactly once with fixed versions', () => {
    expect(cases).toHaveLength(requiredCategories.length);
    expect(new Set(cases.map((item) => item.category))).toEqual(
      new Set(requiredCategories),
    );
    expect(new Set(cases.map((item) => item.datasetVersion))).toEqual(
      new Set(['rag-eval.synthetic.v1']),
    );
    for (const item of cases) {
      expect(Object.keys(item.versions).sort()).toEqual([
        'chunking',
        'content',
        'embedding',
        'index',
        'price',
        'prompt',
        'retrieval',
        'schema',
        'sourceRightsSnapshot',
      ]);
      expect(item.access).toHaveProperty('allowedSourceIds');
      expect(item.access).toHaveProperty('forbiddenSourceIds');
    }
  });
});
