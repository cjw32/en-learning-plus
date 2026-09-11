import { createHash } from 'node:crypto';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { MCP_SCHEMA_VERSION } from '@en/common/mcp';
import { McpLearningBridge } from '../../src/coach/mcp/mcp-learning.bridge';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';
import {
  McpCostMeter,
  type McpRagCostMetric,
} from '../../src/mcp/governance/mcp-cost-meter';
import { McpCursorService } from '../../src/mcp/pagination/mcp-cursor.service';
import { McpGetDueWordsTool } from '../../src/mcp/tools/get-due-words.tool';
import { McpGetLearningReportTool } from '../../src/mcp/tools/get-learning-report.tool';
import { McpSearchLearningMaterialsTool } from '../../src/mcp/tools/search-learning-materials.tool';
import { McpSearchWordsTool } from '../../src/mcp/tools/search-words.tool';
import { McpToolRegistry } from '../../src/mcp/tools/mcp-tool.registry';
import { McpLegacySessionManager } from '../../src/mcp/transport/mcp-legacy-session.manager';
import { McpModernTransportFactory } from '../../src/mcp/transport/mcp-modern-transport.factory';

const endpoint = new URL('https://read-tools.mcp.test/ai/v1/mcp');
const now = new Date('2026-09-11T08:00:00.000Z');
const toolNames = [
  'search_words',
  'get_due_words',
  'search_learning_materials',
  'get_learning_report',
] as const;

type Era = 'modern' | 'legacy';
type UserId = 'learner_a' | 'learner_b';
type ToolName = (typeof toolNames)[number];

type AuthoritativeState = Readonly<{
  submissions: readonly object[];
  attempts: readonly object[];
  reviewSchedules: readonly object[];
  mastery: readonly object[];
  idempotencyIntents: readonly object[];
}>;

type State = {
  active: Record<UserId, boolean>;
  ragEnabled: boolean;
  authoritative: AuthoritativeState;
  calls: Record<ToolName, number>;
  metrics: McpRagCostMetric[];
};

class MemorySessionStore {
  private readonly sessions = new Map<string, unknown>();

  async save(session: { sessionId: string }) {
    this.sessions.set(session.sessionId, session);
  }

  async load(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string) {
    this.sessions.delete(sessionId);
  }
}

function context(userId: UserId, era: Era): McpRequestContext {
  const suffix = userId === 'learner_a' ? 'a' : 'b';
  return Object.freeze({
    principal: Object.freeze({
      issuer: 'https://issuer.mcp.test',
      subject: `read-tools-e2e-subject-${suffix}`,
      audience: endpoint.href,
      clientId: `read-tools-e2e-client-${suffix}`,
      scopes: Object.freeze(['learning:read'] as const),
      authorizationVersion: 1,
      issuedAtEpochSeconds: Math.floor(now.getTime() / 1_000) - 60,
      notBeforeEpochSeconds: Math.floor(now.getTime() / 1_000) - 60,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 3_600,
      verificationMethodVersion: 'read-tools-e2e.v1',
    }),
    userId,
    authorizationId: `authorization_read_tools_${suffix}`,
    requestId: `request_read_tools_${era}_${suffix}`,
    traceId: `trace_read_tools_${era}_${suffix}_0001`,
    protocolVersion: era === 'modern' ? '2026-07-28' : '2025-11-25',
  });
}

function snapshot(state: AuthoritativeState) {
  return Object.fromEntries(
    Object.entries(state).map(([table, rows]) => [
      table,
      Object.freeze({
        rowCount: rows.length,
        contentHash: createHash('sha256')
          .update(JSON.stringify(rows))
          .digest('hex'),
      }),
    ]),
  );
}

function ragOutput(userId: UserId, empty = false) {
  const suffix = userId === 'learner_a' ? 'alpha' : 'beta';
  const result = {
    resultId: `result_material_${suffix}_0001`,
    chunkId: `chunk_material_${suffix}_0001`,
    documentId: `document_material_${suffix}_0001`,
    citationId: `cit_material_${suffix}_0001`,
    source: 'course',
    sourceId: `course:course_business:material_${suffix}`,
    title: `${suffix} project meeting`,
    category: 'COURSE_LESSON',
    excerpt: `Authorized ${suffix} meeting excerpt.`,
    level: 'B1',
    courseId: 'course_business',
    wordId: null,
    accessScope: 'OWNED_COURSE',
    rank: 1,
    relevanceScore: 0.91,
    contentVersion: `course-${suffix}.v3`,
    embeddingVersion: 'embedding.v2',
    status: 'valid',
  };
  const citation = {
    citationId: result.citationId,
    source: result.source,
    sourceId: result.sourceId,
    title: result.title,
    excerpt: result.excerpt,
    category: result.category,
    wordId: result.wordId,
    courseId: result.courseId,
    accessScope: result.accessScope,
    status: 'active',
    usage: 'answer_evidence',
  };
  return {
    schemaVersion: 'coach.tool.v2',
    ok: true,
    query: 'opening a project meeting',
    appliedFilters: {
      levels: ['B1'],
      levelFilterApplied: true,
      categories: ['COURSE_LESSON'],
      sources: [],
      courseIds: ['course_business'],
      wordIds: [],
      accessScopes: ['PUBLIC', 'OWNED_COURSE', 'PRIVATE_OWNER'],
      privateOwnerEnforced: true,
      topK: 8,
      minimumRelevance: 0.65,
      sourceRightsSnapshotVersion: 'rights.e2e.v1',
      contentVersionPolicy: 'content-current.v1',
      chunkingVersion: 'chunking.v1',
      embeddingVersion: 'embedding.v2',
      retrievalConfigVersion: 'retrieval.v2',
      indexVersion: 'index.e2e.v1',
    },
    results: empty ? [] : [result],
    citations: empty ? [] : [citation],
    conflicts: [],
    retrievalStatus: empty ? 'insufficient' : 'success',
  };
}

function fixture(userId: UserId, era: Era) {
  const requestContext = context(userId, era);
  const state: State = {
    active: { learner_a: true, learner_b: true },
    ragEnabled: true,
    authoritative: Object.freeze({
      submissions: Object.freeze([
        Object.freeze({
          id: 'submission_existing',
          userId: 'learner_a',
          score: 82,
        }),
      ]),
      attempts: Object.freeze([
        Object.freeze({
          id: 'attempt_existing',
          userId: 'learner_a',
          quality: 4,
        }),
      ]),
      reviewSchedules: Object.freeze([
        Object.freeze({
          id: 'review_existing',
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
    }),
    calls: {
      search_words: 0,
      get_due_words: 0,
      search_learning_materials: 0,
      get_learning_report: 0,
    },
    metrics: [],
  };
  const cursors = new McpCursorService({
    hmacKey: 'mcp-read-tools-e2e-cursor-key-at-least-32-bytes',
    ttlMs: 5 * 60 * 1_000,
    now: () => now,
  });
  const dictionary = {
    search: jest.fn(async ({ query }: { query: string }) => {
      state.calls.search_words += 1;
      return {
        items:
          query === 'absent'
            ? []
            : [
                {
                  word: {
                    wordId: 'word_practice',
                    word: 'practice',
                    definition: 'to do something repeatedly to improve',
                    translation: '练习',
                    partOfSpeech: 'verb',
                    phonetic: '/ˈpræktɪs/',
                    cefr: 'A2',
                    availability: 'available',
                    contentVersion: 'word-source.v1',
                  },
                  forms: ['practice', 'practices'],
                  examples: ['I practice English every day.'],
                  source: {
                    citationId: 'cit_word_e2e_0001',
                    source: 'approved-word-source',
                    title: 'Practice',
                    excerpt: 'to do something repeatedly to improve',
                    contentVersion: 'word-source.v1',
                    accessScope: 'PUBLIC',
                    status: 'active',
                  },
                  contentVersion: 'word-source.v1',
                  updatedAt: now,
                },
              ],
        hasMore: false,
      };
    }),
  };
  const schedules = {
    getDueWords: jest.fn(async (currentUserId: string) => {
      state.calls.get_due_words += 1;
      const words =
        currentUserId === 'learner_a'
          ? [
              {
                wordId: 'word_alpha',
                word: 'alpha',
                definition: 'the first item',
                translation: '首项',
                reviewState: 'REVIEW',
                dueAt: new Date('2026-09-11T07:30:00.000Z'),
                lastQuality: 2,
                priority: 1,
                reason: 'Scheduled review is due.',
              },
            ]
          : [];
      return { asOf: now, words, totalDue: words.length, truncated: false };
    }),
  };
  const reports = {
    getSummary: jest.fn(
      async ({ userId: currentUserId }: { userId: string }) => {
        state.calls.get_learning_report += 1;
        const hasData = currentUserId === 'learner_a';
        return {
          report: {
            windowStart: '2026-09-05',
            windowEnd: '2026-09-11',
            attemptCount: hasData ? 7 : 0,
            averageScore: hasData ? 84 : null,
            reviewsDue: hasData ? 1 : 0,
            reviewsCompleted: hasData ? 4 : 0,
            learnedWordCount: hasData ? 12 : 0,
            dataCompleteness: hasData ? 'complete' : 'insufficient',
            policyVersion: 'learning-report.v1',
          },
          contentVersion: `report-${currentUserId}.v1`,
          updatedAt: now,
        };
      },
    ),
    getWeaknesses: jest.fn(
      async ({ userId: currentUserId }: { userId: string }) => ({
        dataCompleteness:
          currentUserId === 'learner_a' ? 'complete' : 'insufficient',
        items:
          currentUserId === 'learner_a'
            ? [
                {
                  type: 'word',
                  key: 'word_alpha',
                  label: 'alpha',
                  count: 2,
                  lastSeenAt: '2026-09-10T08:00:00.000Z',
                  evidenceStatus: 'current',
                },
              ]
            : [],
        truncated: false,
        nextPosition: null,
        contentVersion: `report-${currentUserId}.v1`,
        updatedAt: now,
      }),
    ),
  };
  const materialService = {
    searchV2: jest.fn(async (currentUserId: UserId) => {
      state.calls.search_learning_materials += 1;
      return ragOutput(currentUserId, currentUserId === 'learner_b');
    }),
  };
  const costMeter = new McpCostMeter({
    sink: { record: (metric) => void state.metrics.push(metric) },
    hmacKey: 'mcp-read-tools-e2e-cost-key-at-least-32-bytes',
    provider: 'fixture-provider',
    model: 'fixture-retrieval-model',
    inputMicrosPerMillionTokens: 100,
    outputMicrosPerMillionTokens: 200,
  });
  const bridge = new McpLearningBridge(
    materialService as never,
    undefined,
    costMeter,
    () => now,
  );
  const registry = new McpToolRegistry({
    authorization: {
      assertActive: async (current) => {
        if (!state.active[current.userId as UserId]) {
          throw Object.assign(new Error('The Tool is unavailable.'), {
            code: 'UNAUTHENTICATED',
          });
        }
      },
    },
    isCapabilityEnabled: (name) =>
      name !== 'search_learning_materials' || state.ragEnabled,
    handlers: {
      search_words: new McpSearchWordsTool(dictionary as never, cursors),
      get_due_words: new McpGetDueWordsTool(schedules as never, cursors),
      search_learning_materials: new McpSearchLearningMaterialsTool(bridge),
      get_learning_report: new McpGetLearningReportTool(reports as never),
    },
  });
  const server = () => {
    const instance = new McpServer({
      name: 'english-learning-read-tools-e2e',
      version: '1.0.0',
    });
    registry.register(instance, requestContext);
    return instance;
  };
  let sessionSequence = 0;
  const modern = new McpModernTransportFactory({ createServer: server });
  const legacy = new McpLegacySessionManager({
    createServer: server,
    store: new MemorySessionStore() as never,
    now: () => now,
    sessionId: () =>
      `legacy_read_tools_${String(++sessionSequence).padStart(20, '0')}`,
    idleTtlMs: 15 * 60 * 1_000,
    absoluteTtlMs: 60 * 60 * 1_000,
  });
  const fetch = async (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    if (era === 'modern') return modern.handle(request);
    return legacy.handle(request, {
      issuer: requestContext.principal.issuer,
      subjectHmac: createHash('sha256')
        .update(requestContext.principal.subject)
        .digest('hex'),
      clientHmac: createHash('sha256')
        .update(requestContext.principal.clientId)
        .digest('hex'),
      authorizationId: requestContext.authorizationId,
      authorizationVersion: 1,
      tokenExpiresAt: new Date(
        requestContext.principal.expiresAtEpochSeconds * 1_000,
      ),
    });
  };
  return {
    state,
    requestContext,
    registry,
    modern,
    legacy,
    fetch,
    issuedCitations: new Map([
      [
        'cit_material_alpha_0001',
        {
          title: 'alpha project meeting',
          excerpt: 'Authorized alpha meeting excerpt.',
          contentVersion: 'course-alpha.v3',
        },
      ],
    ]),
  };
}

async function connect(test: ReturnType<typeof fixture>, era: Era) {
  const client = new Client(
    { name: `read-tools-${era}-client`, version: '1.0.0' },
    {
      versionNegotiation:
        era === 'modern' ? { mode: { pin: '2026-07-28' } } : { mode: 'legacy' },
    },
  );
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: async () => `${test.requestContext.userId}-token` },
    fetch: test.fetch as typeof fetch,
  });
  await client.connect(transport);
  await client.listTools();
  return client;
}

async function callJson(client: Client, name: ToolName, input: object) {
  const result = await client.callTool({ name, arguments: input });
  if (result.isError || result.structuredContent === undefined) {
    throw new Error(`Tool ${name} did not return structured content`);
  }
  return result.structuredContent as Record<string, unknown>;
}

const inputs: Readonly<Record<ToolName, object>> = Object.freeze({
  search_words: Object.freeze({
    schemaVersion: MCP_SCHEMA_VERSION,
    query: 'practice',
    cefr: 'A2',
    limit: 10,
  }),
  get_due_words: Object.freeze({
    schemaVersion: MCP_SCHEMA_VERSION,
    learningDate: '2026-09-11',
    timezone: 'Asia/Shanghai',
    courseId: 'course_business',
    limit: 20,
  }),
  search_learning_materials: Object.freeze({
    schemaVersion: MCP_SCHEMA_VERSION,
    query: 'opening a project meeting',
    categories: Object.freeze(['COURSE_LESSON']),
    levels: Object.freeze(['B1']),
    courseIds: Object.freeze(['course_business']),
    topK: 8,
    minimumRelevance: 0.65,
  }),
  get_learning_report: Object.freeze({
    schemaVersion: MCP_SCHEMA_VERSION,
    from: '2026-09-05',
    to: '2026-09-11',
    dimensions: Object.freeze([
      'progress',
      'review',
      'performance',
      'weaknesses',
    ]),
    limit: 20,
  }),
});

async function closeFixture(
  client: Client | undefined,
  test: ReturnType<typeof fixture>,
) {
  if (client) await client.close();
  await test.modern.close();
  await test.legacy.close();
}

describe('English Learning MCP read Tools with official clients', () => {
  it.each(['modern', 'legacy'] as const)(
    '%s calls all four Tools, resolves citations, and leaves learning state unchanged',
    async (era) => {
      const test = fixture('learner_a', era);
      const before = snapshot(test.state.authoritative);
      let client: Client | undefined;
      try {
        client = await connect(test, era);
        const listed = await client.listTools();
        expect(listed.tools.map(({ name }) => name)).toEqual(toolNames);

        const words = await callJson(
          client,
          'search_words',
          inputs.search_words,
        );
        const due = await callJson(
          client,
          'get_due_words',
          inputs.get_due_words,
        );
        const materials = await callJson(
          client,
          'search_learning_materials',
          inputs.search_learning_materials,
        );
        const report = await callJson(
          client,
          'get_learning_report',
          inputs.get_learning_report,
        );

        expect(words).toMatchObject({
          ok: true,
          items: [{ wordId: 'word_practice' }],
        });
        expect(due).toMatchObject({
          ok: true,
          totalDue: 1,
          items: [{ wordId: 'word_alpha' }],
        });
        expect(materials).toMatchObject({
          ok: true,
          retrievalStatus: 'success',
          results: [{ citation: { citationId: 'cit_material_alpha_0001' } }],
        });
        expect(report).toMatchObject({
          ok: true,
          report: { attemptCount: 7, dataCompleteness: 'complete' },
          weaknesses: [{ key: 'word_alpha' }],
        });

        const citation = (
          materials.results as Array<{
            citation: Record<string, unknown>;
          }>
        )[0]?.citation;
        expect(citation).toMatchObject(
          test.issuedCitations.get(String(citation?.citationId)),
        );
        expect(test.state.calls).toEqual({
          search_words: 1,
          get_due_words: 1,
          search_learning_materials: 1,
          get_learning_report: 1,
        });
        expect(test.state.metrics).toHaveLength(1);
        expect(test.state.metrics[0]).toMatchObject({
          operation: 'search_learning_materials',
          measurementMode: 'estimated',
          cancellationOutcome: 'completed',
        });
        expect(snapshot(test.state.authoritative)).toEqual(before);
      } finally {
        await closeFixture(client, test);
      }
    },
  );

  it.each(['modern', 'legacy'] as const)(
    '%s returns legal empty results for every read Tool without cross-user data',
    async (era) => {
      const test = fixture('learner_b', era);
      const before = snapshot(test.state.authoritative);
      let client: Client | undefined;
      try {
        client = await connect(test, era);
        const words = await callJson(client, 'search_words', {
          ...inputs.search_words,
          query: 'absent',
        });
        const due = await callJson(
          client,
          'get_due_words',
          inputs.get_due_words,
        );
        const materials = await callJson(
          client,
          'search_learning_materials',
          inputs.search_learning_materials,
        );
        const report = await callJson(
          client,
          'get_learning_report',
          inputs.get_learning_report,
        );

        expect(words).toMatchObject({ ok: true, items: [], nextCursor: null });
        expect(due).toMatchObject({ ok: true, totalDue: 0, items: [] });
        expect(materials).toMatchObject({
          ok: true,
          retrievalStatus: 'insufficient',
          results: [],
          conflicts: [],
        });
        expect(report).toMatchObject({
          ok: true,
          report: {
            attemptCount: 0,
            averageScore: null,
            dataCompleteness: 'insufficient',
          },
          weaknesses: [],
        });
        const serialized = JSON.stringify({ words, due, materials, report });
        expect(serialized).not.toContain('word_alpha');
        expect(serialized).not.toContain('material_alpha');
        expect(serialized).not.toContain('learner_a');
        expect(snapshot(test.state.authoritative)).toEqual(before);
      } finally {
        await closeFixture(client, test);
      }
    },
  );

  it.each(['modern', 'legacy'] as const)(
    '%s denies every Tool after authorization revocation with zero business calls',
    async (era) => {
      const test = fixture('learner_a', era);
      const before = snapshot(test.state.authoritative);
      let client: Client | undefined;
      try {
        client = await connect(test, era);
        test.state.active.learner_a = false;
        for (const name of toolNames) {
          const result = await client.callTool({
            name,
            arguments: inputs[name],
          });
          expect(result).toMatchObject({
            isError: true,
            content: [{ type: 'text', text: 'The Tool is unavailable.' }],
          });
          expect(result.structuredContent).toBeUndefined();
        }
        expect(test.state.calls).toEqual({
          search_words: 0,
          get_due_words: 0,
          search_learning_materials: 0,
          get_learning_report: 0,
        });
        expect(test.state.metrics).toEqual([]);
        expect(snapshot(test.state.authoritative)).toEqual(before);
      } finally {
        await closeFixture(client, test);
      }
    },
  );

  it.each(['modern', 'legacy'] as const)(
    '%s cancels every Tool before dispatch with zero business calls or writes',
    async (era) => {
      const test = fixture('learner_a', era);
      const before = snapshot(test.state.authoritative);
      let client: Client | undefined;
      try {
        client = await connect(test, era);
        for (const name of toolNames) {
          const controller = new AbortController();
          controller.abort();
          await expect(
            client.callTool(
              { name, arguments: inputs[name] },
              { signal: controller.signal },
            ),
          ).rejects.toThrow();
        }
        expect(test.state.calls).toEqual({
          search_words: 0,
          get_due_words: 0,
          search_learning_materials: 0,
          get_learning_report: 0,
        });
        expect(test.state.metrics).toEqual([]);
        expect(snapshot(test.state.authoritative)).toEqual(before);
      } finally {
        await closeFixture(client, test);
      }
    },
  );
});
