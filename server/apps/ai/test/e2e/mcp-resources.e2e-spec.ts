import { createHash } from 'node:crypto';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { McpCursorService } from '../../src/mcp/pagination/mcp-cursor.service';
import { McpCourseMaterialResource } from '../../src/mcp/resources/course-material.resource';
import { McpResourceRegistry } from '../../src/mcp/resources/mcp-resource.registry';
import { McpReportSummaryResource } from '../../src/mcp/resources/report-summary.resource';
import { McpReviewsTodayResource } from '../../src/mcp/resources/reviews-today.resource';
import { McpWeaknessesResource } from '../../src/mcp/resources/weaknesses.resource';
import { McpWordResource } from '../../src/mcp/resources/word.resource';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';
import { McpLegacySessionManager } from '../../src/mcp/transport/mcp-legacy-session.manager';
import { McpModernTransportFactory } from '../../src/mcp/transport/mcp-modern-transport.factory';

const endpoint = new URL('https://resource.mcp.test/ai/v1/mcp');
const now = new Date('2026-09-11T08:00:00.000Z');

type UserId = 'learner_a' | 'learner_b';

type State = {
  active: Record<UserId, boolean>;
  deleted: Record<UserId, boolean>;
  wordRightsActive: boolean;
  courseRightsActive: boolean;
  entitled: Record<UserId, boolean>;
  modelCalls: number;
  learningWrites: number;
};

class MemorySessionStore {
  private readonly sessions = new Map<string, any>();

  async save(session: any) {
    this.sessions.set(session.sessionId, session);
  }

  async load(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string) {
    this.sessions.delete(sessionId);
  }
}

function context(userId: UserId): McpRequestContext {
  const suffix = userId === 'learner_a' ? 'a' : 'b';
  return Object.freeze({
    principal: Object.freeze({
      issuer: 'https://issuer.mcp.test',
      subject: `resource-e2e-subject-${suffix}`,
      audience: endpoint.href,
      clientId: `resource-e2e-client-${suffix}`,
      scopes: Object.freeze(['learning:read'] as const),
      authorizationVersion: 1,
      issuedAtEpochSeconds: Math.floor(now.getTime() / 1_000) - 60,
      notBeforeEpochSeconds: Math.floor(now.getTime() / 1_000) - 60,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 3_600,
      verificationMethodVersion: 'resource-e2e.v1',
    }),
    userId,
    authorizationId: `authorization_resource_${suffix}`,
    requestId: `request_resource_${suffix}`,
    traceId: `trace_resource_${suffix}_0001`,
    protocolVersion: '2026-07-28',
  });
}

function error(code: string) {
  return Object.assign(new Error('The resource is unavailable.'), { code });
}

function createRegistry(state: State, requestContext: McpRequestContext) {
  const word = new McpWordResource({
    get: async ({ wordId }) => {
      if (!state.wordRightsActive) throw error('SOURCE_RIGHTS_DENIED');
      const contentVersion = 'word-content.v1';
      return {
        word: {
          wordId,
          word: wordId === 'word_practice' ? 'practice' : 'unknown',
          definition: 'to repeat an activity to improve',
          translation: '练习',
          partOfSpeech: 'verb',
          phonetic: '/ˈpræktɪs/',
          cefr: 'A2' as const,
          availability: 'available' as const,
          contentVersion,
        },
        forms: ['practice', 'practiced', 'practicing'],
        examples: ['I practice English every day.'],
        source: {
          citationId: 'cit_resource_word_0001',
          source: 'approved-word-source',
          title: 'Approved word source',
          excerpt: 'to repeat an activity to improve',
          contentVersion,
          accessScope: 'PUBLIC' as const,
          status: 'active' as const,
        },
        contentVersion,
        updatedAt: now,
      };
    },
  } as never);
  const course = new McpCourseMaterialResource({
    readCourseMaterial: async ({ userId, courseId, materialId }) => {
      if (
        !state.courseRightsActive ||
        !state.entitled[userId as UserId] ||
        courseId !== 'course_business' ||
        materialId !== 'material_meeting_1'
      ) {
        throw error('RESOURCE_NOT_FOUND');
      }
      return {
        courseId,
        materialId,
        title: 'Leading a project meeting',
        summary: 'Open with an objective and close with owners and deadlines.',
        locator: `course/${courseId}/materials/${materialId}`,
        source: {
          citationId: 'cit_resource_course_001',
          source: 'approved-course-source',
          title: 'Approved course release',
          excerpt: 'Open with an objective.',
          contentVersion: 'course-release.v3',
          accessScope: 'OWNED_COURSE' as const,
          status: 'active' as const,
        },
        contentVersion: 'course-release.v3',
        updatedAt: now,
      };
    },
  } as never);

  const dueItems =
    requestContext.userId === 'learner_a'
      ? [
          {
            wordId: 'word_a',
            word: 'agenda',
            reviewState: 'REVIEW' as const,
            dueAt: '2026-09-11T07:00:00.000Z',
            priority: 1,
            reason: 'Scheduled review is due.',
          },
          {
            wordId: 'word_b',
            word: 'budget',
            reviewState: 'LEARNING' as const,
            dueAt: '2026-09-11T07:30:00.000Z',
            priority: 2,
            reason: 'Recent evidence is weak.',
          },
        ]
      : [];
  const reports = {
    getDueReviews: async (input: any) => {
      const start = input.position?.tieBreaker === 'word_a' ? 1 : 0;
      const items = dueItems.slice(start, start + input.limit);
      const truncated = start + items.length < dueItems.length;
      const last = items.at(-1);
      return {
        learningDate: '2026-09-11',
        timezone: 'Asia/Shanghai',
        totalDue: dueItems.length,
        items,
        truncated,
        nextPosition:
          truncated && last
            ? { sortValue: last.dueAt, tieBreaker: last.wordId }
            : null,
        contentVersion: `report-${requestContext.userId}.v1`,
        updatedAt: now,
      };
    },
    getSummary: async () => ({
      report: {
        windowStart: '2026-09-05',
        windowEnd: '2026-09-11',
        attemptCount: requestContext.userId === 'learner_a' ? 4 : 0,
        averageScore: requestContext.userId === 'learner_a' ? 85 : null,
        reviewsDue: dueItems.length,
        reviewsCompleted: 0,
        learnedWordCount: requestContext.userId === 'learner_a' ? 12 : 0,
        dataCompleteness:
          requestContext.userId === 'learner_a'
            ? ('complete' as const)
            : ('insufficient' as const),
        policyVersion: 'learning-report.v1',
      },
      contentVersion: `report-${requestContext.userId}.v1`,
      updatedAt: now,
    }),
    getWeaknesses: async (input: any) => {
      const all =
        requestContext.userId === 'learner_a'
          ? [
              {
                type: 'error_type' as const,
                key: 'article_usage',
                label: 'Article usage',
                count: 3,
                lastSeenAt: '2026-09-10T08:00:00.000Z',
                evidenceStatus: 'current' as const,
              },
            ]
          : [];
      return {
        dataCompleteness: all.length
          ? ('complete' as const)
          : ('insufficient' as const),
        items: all.slice(0, input.limit),
        truncated: false,
        nextPosition: null,
        contentVersion: `report-${requestContext.userId}.v1`,
        updatedAt: now,
      };
    },
  };
  const cursors = new McpCursorService({
    hmacKey: 'mcp-resource-e2e-cursor-key-at-least-32-bytes',
    ttlMs: 5 * 60 * 1_000,
    now: () => now,
  });
  return new McpResourceRegistry({
    authorization: {
      assertActive: async (current) => {
        const userId = current.userId as UserId;
        if (!state.active[userId] || state.deleted[userId]) {
          throw error('UNAUTHENTICATED');
        }
        if (!current.principal.scopes.includes('learning:read')) {
          throw error('INSUFFICIENT_SCOPE');
        }
      },
    },
    handlers: {
      word,
      courseMaterial: course,
      reviewsToday: new McpReviewsTodayResource(reports as never, cursors),
      reportSummary: new McpReportSummaryResource(reports as never),
      weaknesses: new McpWeaknessesResource(reports as never, cursors),
    },
  });
}

function resourceServer(
  registry: McpResourceRegistry,
  requestContext: McpRequestContext,
) {
  const server = new McpServer({
    name: 'english-learning-resource-e2e',
    version: '1.0.0',
  });
  registry.register(server, requestContext);
  return server;
}

function fixture(userId: UserId) {
  const state: State = {
    active: { learner_a: true, learner_b: true },
    deleted: { learner_a: false, learner_b: false },
    wordRightsActive: true,
    courseRightsActive: true,
    entitled: { learner_a: true, learner_b: false },
    modelCalls: 0,
    learningWrites: 0,
  };
  const requestContext = context(userId);
  const registry = createRegistry(state, requestContext);
  let sessionSequence = 0;
  const modern = new McpModernTransportFactory({
    createServer: () => resourceServer(registry, requestContext),
  });
  const legacy = new McpLegacySessionManager({
    createServer: () => resourceServer(registry, requestContext),
    store: new MemorySessionStore(),
    now: () => now,
    sessionId: () =>
      `legacy_resource_${String(++sessionSequence).padStart(20, '0')}`,
    idleTtlMs: 15 * 60 * 1_000,
    absoluteTtlMs: 60 * 60 * 1_000,
  });
  const fetchFor =
    (era: 'modern' | 'legacy') =>
    async (input: string | URL | globalThis.Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (!state.active[userId] || state.deleted[userId]) {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32001, message: 'Authentication required.' },
          },
          { status: 401 },
        );
      }
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
  return { state, requestContext, registry, modern, legacy, fetchFor };
}

async function connect(
  test: ReturnType<typeof fixture>,
  era: 'modern' | 'legacy',
) {
  const client = new Client(
    { name: `resource-${era}-client`, version: '1.0.0' },
    {
      versionNegotiation:
        era === 'modern' ? { mode: { pin: '2026-07-28' } } : { mode: 'legacy' },
    },
  );
  const transport = new StreamableHTTPClientTransport(endpoint, {
    authProvider: { token: async () => `${test.requestContext.userId}-token` },
    fetch: test.fetchFor(era) as typeof fetch,
  });
  await client.connect(transport);
  return client;
}

async function readJson(client: Client, uri: string): Promise<any> {
  const result = await client.readResource({ uri });
  const content = result.contents[0] as { text?: string };
  if (!content?.text) throw new Error('Missing JSON Resource content');
  return JSON.parse(content.text);
}

const fiveUris = [
  'en-learning://words/word_practice',
  'en-learning://courses/course_business/materials/material_meeting_1',
  'en-learning://me/reviews/today',
  'en-learning://me/reports/summary',
  'en-learning://me/weaknesses',
] as const;

describe('English Learning MCP Resources with official clients', () => {
  it.each(['modern', 'legacy'] as const)(
    '%s reads all five authorized Resources without model calls or writes',
    async (era) => {
      const test = fixture('learner_a');
      const client = await connect(test, era);
      try {
        const [templates, resources] = await Promise.all([
          client.listResourceTemplates(),
          client.listResources(),
        ]);
        expect(
          templates.resourceTemplates.map(({ uriTemplate }) => uriTemplate),
        ).toEqual(
          fiveUris
            .slice(0, 2)
            .map((uri) =>
              uri
                .replace('word_practice', '{wordId}')
                .replace('course_business', '{courseId}')
                .replace('material_meeting_1', '{materialId}'),
            ),
        );
        expect(resources.resources.map(({ uri }) => uri)).toEqual(
          fiveUris.slice(2),
        );
        const contents = await Promise.all(
          fiveUris.map((uri) => readJson(client, uri)),
        );
        expect(contents.map(({ kind }) => kind)).toEqual([
          'word',
          'course_material',
          'today_reviews',
          'learning_report',
          'weaknesses',
        ]);
        expect(test.state).toMatchObject({ modelCalls: 0, learningWrites: 0 });
      } finally {
        await client.close();
        await test.modern.close();
        await test.legacy.close();
      }
    },
  );

  it('keeps two learners isolated and returns legal empty states', async () => {
    const testA = fixture('learner_a');
    const testB = fixture('learner_b');
    const clientA = await connect(testA, 'modern');
    const clientB = await connect(testB, 'legacy');
    try {
      const [reviewsA, reviewsB, reportB] = await Promise.all([
        readJson(clientA, 'en-learning://me/reviews/today'),
        readJson(clientB, 'en-learning://me/reviews/today'),
        readJson(clientB, 'en-learning://me/reports/summary'),
      ]);
      expect(reviewsA.items.map(({ wordId }: any) => wordId)).toEqual([
        'word_a',
        'word_b',
      ]);
      expect(reviewsB.items).toEqual([]);
      expect(reportB.report).toMatchObject({
        attemptCount: 0,
        averageScore: null,
        dataCompleteness: 'insufficient',
      });
      await expect(
        readJson(
          clientB,
          'en-learning://courses/course_business/materials/material_meeting_1',
        ),
      ).rejects.toThrow();
    } finally {
      await Promise.all([clientA.close(), clientB.close()]);
      await Promise.all([
        testA.modern.close(),
        testA.legacy.close(),
        testB.modern.close(),
        testB.legacy.close(),
      ]);
    }
  });

  it.each(['modern', 'legacy'] as const)(
    '%s fails closed after source-rights revocation and account deletion',
    async (era) => {
      const test = fixture('learner_a');
      const client = await connect(test, era);
      try {
        test.state.wordRightsActive = false;
        await expect(
          readJson(client, 'en-learning://words/word_practice'),
        ).rejects.toThrow();
        test.state.wordRightsActive = true;
        test.state.courseRightsActive = false;
        await expect(
          readJson(
            client,
            'en-learning://courses/course_business/materials/material_meeting_1',
          ),
        ).rejects.toThrow();
        test.state.deleted.learner_a = true;
        await expect(
          readJson(client, 'en-learning://me/reports/summary'),
        ).rejects.toThrow();
        expect(test.state).toMatchObject({ modelCalls: 0, learningWrites: 0 });
      } finally {
        await client.close();
        await test.modern.close();
        await test.legacy.close();
      }
    },
  );

  it('paginates a private Resource with a principal/content-bound cursor', async () => {
    const test = fixture('learner_a');
    const first = (await test.registry.read(
      { uri: 'en-learning://me/reviews/today', limit: 1 },
      test.requestContext,
    )) as any;
    expect(first.items.map(({ wordId }: any) => wordId)).toEqual(['word_a']);
    expect(first.meta.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const second = (await test.registry.read(
      {
        uri: 'en-learning://me/reviews/today',
        limit: 1,
        cursor: first.meta.nextCursor,
      },
      test.requestContext,
    )) as any;
    expect(second.items.map(({ wordId }: any) => wordId)).toEqual(['word_b']);
    expect(second.meta.nextCursor).toBeNull();
    await test.modern.close();
    await test.legacy.close();
  });
});
