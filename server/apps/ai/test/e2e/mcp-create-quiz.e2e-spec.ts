import { createHash } from 'node:crypto';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { MCP_SCHEMA_VERSION, mcpCreateQuizSuccessSchema } from '@en/common/mcp';
import { McpLearningBridge } from '../../src/coach/mcp/mcp-learning.bridge';
import { McpOperationEnvelopeFactory } from '../../src/coach/mcp/mcp-operation-envelope.factory';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';
import {
  McpCostMeter,
  type McpQuizCostMetric,
} from '../../src/mcp/governance/mcp-cost-meter';
import { McpQuizResultProjector } from '../../src/mcp/results/mcp-quiz-result.projector';
import {
  McpCreateQuizExecutionOrchestrator,
  McpCreateQuizTool,
} from '../../src/mcp/tools/create-quiz.tool';
import { McpToolRegistry } from '../../src/mcp/tools/mcp-tool.registry';
import { McpLegacySessionManager } from '../../src/mcp/transport/mcp-legacy-session.manager';
import { McpModernTransportFactory } from '../../src/mcp/transport/mcp-modern-transport.factory';

const endpoint = new URL('https://create-quiz.mcp.test/ai/v1/mcp');
type Era = 'modern' | 'legacy';

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

const quizInput = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  types: Object.freeze(['MULTIPLE_CHOICE'] as const),
  count: 1,
  difficulty: 'MEDIUM' as const,
  wordIds: Object.freeze(['word_agenda']),
  knowledgeCategories: Object.freeze(['COURSE_LESSON'] as const),
  scenario: 'Practise opening a project meeting.',
  idempotencyKey: 'quiz-e2e-idempotency-key-0001',
});

function protectedSnapshot(state: ReturnType<typeof fixture>['state']) {
  return Object.fromEntries(
    (['mastery', 'reviewSchedules', 'submissions', 'attempts'] as const).map(
      (table) => [
        table,
        {
          rowCount: state[table].length,
          contentHash: createHash('sha256')
            .update(JSON.stringify(state[table]))
            .digest('hex'),
        },
      ],
    ),
  );
}

function fixture(era: Era) {
  const baseTime = Date.now();
  let ticks = 0;
  const clock = () => new Date(baseTime + ++ticks * 5);
  const requestContext: McpRequestContext = Object.freeze({
    principal: Object.freeze({
      issuer: 'https://issuer.mcp.test',
      subject: 'create-quiz-e2e-subject',
      audience: endpoint.href,
      clientId: 'create-quiz-e2e-client',
      scopes: Object.freeze(['quiz:create'] as const),
      authorizationVersion: 1,
      issuedAtEpochSeconds: Math.floor(baseTime / 1_000) - 60,
      notBeforeEpochSeconds: Math.floor(baseTime / 1_000) - 60,
      expiresAtEpochSeconds: Math.floor(baseTime / 1_000) + 3_600,
      verificationMethodVersion: 'create-quiz-e2e.v1',
    }),
    userId: 'learner_quiz_e2e',
    authorizationId: 'authorization_quiz_e2e',
    requestId: `request_quiz_e2e_${era}`,
    traceId: `trace_quiz_e2e_${era}_0001`,
    protocolVersion: era === 'modern' ? '2026-07-28' : '2025-11-25',
  });
  const identity = Object.freeze({
    issuer: requestContext.principal.issuer,
    subjectHmac: 'subject_hmac_create_quiz_e2e',
    userId: requestContext.userId,
    authorizationId: requestContext.authorizationId,
    clientId: requestContext.principal.clientId,
    audience: requestContext.principal.audience,
    authorizationVersion: 1,
  });
  const state = {
    active: true,
    sourceActive: true,
    retrievalCalls: 0,
    modelCalls: 0,
    envelopeWrites: 0,
    exercises: [] as object[],
    mastery: [
      { userId: requestContext.userId, wordId: 'word_agenda', state: 'REVIEW' },
    ],
    reviewSchedules: [
      {
        userId: requestContext.userId,
        wordId: 'word_agenda',
        dueAt: '2026-09-11T07:00:00.000Z',
      },
    ],
    submissions: [{ id: 'submission_existing', userId: requestContext.userId }],
    attempts: [{ id: 'attempt_existing', userId: requestContext.userId }],
    metrics: [] as McpQuizCostMetric[],
    traces: [] as Record<string, unknown>[],
    intent: undefined as
      | {
          id: string;
          requestFingerprint: string;
          result?: Record<string, unknown>;
        }
      | undefined,
  };
  const rawMaterial = () => ({
    schemaVersion: 'coach.tool.v2',
    ok: true,
    query: 'English practice for agenda',
    appliedFilters: {
      levels: ['B1'],
      levelFilterApplied: true,
      categories: ['COURSE_LESSON'],
      sources: [],
      courseIds: ['course_business'],
      wordIds: ['word_agenda'],
      accessScopes: ['PUBLIC', 'OWNED_COURSE', 'PRIVATE_OWNER'],
      privateOwnerEnforced: true,
      topK: 8,
      minimumRelevance: 0.65,
      sourceRightsSnapshotVersion: 'rights.quiz-e2e.v1',
      contentVersionPolicy: 'content-current.v1',
      chunkingVersion: 'chunking.v1',
      embeddingVersion: 'embedding.v2',
      retrievalConfigVersion: 'retrieval.v2',
      indexVersion: 'index.quiz-e2e.v1',
    },
    results: [
      {
        resultId: 'result_quiz_e2e_0001',
        chunkId: 'chunk_quiz_e2e_0001',
        documentId: 'document_quiz_e2e_0001',
        citationId: 'cit_quiz_e2e_0001',
        source: 'owned-course',
        sourceId: 'course:course_business:agenda',
        title: 'Opening a project meeting',
        category: 'COURSE_LESSON',
        excerpt: 'Review the agenda before discussing project status.',
        level: 'B1',
        courseId: 'course_business',
        wordId: 'word_agenda',
        accessScope: 'OWNED_COURSE',
        rank: 1,
        relevanceScore: 0.94,
        contentVersion: 'course-meeting.v4',
        embeddingVersion: 'embedding.v2',
        status: state.sourceActive ? 'valid' : 'stale',
      },
    ],
    citations: [
      {
        citationId: 'cit_quiz_e2e_0001',
        source: 'owned-course',
        sourceId: 'course:course_business:agenda',
        title: 'Opening a project meeting',
        excerpt: 'Review the agenda before discussing project status.',
        category: 'COURSE_LESSON',
        wordId: 'word_agenda',
        courseId: 'course_business',
        accessScope: 'OWNED_COURSE',
        status: 'active',
        usage: 'answer_evidence',
      },
    ],
    conflicts: [],
    retrievalStatus: 'success',
  });
  const materialService = {
    searchV2: jest.fn(async () => {
      state.retrievalCalls += 1;
      return rawMaterial();
    }),
  };
  const envelopeFactory = new McpOperationEnvelopeFactory({
    hmacKey: 'mcp-create-quiz-e2e-envelope-key-000001',
    envelopeTtlMs: 86_400_000,
  });
  const quizServices = {
    profiles: {
      getSnapshot: jest.fn(async () => ({
        snapshotAt: clock(),
        level: { cefr: 'B1', source: 'USER_DECLARED' },
        goal: { type: 'BUSINESS', text: 'Lead project meetings' },
        activeCourse: {
          id: 'course_business',
          name: 'Business English',
          value: 'business',
        },
        timezone: 'Asia/Shanghai',
        learnedWordSummary: {
          legacyCompletedCount: 0,
          coachEngagedCount: 1,
          recentWords: [
            { wordId: 'word_agenda', word: 'agenda', state: 'REVIEW' },
          ],
        },
        weakItems: [],
        errorTypes: [],
        recentPerformance: {
          attemptCount: 2,
          averageScore: 75,
          windowStart: new Date(baseTime - 30 * 86_400_000),
        },
        signals: [],
      })),
    },
    schedules: {
      getDueWords: jest.fn(async () => ({
        asOf: clock(),
        words: [
          {
            wordId: 'word_agenda',
            word: 'agenda',
            priority: 1,
            reason: 'Scheduled review is due.',
          },
        ],
        totalDue: 1,
        truncated: false,
      })),
    },
    targeting: {
      select: jest.fn(() => ({
        difficulty: 'B1',
        targets: [
          {
            targetType: 'WORD',
            targetKey: 'word_agenda',
            wordId: 'word_agenda',
            label: 'agenda',
          },
        ],
        challengeNotice: null,
        personalizationReason: 'Practises the current due word agenda.',
      })),
    },
    envelopes: { create: (value: never) => envelopeFactory.create(value) },
    conversations: {
      persistMcpOperationEnvelope: jest.fn(async (envelope) => {
        state.envelopeWrites += 1;
        return envelope;
      }),
    },
    exercises: {
      execute: jest.fn(async (_context, scope) => {
        scope.beforeModelCall?.();
        state.modelCalls += 1;
        scope.modelTelemetry?.onFirstOutput();
        scope.modelTelemetry?.onUsage({ inputTokens: 120, outputTokens: 80 });
        const output = {
          schemaVersion: 'coach.tool.v1',
          ok: true as const,
          exerciseId: 'exercise_quiz_e2e_0001',
          type: 'MULTIPLE_CHOICE' as const,
          difficulty: 'B1' as const,
          instructions: 'Choose the natural sentence.',
          personalizationReason: scope.personalizationReason,
          items: [
            {
              itemId: 'item_quiz_e2e_0001',
              position: 1,
              prompt: 'Which sentence uses agenda naturally?',
              choices: [
                { id: 'choice_a', text: 'Let us review the agenda.' },
                { id: 'choice_b', text: 'I agenda the report.' },
              ],
              maxScore: 100,
              citations: [
                {
                  sourceId: 'course:course_business:agenda',
                  materialType: 'course',
                  title: 'Opening a project meeting',
                  locator: 'mcp-citation:cit_quiz_e2e_0001',
                  supports:
                    'Review the agenda before discussing project status.',
                  accessScope: 'OWNED_COURSE',
                },
              ],
            },
          ],
          citations: [
            {
              sourceId: 'course:course_business:agenda',
              materialType: 'course',
              title: 'Opening a project meeting',
              locator: 'mcp-citation:cit_quiz_e2e_0001',
              supports: 'Review the agenda before discussing project status.',
              accessScope: 'OWNED_COURSE',
            },
          ],
          expiresAt: new Date(baseTime + 86_400_000).toISOString(),
        };
        state.exercises.push({
          id: output.exerciseId,
          userId: requestContext.userId,
          status: 'READY',
          origin: 'MCP',
        });
        return output;
      }),
    },
  };
  const bridge = new McpLearningBridge(
    materialService as never,
    undefined,
    undefined,
    clock,
    quizServices as never,
  );
  const idempotency = {
    beginCreateQuiz: jest.fn(async (_identity, input) => {
      const { idempotencyKey: _key, ...semanticInput } = input;
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(semanticInput))
        .digest('hex');
      if (!state.intent) {
        state.intent = {
          id: 'intent_quiz_e2e_0001',
          requestFingerprint: fingerprint,
        };
        return { action: 'EXECUTE' as const, intent: state.intent };
      }
      if (state.intent.requestFingerprint !== fingerprint) {
        throw Object.assign(new Error('conflict'), {
          code: 'IDEMPOTENCY_CONFLICT',
        });
      }
      if (state.intent.result) {
        return {
          action: 'REPLAY' as const,
          intent: state.intent,
          result: { ...state.intent.result, replayed: true },
        };
      }
      return {
        action: 'IN_PROGRESS' as const,
        intent: state.intent,
        retryAfterMs: 1_000,
      };
    }),
    completeCreateQuiz: jest.fn(async (_identity, _intentId, result) => {
      state.intent!.result = result as Record<string, unknown>;
      return state.intent;
    }),
    failRetryable: jest.fn(async () => state.intent),
    failFinal: jest.fn(async () => state.intent),
  };
  const meter = new McpCostMeter({
    sink: {
      record: () => undefined,
      recordQuiz: (metric) => void state.metrics.push(metric),
    },
    trace: {
      record: async (trace) => void state.traces.push(trace),
    },
    hmacKey: 'mcp-create-quiz-e2e-cost-key-0000000001',
    provider: 'deterministic-provider',
    model: 'quiz-fixture-v1',
    inputMicrosPerMillionTokens: 10_000,
    outputMicrosPerMillionTokens: 20_000,
  });
  const orchestrator = new McpCreateQuizExecutionOrchestrator(
    {
      resolve: async () => {
        if (!state.active) {
          throw Object.assign(new Error('revoked'), {
            code: 'UNAUTHENTICATED',
          });
        }
        return identity;
      },
    },
    idempotency as never,
    bridge,
    new McpQuizResultProjector(),
    meter,
    clock,
  );
  const tool = new McpCreateQuizTool(orchestrator);
  const registry = new McpToolRegistry({
    authorization: {
      assertActive: async () => {
        if (!state.active) {
          throw Object.assign(new Error('revoked'), {
            code: 'UNAUTHENTICATED',
          });
        }
      },
    },
    handlers: { create_quiz: tool } as never,
    isCapabilityEnabled: (name) => name === 'create_quiz',
  });
  const createServer = () => {
    const server = new McpServer({
      name: 'english-learning-create-quiz-e2e',
      version: '1.0.0',
    });
    registry.register(server, requestContext);
    return server;
  };
  const modern = new McpModernTransportFactory({ createServer });
  let sessionSequence = 0;
  const legacy = new McpLegacySessionManager({
    createServer,
    store: new MemorySessionStore() as never,
    now: clock,
    sessionId: () =>
      `legacy_create_quiz_${String(++sessionSequence).padStart(20, '0')}`,
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
      issuer: identity.issuer,
      subjectHmac: identity.subjectHmac,
      clientHmac: createHash('sha256').update(identity.clientId).digest('hex'),
      authorizationId: identity.authorizationId,
      authorizationVersion: identity.authorizationVersion,
      tokenExpiresAt: new Date(baseTime + 3_600_000),
    });
  };
  return { state, requestContext, modern, legacy, fetch };
}

async function connect(test: ReturnType<typeof fixture>, era: Era) {
  const client = new Client(
    { name: `create-quiz-${era}-client`, version: '1.0.0' },
    {
      versionNegotiation:
        era === 'modern' ? { mode: { pin: '2026-07-28' } } : { mode: 'legacy' },
    },
  );
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: async () => 'create-quiz-e2e-token' },
    fetch: test.fetch as typeof fetch,
  });
  await client.connect(transport);
  return client;
}

async function close(
  client: Client | undefined,
  test: ReturnType<typeof fixture>,
) {
  if (client) await client.close();
  await test.modern.close();
  await test.legacy.close();
}

describe('English Learning MCP create_quiz with official clients', () => {
  it.each(['modern', 'legacy'] as const)(
    '%s creates one personalized answer-free owned exercise without learning writes',
    async (era) => {
      const test = fixture(era);
      const before = protectedSnapshot(test.state);
      let client: Client | undefined;
      try {
        client = await connect(test, era);
        const listed = await client.listTools();
        expect(listed.tools.map(({ name }) => name)).toEqual(['create_quiz']);
        const call = await client.callTool({
          name: 'create_quiz',
          arguments: quizInput,
        });
        const result = call.structuredContent;

        expect(call.isError).not.toBe(true);
        expect(mcpCreateQuizSuccessSchema.safeParse(result).success).toBe(true);
        expect(result).toMatchObject({
          status: 'ready',
          personalizationReason: expect.stringMatching(/agenda/iu),
          citations: [
            {
              citationId: 'cit_quiz_e2e_0001',
              contentVersion: 'course-meeting.v4',
              status: 'active',
            },
          ],
          replayed: false,
        });
        expect(JSON.stringify(result)).not.toMatch(
          /answerKey|correctAnswer|isCorrect|gradingRubric|rationale|systemPrompt/iu,
        );
        expect(test.state.exercises).toEqual([
          {
            id: 'exercise_quiz_e2e_0001',
            userId: test.requestContext.userId,
            status: 'READY',
            origin: 'MCP',
          },
        ]);
        expect(protectedSnapshot(test.state)).toEqual(before);
        expect(test.state.retrievalCalls).toBe(1);
        expect(test.state.modelCalls).toBe(1);
        expect(test.state.metrics).toEqual([
          expect.objectContaining({
            idempotencyOutcome: 'executed',
            modelExecuted: true,
            inputTokens: 120,
            outputTokens: 80,
            estimatedCostMicros: 3,
          }),
        ]);
        expect(test.state.traces).toHaveLength(1);
      } finally {
        await close(client, test);
      }
    },
  );

  it.each(['modern', 'legacy'] as const)(
    '%s replays the same quiz with no second retrieval, model call, or charge',
    async (era) => {
      const test = fixture(era);
      let client: Client | undefined;
      try {
        client = await connect(test, era);
        const first = await client.callTool({
          name: 'create_quiz',
          arguments: quizInput,
        });
        const replay = await client.callTool({
          name: 'create_quiz',
          arguments: quizInput,
        });

        expect(first.structuredContent).toMatchObject({ replayed: false });
        expect(replay.structuredContent).toMatchObject({
          exerciseId: 'exercise_quiz_e2e_0001',
          replayed: true,
        });
        expect(test.state.retrievalCalls).toBe(1);
        expect(test.state.modelCalls).toBe(1);
        expect(test.state.exercises).toHaveLength(1);
        expect(test.state.metrics).toHaveLength(2);
        expect(test.state.metrics[0]).toMatchObject({
          idempotencyOutcome: 'executed',
          estimatedCostMicros: 3,
        });
        expect(test.state.metrics[1]).toMatchObject({
          idempotencyOutcome: 'replayed',
          modelExecuted: false,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostMicros: 0,
        });
      } finally {
        await close(client, test);
      }
    },
  );

  it.each(['modern', 'legacy'] as const)(
    '%s rejects a stale source before envelope/model/exercise creation',
    async (era) => {
      const test = fixture(era);
      test.state.sourceActive = false;
      const before = protectedSnapshot(test.state);
      let client: Client | undefined;
      try {
        client = await connect(test, era);
        const result = await client.callTool({
          name: 'create_quiz',
          arguments: quizInput,
        });

        expect(result.isError).toBe(true);
        expect(test.state.retrievalCalls).toBe(1);
        expect(test.state.envelopeWrites).toBe(0);
        expect(test.state.modelCalls).toBe(0);
        expect(test.state.exercises).toEqual([]);
        expect(test.state.metrics).toEqual([
          expect.objectContaining({
            modelExecuted: false,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostMicros: 0,
          }),
        ]);
        expect(protectedSnapshot(test.state)).toEqual(before);
      } finally {
        await close(client, test);
      }
    },
  );

  it.each(['modern', 'legacy'] as const)(
    '%s cancels before dispatch with no retrieval, model, metric, or write',
    async (era) => {
      const test = fixture(era);
      const before = protectedSnapshot(test.state);
      let client: Client | undefined;
      try {
        client = await connect(test, era);
        const controller = new AbortController();
        controller.abort();
        await expect(
          client.callTool(
            { name: 'create_quiz', arguments: quizInput },
            { signal: controller.signal },
          ),
        ).rejects.toThrow();
        expect(test.state.retrievalCalls).toBe(0);
        expect(test.state.modelCalls).toBe(0);
        expect(test.state.metrics).toEqual([]);
        expect(test.state.exercises).toEqual([]);
        expect(protectedSnapshot(test.state)).toEqual(before);
      } finally {
        await close(client, test);
      }
    },
  );
});
