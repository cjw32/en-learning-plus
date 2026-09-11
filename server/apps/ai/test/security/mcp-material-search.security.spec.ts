import { resolve } from 'node:path';
import {
  MCP_SCHEMA_VERSION,
  mcpSearchMaterialsSuccessSchema,
} from '@en/common/mcp';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';

type Bridge = Readonly<{
  searchMaterials(input: unknown): Promise<unknown>;
}>;

type BridgeConstructor = new (materials: unknown) => Bridge;
type ToolConstructor = new (bridge: Bridge) => Readonly<{
  execute(input: unknown, context: McpRequestContext): Promise<unknown>;
}>;

function loadBridge(): BridgeConstructor {
  const bridgePath = resolve(
    __dirname,
    '../../src/coach/mcp/mcp-learning.bridge.ts',
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Bridge = require(bridgePath).McpLearningBridge as
    | BridgeConstructor
    | undefined;
  if (!Bridge) throw new Error('Missing MCP learning bridge');
  return Bridge;
}

function loadTool(): ToolConstructor {
  const toolPath = resolve(
    __dirname,
    '../../src/mcp/tools/search-learning-materials.tool.ts',
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Tool = require(toolPath).McpSearchLearningMaterialsTool as
    | ToolConstructor
    | undefined;
  if (!Tool) throw new Error('Missing MCP material Tool');
  return Tool;
}

const context: McpRequestContext = Object.freeze({
  principal: Object.freeze({
    issuer: 'https://issuer.mcp.test',
    subject: 'material-security-subject',
    audience: 'https://resource.mcp.test/ai/v1/mcp',
    clientId: 'material-security-client',
    scopes: Object.freeze(['learning:read'] as const),
    authorizationVersion: 1,
    issuedAtEpochSeconds: 1_789_117_140,
    notBeforeEpochSeconds: 1_789_117_140,
    expiresAtEpochSeconds: 1_789_120_800,
    verificationMethodVersion: 'fixture.v1',
  }),
  userId: 'learner_a',
  authorizationId: 'authorization_learner_a',
  requestId: 'request_material_security_0001',
  traceId: 'trace_material_security_0001',
  protocolVersion: '2026-07-28',
});

const input = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  query: 'opening a project meeting',
  categories: Object.freeze(['COURSE_LESSON'] as const),
  levels: Object.freeze(['B1'] as const),
  courseIds: Object.freeze(['course_business'] as const),
  topK: 8,
  minimumRelevance: 0.65,
});

function ragOutput(
  overrides: {
    result?: Record<string, unknown>;
    citation?: Record<string, unknown>;
    appliedFilters?: Record<string, unknown>;
  } = {},
) {
  const result = {
    resultId: 'result_material_0001',
    chunkId: 'chunk_material_0001',
    documentId: 'document_material_0001',
    citationId: 'cit_material_valid_001',
    source: 'course',
    sourceId: 'course:course_business:material_1',
    title: 'Leading a project meeting',
    category: 'COURSE_LESSON',
    excerpt: 'Open by stating the intended outcome.',
    level: 'B1',
    courseId: 'course_business',
    wordId: null,
    accessScope: 'OWNED_COURSE',
    rank: 1,
    relevanceScore: 0.91,
    contentVersion: 'course-release.v3',
    embeddingVersion: 'embedding.v2',
    status: 'valid',
    ...overrides.result,
  };
  const citation = {
    citationId: 'cit_material_valid_001',
    source: 'course',
    sourceId: 'course:course_business:material_1',
    title: 'Leading a project meeting',
    excerpt: 'Open by stating the intended outcome.',
    category: 'COURSE_LESSON',
    wordId: null,
    courseId: 'course_business',
    accessScope: 'OWNED_COURSE',
    status: 'active',
    usage: 'answer_evidence',
    ...overrides.citation,
  };
  return {
    schemaVersion: 'coach.tool.v2',
    ok: true,
    query: input.query,
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
      sourceRightsSnapshotVersion: 'rights.approved.v3',
      contentVersionPolicy: 'content-current.v1',
      chunkingVersion: 'chunking.v1',
      embeddingVersion: 'embedding.v2',
      retrievalConfigVersion: 'retrieval.v2',
      indexVersion: 'index.v7',
      ...overrides.appliedFilters,
    },
    results: [result],
    citations: [citation],
    conflicts: [],
    retrievalStatus: 'success',
  };
}

function fixture(output: unknown) {
  const searchV2 = jest.fn(async () => output);
  const Bridge = loadBridge();
  const Tool = loadTool();
  const bridge = new Bridge({ searchV2 });
  return { tool: new Tool(bridge), searchV2 };
}

async function expectInsufficient(
  invocation: Promise<unknown>,
  forbidden: string,
) {
  const result = await invocation;
  expect(mcpSearchMaterialsSuccessSchema.safeParse(result).success).toBe(true);
  expect(result).toMatchObject({
    schemaVersion: MCP_SCHEMA_VERSION,
    ok: true,
    retrievalStatus: 'insufficient',
    results: [],
    conflicts: [],
    traceId: context.traceId,
  });
  expect(JSON.stringify(result)).not.toContain(forbidden);
}

describe('MCP learning-material RAG provenance and source safety', () => {
  it('bridge exposes only the approved read method and reuses searchV2', async () => {
    const searchV2 = jest.fn(async () => ragOutput());
    const forbiddenWrite = jest.fn();
    const Bridge = loadBridge();
    const bridge = new Bridge({ searchV2, saveAttempt: forbiddenWrite });

    const result = await bridge.searchMaterials({
      userId: context.userId,
      requestId: context.requestId,
      traceId: context.traceId,
      input,
    });

    expect(Object.getOwnPropertyNames(Bridge.prototype).sort()).toEqual([
      'constructor',
      'createQuiz',
      'prepareSubmitAnswer',
      'searchMaterials',
    ]);
    expect(result).toMatchObject({ retrievalStatus: 'success' });
    expect(searchV2).toHaveBeenCalledWith(
      context.userId,
      expect.objectContaining({
        schemaVersion: 'coach.tool.v2',
        query: input.query,
        filters: expect.objectContaining({
          categories: ['COURSE_LESSON'],
          courseIds: ['course_business'],
        }),
      }),
      expect.objectContaining({ requestId: context.requestId }),
      undefined,
    );
    expect(forbiddenWrite).not.toHaveBeenCalled();
  });

  it('returns only a passage backed by the matching current authorized chunk citation', async () => {
    const test = fixture(ragOutput());

    const result = await test.tool.execute(input, context);

    expect(mcpSearchMaterialsSuccessSchema.safeParse(result).success).toBe(
      true,
    );
    expect(result).toMatchObject({
      ok: true,
      retrievalStatus: 'success',
      results: [
        {
          resultId: 'result_material_0001',
          contentVersion: 'course-release.v3',
          citation: {
            citationId: 'cit_material_valid_001',
            source: 'course',
            contentVersion: 'course-release.v3',
            accessScope: 'OWNED_COURSE',
            status: 'active',
          },
        },
      ],
    });
    expect(test.searchV2).toHaveBeenCalledTimes(1);
    expect(test.searchV2.mock.calls[0]?.[0]).toBe(context.userId);
  });

  it('drops a fabricated citation that was not issued for the returned chunk', async () => {
    const test = fixture(
      ragOutput({
        result: { citationId: 'cit_fabricated_0001' },
      }),
    );
    await expectInsufficient(
      test.tool.execute(input, context),
      'cit_fabricated_0001',
    );
  });

  it.each([
    {
      name: 'stale embedding/index hit',
      forbidden: 'stale embedding excerpt',
      output: ragOutput({
        result: {
          excerpt: 'stale embedding excerpt',
          embeddingVersion: 'embedding.v1',
        },
      }),
    },
    {
      name: 'course hit outside the authorized filter',
      forbidden: 'unauthorized course excerpt',
      output: ragOutput({
        result: {
          excerpt: 'unauthorized course excerpt',
          courseId: 'course_private_b',
          sourceId: 'course:course_private_b:material_9',
        },
        citation: {
          excerpt: 'unauthorized course excerpt',
          courseId: 'course_private_b',
          sourceId: 'course:course_private_b:material_9',
        },
      }),
    },
    {
      name: 'revoked or deleted source citation',
      forbidden: 'revoked source excerpt',
      output: ragOutput({
        result: { excerpt: 'revoked source excerpt' },
        citation: {
          excerpt: 'revoked source excerpt',
          status: 'unavailable',
        },
      }),
    },
    {
      name: 'content mismatch between result and citation',
      forbidden: 'mismatched citation excerpt',
      output: ragOutput({
        citation: { excerpt: 'mismatched citation excerpt' },
      }),
    },
  ])(
    'drops $name rather than returning unverified evidence',
    async ({ output, forbidden }) => {
      const test = fixture(output);
      await expectInsufficient(test.tool.execute(input, context), forbidden);
    },
  );

  it('preserves an explicit empty/insufficient retrieval without inventing a citation', async () => {
    const empty = ragOutput();
    empty.results = [];
    empty.citations = [];
    empty.retrievalStatus = 'insufficient';
    const test = fixture(empty);

    await expectInsufficient(test.tool.execute(input, context), 'cit_');
  });
});
