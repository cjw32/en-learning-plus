import {
  COACH_RAG_TOOL_SCHEMA_VERSION,
  searchLearningMaterialsV2InputSchema,
  searchLearningMaterialsV2OutputSchema,
} from '@en/common/coach';
import { createCoachExecutionContext } from '@libs/shared';
import { SearchLearningMaterialsTool } from '../../src/coach/tools/search-learning-materials.tool';

const appliedFilters = {
  levels: ['B1'],
  levelFilterApplied: true,
  categories: ['WORD_MEANING'],
  sources: ['synthetic-word-source'],
  courseIds: [],
  wordIds: ['word_test_harbor'],
  accessScopes: ['PUBLIC'],
  privateOwnerEnforced: true,
  topK: 8,
  minimumRelevance: 0.65,
  sourceRightsSnapshotVersion: 'rights.test.v1',
  contentVersionPolicy: 'content.sha256.v1',
  chunkingVersion: 'chunking.v1',
  embeddingVersion: 'embedding.fake.8d.v1',
  retrievalConfigVersion: 'retrieval.exact.v1',
  indexVersion: 'exact-cosine.v1',
} as const;

const citation = {
  citationId: 'cit_test_harbor_001',
  source: 'synthetic-word-source',
  sourceId: 'word:word_test_harbor',
  title: 'harbor — noun sense 1',
  excerpt: 'Harbor is a sheltered place for boats.',
  category: 'WORD_MEANING',
  wordId: 'word_test_harbor',
  courseId: null,
  accessScope: 'PUBLIC',
  status: 'active',
  usage: 'answer_evidence',
} as const;

describe('search_learning_materials v2 contract', () => {
  it('accepts the bounded public request without an identity field', () => {
    const input = {
      schemaVersion: COACH_RAG_TOOL_SCHEMA_VERSION,
      query: 'What does harbor mean?',
      filters: {
        levels: ['B1'],
        categories: ['WORD_MEANING'],
        sources: [],
        courseIds: [],
        wordIds: ['word_test_harbor'],
      },
      topK: 8,
      minimumRelevance: 0.65,
    };
    expect(searchLearningMaterialsV2InputSchema.parse(input)).toEqual(input);
    expect(
      searchLearningMaterialsV2InputSchema.safeParse({
        ...input,
        userId: 'attacker-controlled',
      }).success,
    ).toBe(false);
    expect(
      searchLearningMaterialsV2InputSchema.safeParse({
        ...input,
        topK: 21,
      }).success,
    ).toBe(false);
  });

  it('accepts ordered, bounded valid results and citations', () => {
    const output = {
      schemaVersion: COACH_RAG_TOOL_SCHEMA_VERSION,
      ok: true,
      query: 'What does harbor mean?',
      appliedFilters,
      results: [
        {
          resultId: 'result_test_001',
          chunkId: 'chunk_test_harbor_001',
          documentId: 'document_test_harbor_001',
          citationId: citation.citationId,
          source: citation.source,
          sourceId: citation.sourceId,
          title: citation.title,
          category: citation.category,
          excerpt: citation.excerpt,
          level: 'B1',
          courseId: null,
          wordId: citation.wordId,
          accessScope: citation.accessScope,
          rank: 1,
          relevanceScore: 0.875,
          contentVersion: 'content.test.v1',
          embeddingVersion: 'embedding.fake.8d.v1',
          status: 'valid',
        },
      ],
      citations: [citation],
      conflicts: [],
      retrievalStatus: 'success',
    };
    expect(searchLearningMaterialsV2OutputSchema.parse(output)).toEqual(output);
  });

  it.each([
    ['score above one', { relevanceScore: 1.01 }],
    ['rank starts at zero', { rank: 0 }],
    ['rank above top K', { rank: 9 }],
    ['invalid state', { status: 'stale' }],
  ])('rejects %s', (_name, resultOverride) => {
    const parsed = searchLearningMaterialsV2OutputSchema.safeParse({
      schemaVersion: COACH_RAG_TOOL_SCHEMA_VERSION,
      ok: true,
      query: 'harbor',
      appliedFilters,
      results: [
        {
          resultId: 'result_test_001',
          chunkId: 'chunk_test_harbor_001',
          documentId: 'document_test_harbor_001',
          citationId: citation.citationId,
          source: citation.source,
          sourceId: citation.sourceId,
          title: citation.title,
          category: citation.category,
          excerpt: citation.excerpt,
          level: 'B1',
          courseId: null,
          wordId: citation.wordId,
          accessScope: citation.accessScope,
          rank: 1,
          relevanceScore: 0.8,
          contentVersion: 'content.test.v1',
          embeddingVersion: 'embedding.fake.8d.v1',
          status: 'valid',
          ...resultOverride,
        },
      ],
      citations: [citation],
      conflicts: [],
      retrievalStatus: 'success',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires empty evidence for insufficient and failed outcomes', () => {
    expect(
      searchLearningMaterialsV2OutputSchema.safeParse({
        schemaVersion: COACH_RAG_TOOL_SCHEMA_VERSION,
        ok: true,
        query: 'unknown material',
        appliedFilters,
        results: [],
        citations: [],
        conflicts: [],
        retrievalStatus: 'insufficient',
      }).success,
    ).toBe(true);
    expect(
      searchLearningMaterialsV2OutputSchema.safeParse({
        schemaVersion: COACH_RAG_TOOL_SCHEMA_VERSION,
        ok: false,
        query: 'unknown material',
        appliedFilters,
        results: [],
        citations: [],
        conflicts: [],
        retrievalStatus: 'failed',
        failure: {
          code: 'EMBEDDING_UNAVAILABLE',
          message: 'Knowledge retrieval is temporarily unavailable.',
          retryable: true,
        },
      }).success,
    ).toBe(true);
  });

  it('takes identity only from the execution context in RAG mode', async () => {
    const searchV2 = jest.fn(async (_subjectId, value) => ({
      schemaVersion: COACH_RAG_TOOL_SCHEMA_VERSION,
      ok: true as const,
      query: value.query,
      appliedFilters,
      results: [],
      citations: [],
      conflicts: [],
      retrievalStatus: 'insufficient' as const,
    }));
    const tool = new SearchLearningMaterialsTool({ searchV2 } as never, true);
    const context = createCoachExecutionContext(
      { userId: 'user-context-only', tokenType: 'access', exp: 1_800_000_000 },
      1_700_000_000,
    );
    const input = {
      schemaVersion: COACH_RAG_TOOL_SCHEMA_VERSION,
      query: 'harbor meaning',
      filters: {
        categories: ['WORD_MEANING'],
        sources: [],
        courseIds: [],
        wordIds: [],
      },
      topK: 8,
    };
    await expect(tool.execute(context, input)).resolves.toMatchObject({
      retrievalStatus: 'insufficient',
    });
    expect(searchV2).toHaveBeenCalledWith(
      'user-context-only',
      expect.not.objectContaining({ userId: expect.anything() }),
    );
    await expect(
      tool.execute(context, { ...input, userId: 'attacker' }),
    ).resolves.toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(searchV2).toHaveBeenCalledTimes(1);
  });
});
