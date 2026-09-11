import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { MCP_SCHEMA_VERSION, mcpSafeErrorSchema } from '@en/common/mcp';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';

type ReadTool = Readonly<{
  execute(input: unknown, context: McpRequestContext): Promise<unknown>;
}>;

type ReadToolConstructor = new (service: unknown) => ReadTool;

const toolRoot = resolve(__dirname, '../../src/mcp/tools');

function tool(fileName: string, exportName: string): ReadToolConstructor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require(resolve(toolRoot, fileName))[exportName] as
    | ReadToolConstructor
    | undefined;
  if (!loaded) throw new Error(`Missing ${exportName} from ${fileName}`);
  return loaded;
}

type State = Readonly<{
  submissions: readonly object[];
  attempts: readonly object[];
  reviewSchedules: readonly object[];
  mastery: readonly object[];
  idempotencyIntents: readonly object[];
}>;

const authoritativeState: State = Object.freeze({
  submissions: Object.freeze([
    Object.freeze({ id: 'submission_a', userId: 'learner_a', score: 80 }),
  ]),
  attempts: Object.freeze([
    Object.freeze({ id: 'attempt_a', userId: 'learner_a', quality: 4 }),
  ]),
  reviewSchedules: Object.freeze([
    Object.freeze({
      id: 'review_a',
      userId: 'learner_a',
      wordId: 'word_alpha',
      dueAt: '2026-09-11T07:00:00.000Z',
    }),
  ]),
  mastery: Object.freeze([
    Object.freeze({
      userId: 'learner_a',
      wordId: 'word_alpha',
      state: 'REVIEW',
    }),
  ]),
  idempotencyIntents: Object.freeze([
    Object.freeze({
      id: 'intent_existing',
      userId: 'learner_a',
      state: 'COMPLETED',
    }),
  ]),
});

function stateSnapshot(state: State) {
  return Object.fromEntries(
    Object.entries(state).map(([name, rows]) => [
      name,
      Object.freeze({
        rowCount: rows.length,
        contentHash: createHash('sha256')
          .update(JSON.stringify(rows))
          .digest('hex'),
      }),
    ]),
  );
}

function contextFor(userId: 'learner_a' | 'learner_b'): McpRequestContext {
  return Object.freeze({
    principal: Object.freeze({
      issuer: 'https://issuer.mcp.test',
      subject: `subject-${userId}`,
      audience: 'https://resource.mcp.test/ai/v1/mcp',
      clientId: 'read-tool-state-client',
      scopes: Object.freeze(['learning:read'] as const),
      authorizationVersion: 1,
      issuedAtEpochSeconds: 1_789_117_140,
      notBeforeEpochSeconds: 1_789_117_140,
      expiresAtEpochSeconds: 1_789_120_800,
      verificationMethodVersion: 'fixture.v1',
    }),
    userId,
    authorizationId: `authorization-${userId}`,
    requestId: `request-state-${userId}`,
    traceId: `trace-state-${userId}`,
    protocolVersion: '2026-07-28',
  });
}

const publicWordEntry = Object.freeze({
  word: Object.freeze({
    wordId: 'word_practice',
    word: 'practice',
    definition: 'to do something repeatedly to improve',
    translation: '练习',
    partOfSpeech: 'verb',
    phonetic: '/ˈpræktɪs/',
    cefr: 'A2' as const,
    availability: 'available' as const,
    contentVersion: 'word-source.v1',
  }),
  forms: Object.freeze(['practice', 'practices']),
  examples: Object.freeze(['I practice English every day.']),
  source: Object.freeze({
    citationId: 'cit_word_state_0001',
    source: 'approved-word-source',
    title: 'Practice',
    excerpt: 'to do something repeatedly to improve',
    contentVersion: 'word-source.v1',
    accessScope: 'PUBLIC' as const,
    status: 'active' as const,
  }),
  contentVersion: 'word-source.v1',
  updatedAt: new Date('2026-09-11T08:00:00.000Z'),
});

const userData = Object.freeze({
  learner_a: Object.freeze({
    wordId: 'word_alpha',
    word: 'alpha',
    materialId: 'material_alpha',
    attemptCount: 7,
  }),
  learner_b: Object.freeze({
    wordId: 'word_beta',
    word: 'beta',
    materialId: 'material_beta',
    attemptCount: 2,
  }),
});

function fixture() {
  const dictionarySearch = jest.fn(async () => ({
    items: [publicWordEntry],
    hasMore: false,
  }));
  const getDueWords = jest.fn(async (userId: keyof typeof userData) => {
    const data = userData[userId];
    return {
      asOf: new Date('2026-09-11T08:00:00.000Z'),
      words: [
        {
          wordId: data.wordId,
          word: data.word,
          definition: `${data.word} definition`,
          translation: `${data.word} translation`,
          reviewState: 'REVIEW',
          dueAt: new Date('2026-09-11T07:30:00.000Z'),
          lastQuality: 2,
          priority: 1,
          reason: 'Scheduled review is due.',
        },
      ],
      totalDue: 1,
      truncated: false,
    };
  });
  const searchMaterials = jest.fn(
    async (request: { userId: keyof typeof userData }) => {
      const data = userData[request.userId];
      return {
        retrievalStatus: 'success',
        results: [
          {
            resultId: `result_${data.materialId}`,
            title: `${data.word} lesson`,
            category: 'COURSE_LESSON',
            excerpt: `Authorized excerpt for ${data.word}.`,
            rank: 1,
            relevanceScore: 0.9,
            contentVersion: `${data.materialId}.v1`,
            citation: {
              citationId: `cit_${data.materialId}_001`,
              source: data.materialId,
              title: `${data.word} lesson`,
              excerpt: `Authorized excerpt for ${data.word}.`,
              contentVersion: `${data.materialId}.v1`,
              accessScope: 'OWNED_COURSE',
              status: 'active',
            },
          },
        ],
        conflicts: [],
      };
    },
  );
  const getSummary = jest.fn(
    async ({ userId }: { userId: keyof typeof userData }) => {
      const data = userData[userId];
      return {
        report: {
          windowStart: '2026-09-05',
          windowEnd: '2026-09-11',
          attemptCount: data.attemptCount,
          averageScore: 80,
          reviewsDue: 1,
          reviewsCompleted: 0,
          learnedWordCount: data.attemptCount,
          dataCompleteness: 'complete',
          policyVersion: 'learning-report.v1',
        },
        contentVersion: `report-${userId}.v1`,
        updatedAt: new Date('2026-09-11T08:00:00.000Z'),
      };
    },
  );
  const getWeaknesses = jest.fn(
    async ({ userId }: { userId: keyof typeof userData }) => {
      const data = userData[userId];
      return {
        dataCompleteness: 'complete',
        items: [
          {
            type: 'word',
            key: data.wordId,
            label: data.word,
            count: 2,
            lastSeenAt: '2026-09-10T08:00:00.000Z',
            evidenceStatus: 'current',
          },
        ],
        truncated: false,
        nextPosition: null,
        contentVersion: `report-${userId}.v1`,
        updatedAt: new Date('2026-09-11T08:00:00.000Z'),
      };
    },
  );
  const writes = {
    createSubmission: jest.fn(() => {
      throw new Error('read Tool attempted a submission write');
    }),
    createAttempt: jest.fn(() => {
      throw new Error('read Tool attempted an attempt write');
    }),
    updateReviewSchedule: jest.fn(() => {
      throw new Error('read Tool attempted a review write');
    }),
    updateMastery: jest.fn(() => {
      throw new Error('read Tool attempted a mastery write');
    }),
    reserveIdempotency: jest.fn(() => {
      throw new Error('read Tool attempted an idempotency write');
    }),
  };

  const SearchWords = tool('search-words.tool.ts', 'McpSearchWordsTool');
  const GetDueWords = tool('get-due-words.tool.ts', 'McpGetDueWordsTool');
  const SearchMaterials = tool(
    'search-learning-materials.tool.ts',
    'McpSearchLearningMaterialsTool',
  );
  const GetReport = tool(
    'get-learning-report.tool.ts',
    'McpGetLearningReportTool',
  );
  return {
    tools: {
      searchWords: new SearchWords({ search: dictionarySearch, ...writes }),
      getDueWords: new GetDueWords({ getDueWords, ...writes }),
      searchMaterials: new SearchMaterials({ searchMaterials, ...writes }),
      getReport: new GetReport({ getSummary, getWeaknesses, ...writes }),
    },
    reads: {
      dictionarySearch,
      getDueWords,
      searchMaterials,
      getSummary,
      getWeaknesses,
    },
    writes,
  };
}

function inputs() {
  return {
    searchWords: {
      schemaVersion: MCP_SCHEMA_VERSION,
      query: 'practice',
      limit: 10,
    },
    getDueWords: {
      schemaVersion: MCP_SCHEMA_VERSION,
      learningDate: '2026-09-11',
      timezone: 'Asia/Shanghai',
      limit: 20,
    },
    searchMaterials: {
      schemaVersion: MCP_SCHEMA_VERSION,
      query: 'project meeting',
      categories: ['COURSE_LESSON'],
      topK: 8,
    },
    getReport: {
      schemaVersion: MCP_SCHEMA_VERSION,
      dimensions: ['progress', 'review', 'weaknesses'],
      limit: 20,
    },
  };
}

async function settle(invocation: Promise<unknown>): Promise<void> {
  try {
    const result = await invocation;
    if (typeof result === 'object' && result && 'ok' in result && !result.ok) {
      expect(mcpSafeErrorSchema.safeParse(result).success).toBe(true);
    }
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
  }
}

describe('MCP read Tool state integrity and subject isolation', () => {
  it.each(['learner_a', 'learner_b'] as const)(
    'keeps every authoritative learning table unchanged for %s successful reads',
    async (userId) => {
      const test = fixture();
      const before = stateSnapshot(authoritativeState);
      const request = inputs();
      const context = contextFor(userId);

      const results = await Promise.all([
        test.tools.searchWords.execute(request.searchWords, context),
        test.tools.getDueWords.execute(request.getDueWords, context),
        test.tools.searchMaterials.execute(request.searchMaterials, context),
        test.tools.getReport.execute(request.getReport, context),
      ]);

      expect(stateSnapshot(authoritativeState)).toEqual(before);
      expect(results).toHaveLength(4);
      for (const write of Object.values(test.writes)) {
        expect(write).not.toHaveBeenCalled();
      }
    },
  );

  it('injects the current user and never returns the other learner fixture', async () => {
    const test = fixture();
    const request = inputs();
    const results = await Promise.all(
      (['learner_a', 'learner_b'] as const).map(async (userId) => ({
        userId,
        due: await test.tools.getDueWords.execute(
          request.getDueWords,
          contextFor(userId),
        ),
        materials: await test.tools.searchMaterials.execute(
          request.searchMaterials,
          contextFor(userId),
        ),
        report: await test.tools.getReport.execute(
          request.getReport,
          contextFor(userId),
        ),
      })),
    );

    for (const result of results) {
      const other =
        result.userId === 'learner_a' ? userData.learner_b : userData.learner_a;
      expect(JSON.stringify(result)).not.toContain(other.wordId);
      expect(JSON.stringify(result)).not.toContain(other.materialId);
    }
    expect(test.reads.getDueWords.mock.calls.map(([userId]) => userId)).toEqual(
      ['learner_a', 'learner_b'],
    );
    expect(
      test.reads.searchMaterials.mock.calls.map(([request]) => request.userId),
    ).toEqual(['learner_a', 'learner_b']);
    expect(
      test.reads.getSummary.mock.calls.map(([request]) => request.userId),
    ).toEqual(['learner_a', 'learner_b']);
  });

  it('keeps state unchanged for validation and downstream failures', async () => {
    const test = fixture();
    const before = stateSnapshot(authoritativeState);
    const current = contextFor('learner_a');
    await settle(
      test.tools.searchWords.execute(
        {
          schemaVersion: MCP_SCHEMA_VERSION,
          query: 'practice',
          limit: 10,
          userId: 'learner_b',
        },
        current,
      ),
    );

    test.reads.getSummary.mockRejectedValueOnce(
      Object.assign(new Error('repository unavailable'), {
        code: 'DATA_NOT_AVAILABLE',
      }),
    );
    await settle(
      test.tools.getReport.execute(
        { schemaVersion: MCP_SCHEMA_VERSION, limit: 20 },
        current,
      ),
    );

    expect(stateSnapshot(authoritativeState)).toEqual(before);
    expect(test.reads.dictionarySearch).not.toHaveBeenCalled();
    for (const write of Object.values(test.writes)) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});
