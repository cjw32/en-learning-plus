import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from '@en/common/coach/zod';

const candidateSchema = z
  .object({
    sourceId: z.string().min(1),
    chunkId: z.string().min(1),
    category: z.enum(['WORD_MEANING', 'COURSE_LESSON', 'USER_ERROR', 'LEARNING_SUMMARY']),
    level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable(),
    courseId: z.string().nullable(),
    accessScope: z.enum(['PUBLIC', 'OWNED_COURSE', 'PRIVATE_OWNER']),
    ownerAlias: z.string().nullable(),
    status: z.enum(['ACTIVE', 'INVALID']),
  })
  .strict();

const ragPersonalizationCaseSchema = z
  .object({
    id: z.string().regex(/^rag_personalization_[a-z0-9_]+$/),
    caseVersion: z.literal('rag-personalization-case.v1'),
    datasetVersion: z.literal('rag-personalization.synthetic.v1'),
    scenario: z.enum([
      'level',
      'course',
      'wrong_answer',
      'summary',
      'missing_signals',
      'deleted_private',
    ]),
    pairGroup: z.string().nullable(),
    subjectAlias: z.string().regex(/^synthetic_[a-z]+$/),
    query: z.string().min(1).max(1000),
    profile: z
      .object({
        cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable(),
        levelStatus: z.enum(['AVAILABLE', 'MISSING', 'STALE']),
        goalType: z.enum(['GENERAL', 'EXAM', 'BUSINESS', 'TRAVEL', 'CUSTOM']).nullable(),
        goalStatus: z.enum(['AVAILABLE', 'MISSING', 'STALE']),
        activeCourseId: z.string().nullable(),
        courseStatus: z.enum(['AVAILABLE', 'MISSING', 'STALE']),
        weakWordIds: z.array(z.string()).max(50),
        weakStatus: z.enum(['AVAILABLE', 'MISSING', 'STALE', 'NOT_APPLICABLE']),
      })
      .strict(),
    due: z
      .object({
        asOf: z.string().datetime().nullable(),
        status: z.enum(['CURRENT', 'STALE', 'UNAVAILABLE']),
        wordIds: z.array(z.string()).max(50),
      })
      .strict(),
    requestedFilters: z
      .object({
        categories: z.array(candidateSchema.shape.category).min(1),
        accessScopes: z.array(candidateSchema.shape.accessScope).min(1),
      })
      .strict(),
    candidates: z.array(candidateSchema).min(1),
    expected: z
      .object({
        retrievalStatus: z.enum(['success', 'insufficient']),
        appliedLevels: z.array(z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])),
        allowedSourceIds: z.array(z.string()),
        expectedRelevantChunkIds: z.array(z.string()),
        forbiddenSourceIds: z.array(z.string()).min(1),
        leakCount: z.literal(0),
      })
      .strict(),
    versions: z
      .object({
        content: z.string().min(1),
        embedding: z.string().min(1),
        chunking: z.string().min(1),
        retrieval: z.string().min(1),
        schema: z.literal('coach.tool.v2'),
      })
      .strict(),
    measurementFields: z
      .array(
        z.enum([
          'recallAtK',
          'precisionAtK',
          'mrr',
          'leakCount',
          'contextTokens',
          'totalTokens',
          'estimatedCostMicros',
        ]),
      )
      .min(7),
  })
  .strict();

type RagPersonalizationCase = z.infer<typeof ragPersonalizationCaseSchema>;

function loadCases(): RagPersonalizationCase[] {
  return readFileSync(
    resolve(__dirname, 'fixtures/rag-personalization.cases.jsonl'),
    'utf8',
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return ragPersonalizationCaseSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`Invalid RAG personalization case at line ${index + 1}: ${String(error)}`);
      }
    });
}

function runCase(item: RagPersonalizationCase) {
  const appliedLevels =
    item.profile.levelStatus === 'AVAILABLE' && item.profile.cefr
      ? [item.profile.cefr]
      : [];
  const selected = item.candidates.filter((candidate) => {
    if (candidate.status !== 'ACTIVE') return false;
    if (!item.requestedFilters.categories.includes(candidate.category)) return false;
    if (!item.requestedFilters.accessScopes.includes(candidate.accessScope)) return false;
    if (
      appliedLevels.length > 0 &&
      candidate.level !== null &&
      !appliedLevels.includes(candidate.level)
    ) {
      return false;
    }
    if (candidate.accessScope === 'PUBLIC') return true;
    if (candidate.accessScope === 'OWNED_COURSE') {
      return (
        item.profile.courseStatus === 'AVAILABLE' &&
        candidate.courseId === item.profile.activeCourseId
      );
    }
    return (
      item.profile.weakStatus === 'AVAILABLE' &&
      candidate.ownerAlias === item.subjectAlias
    );
  });
  const selectedIds = selected.map((candidate) => candidate.sourceId);
  const selectedChunks = selected.map((candidate) => candidate.chunkId);
  const relevant = new Set(item.expected.expectedRelevantChunkIds);
  const relevantRetrieved = selectedChunks.filter((chunkId) => relevant.has(chunkId));
  const firstRelevant = selectedChunks.findIndex((chunkId) => relevant.has(chunkId));
  return Object.freeze({
    selectedIds,
    selectedChunks,
    appliedLevels,
    retrievalStatus: selected.length > 0 ? ('success' as const) : ('insufficient' as const),
    leakCount: selectedIds.filter((sourceId) =>
      item.expected.forbiddenSourceIds.includes(sourceId),
    ).length,
    recallAtK:
      relevant.size === 0 ? 1 : relevantRetrieved.length / relevant.size,
    precisionAtK:
      selected.length === 0 ? 1 : relevantRetrieved.length / selected.length,
    mrr: firstRelevant < 0 ? (relevant.size === 0 ? 1 : 0) : 1 / (firstRelevant + 1),
    estimatedCostMicros: 0,
  });
}

describe('RAG personalization deterministic evaluation', () => {
  const cases = loadCases();

  it('has independent versioned coverage and deterministic expected retrieval', () => {
    expect(cases.map((item) => item.scenario)).toEqual(
      expect.arrayContaining([
        'level',
        'course',
        'wrong_answer',
        'summary',
        'missing_signals',
        'deleted_private',
      ]),
    );
    for (const item of cases) {
      const actual = runCase(item);
      expect(actual.appliedLevels).toEqual(item.expected.appliedLevels);
      expect(actual.selectedIds).toEqual(item.expected.allowedSourceIds);
      expect(actual.selectedChunks).toEqual(item.expected.expectedRelevantChunkIds);
      expect(actual.retrievalStatus).toBe(item.expected.retrievalStatus);
      expect(actual.leakCount).toBe(0);
      expect(actual.recallAtK).toBe(1);
      expect(actual.precisionAtK).toBe(1);
      expect(actual.mrr).toBe(1);
      expect(actual.estimatedCostMicros).toBe(0);
    }
  });

  it('returns different authorized evidence for paired users and levels', () => {
    for (const pairGroup of ['same_query_level', 'same_query_private_owner']) {
      const pair = cases.filter((item) => item.pairGroup === pairGroup);
      expect(pair).toHaveLength(2);
      expect(pair[0].query).toBe(pair[1].query);
      expect(runCase(pair[0]).selectedIds).not.toEqual(runCase(pair[1]).selectedIds);
      expect(runCase(pair[0]).leakCount).toBe(0);
      expect(runCase(pair[1]).leakCount).toBe(0);
    }
  });

  it('does not infer private filters for missing signals or return deleted content', () => {
    const missing = cases.find((item) => item.scenario === 'missing_signals')!;
    const deleted = cases.find((item) => item.scenario === 'deleted_private')!;
    expect(runCase(missing)).toMatchObject({
      appliedLevels: [],
      selectedIds: ['word:harbor:public'],
      leakCount: 0,
    });
    expect(runCase(deleted)).toMatchObject({
      selectedIds: [],
      retrievalStatus: 'insufficient',
      leakCount: 0,
    });
  });
});
