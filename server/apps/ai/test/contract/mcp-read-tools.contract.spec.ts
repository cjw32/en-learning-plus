import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MCP_SCHEMA_VERSION,
  mcpGetDueWordsInputSchema,
  mcpGetDueWordsSuccessSchema,
  mcpGetLearningReportInputSchema,
  mcpLearningReportSuccessSchema,
  mcpSafeErrorSchema,
  mcpSearchMaterialsInputSchema,
  mcpSearchMaterialsSuccessSchema,
  mcpSearchWordsInputSchema,
  mcpSearchWordsSuccessSchema,
} from '@en/common/mcp';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';

type Schema = Readonly<{
  safeParse(value: unknown): Readonly<{ success: boolean }>;
}>;

type ToolDefinition = Readonly<{
  description: string;
  inputSchema: Schema;
  outputSchema: Schema;
  annotations: Readonly<{
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  }>;
  _meta: Readonly<Record<string, unknown>>;
}>;

type ReadTool = Readonly<{
  name: string;
  definition: ToolDefinition;
  execute(input: unknown, context: McpRequestContext): Promise<unknown>;
}>;

type ReadToolConstructor = new (service: unknown) => ReadTool;

const toolRoot = resolve(__dirname, '../../src/mcp/tools');

function loadTool(fileName: string, exportName: string): ReadToolConstructor {
  const path = resolve(toolRoot, fileName);
  if (!existsSync(path)) {
    throw new Error(`Missing MCP read Tool ${fileName} (${exportName})`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Tool = require(path)[exportName] as ReadToolConstructor | undefined;
  if (!Tool) throw new Error(`Missing ${exportName} export from ${fileName}`);
  return Tool;
}

const context: McpRequestContext = Object.freeze({
  principal: Object.freeze({
    issuer: 'https://issuer.mcp.test',
    subject: 'read-tool-contract-subject',
    audience: 'https://resource.mcp.test/ai/v1/mcp',
    clientId: 'read-tool-contract-client',
    scopes: Object.freeze(['learning:read'] as const),
    authorizationVersion: 1,
    issuedAtEpochSeconds: 1_789_117_140,
    notBeforeEpochSeconds: 1_789_117_140,
    expiresAtEpochSeconds: 1_789_120_800,
    verificationMethodVersion: 'fixture.v1',
  }),
  userId: 'learner_contract_a',
  authorizationId: 'authorization_contract_a',
  requestId: 'request_read_tool_contract_0001',
  traceId: 'trace_read_tool_contract_0001',
  protocolVersion: '2026-07-28',
});

const citation = Object.freeze({
  citationId: 'cit_material_contract_001',
  source: 'owned-course-release',
  title: 'Leading a project meeting',
  excerpt: 'Open the meeting by stating the intended outcome.',
  contentVersion: 'course-release.v3',
  accessScope: 'OWNED_COURSE' as const,
  status: 'active' as const,
});

type ContractCase = Readonly<{
  name: string;
  fileName: string;
  exportName: string;
  inputSchema: Schema;
  outputSchema: Schema;
  deadlineMs: number;
  budgetPolicy: 'none' | 'mcp-rag-read.v1';
  validInput: unknown;
  invalidInputs: readonly unknown[];
  serviceFixture(): Readonly<{
    service: object;
    calls: readonly jest.Mock[];
  }>;
}>;

const cases: readonly ContractCase[] = [
  {
    name: 'search_words',
    fileName: 'search-words.tool.ts',
    exportName: 'McpSearchWordsTool',
    inputSchema: mcpSearchWordsInputSchema,
    outputSchema: mcpSearchWordsSuccessSchema,
    deadlineMs: 3_000,
    budgetPolicy: 'none',
    validInput: {
      schemaVersion: MCP_SCHEMA_VERSION,
      query: 'practice',
      cefr: 'A2',
      limit: 10,
    },
    invalidInputs: [
      {
        schemaVersion: MCP_SCHEMA_VERSION,
        query: 'practice',
        limit: 10,
        userId: 'learner_b',
      },
      {
        schemaVersion: MCP_SCHEMA_VERSION,
        query: 'x'.repeat(201),
        limit: 51,
      },
    ],
    serviceFixture: () => {
      const search = jest.fn(async () => ({
        items: [
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
            source: citation,
            contentVersion: 'word-source.v1',
            updatedAt: new Date('2026-09-11T08:00:00.000Z'),
          },
        ],
        hasMore: false,
      }));
      return { service: { search }, calls: [search] };
    },
  },
  {
    name: 'get_due_words',
    fileName: 'get-due-words.tool.ts',
    exportName: 'McpGetDueWordsTool',
    inputSchema: mcpGetDueWordsInputSchema,
    outputSchema: mcpGetDueWordsSuccessSchema,
    deadlineMs: 3_000,
    budgetPolicy: 'none',
    validInput: {
      schemaVersion: MCP_SCHEMA_VERSION,
      learningDate: '2026-09-11',
      timezone: 'Asia/Shanghai',
      courseId: 'course_business',
      limit: 20,
    },
    invalidInputs: [
      {
        schemaVersion: MCP_SCHEMA_VERSION,
        learningDate: '2026-09-11',
        timezone: 'Asia/Shanghai',
        limit: 20,
        subject: 'another-user',
      },
      {
        schemaVersion: MCP_SCHEMA_VERSION,
        learningDate: '11/09/2026',
        timezone: 'Asia/Shanghai',
        limit: 101,
      },
    ],
    serviceFixture: () => {
      const getDueWords = jest.fn(async () => ({
        asOf: new Date('2026-09-11T08:00:00.000Z'),
        words: [
          {
            wordId: 'word_practice',
            word: 'practice',
            definition: 'to do something repeatedly to improve',
            translation: '练习',
            reviewState: 'REVIEW',
            dueAt: new Date('2026-09-11T07:30:00.000Z'),
            lastQuality: 2,
            priority: 1,
            reason: 'Scheduled review is due.',
            citation,
          },
        ],
        totalDue: 1,
        truncated: false,
      }));
      return { service: { getDueWords }, calls: [getDueWords] };
    },
  },
  {
    name: 'search_learning_materials',
    fileName: 'search-learning-materials.tool.ts',
    exportName: 'McpSearchLearningMaterialsTool',
    inputSchema: mcpSearchMaterialsInputSchema,
    outputSchema: mcpSearchMaterialsSuccessSchema,
    deadlineMs: 5_000,
    budgetPolicy: 'mcp-rag-read.v1',
    validInput: {
      schemaVersion: MCP_SCHEMA_VERSION,
      query: 'How should I open a project meeting?',
      categories: ['COURSE_LESSON'],
      levels: ['B1'],
      courseIds: ['course_business'],
      topK: 8,
      minimumRelevance: 0.65,
    },
    invalidInputs: [
      {
        schemaVersion: MCP_SCHEMA_VERSION,
        query: 'meeting',
        categories: ['COURSE_LESSON'],
        topK: 8,
        userId: 'learner_b',
      },
      {
        schemaVersion: MCP_SCHEMA_VERSION,
        query: 'x'.repeat(1_001),
        categories: ['SYSTEM_PROMPT'],
        topK: 21,
      },
    ],
    serviceFixture: () => {
      const searchMaterials = jest.fn(async () => ({
        retrievalStatus: 'success',
        results: [
          {
            resultId: 'result_contract_001',
            title: 'Leading a project meeting',
            category: 'COURSE_LESSON',
            excerpt: 'Open the meeting by stating the intended outcome.',
            rank: 1,
            relevanceScore: 0.91,
            contentVersion: 'course-release.v3',
            citation,
          },
        ],
        conflicts: [],
      }));
      return { service: { searchMaterials }, calls: [searchMaterials] };
    },
  },
  {
    name: 'get_learning_report',
    fileName: 'get-learning-report.tool.ts',
    exportName: 'McpGetLearningReportTool',
    inputSchema: mcpGetLearningReportInputSchema,
    outputSchema: mcpLearningReportSuccessSchema,
    deadlineMs: 5_000,
    budgetPolicy: 'none',
    validInput: {
      schemaVersion: MCP_SCHEMA_VERSION,
      from: '2026-09-05',
      to: '2026-09-11',
      dimensions: ['progress', 'review', 'weaknesses'],
      limit: 20,
    },
    invalidInputs: [
      {
        schemaVersion: MCP_SCHEMA_VERSION,
        limit: 20,
        userId: 'learner_b',
      },
      {
        schemaVersion: MCP_SCHEMA_VERSION,
        from: '2026-01-01',
        to: '2026-09-11',
        dimensions: ['database'],
        limit: 51,
      },
    ],
    serviceFixture: () => {
      const getSummary = jest.fn(async () => ({
        report: {
          windowStart: '2026-09-05',
          windowEnd: '2026-09-11',
          attemptCount: 7,
          averageScore: 86,
          reviewsDue: 3,
          reviewsCompleted: 2,
          learnedWordCount: 12,
          dataCompleteness: 'complete',
          policyVersion: 'learning-report.v1',
        },
        contentVersion: 'report-content.v1',
        updatedAt: new Date('2026-09-11T08:00:00.000Z'),
      }));
      const getWeaknesses = jest.fn(async () => ({
        dataCompleteness: 'complete',
        items: [
          {
            type: 'error_type',
            key: 'article_usage',
            label: 'Article usage',
            count: 3,
            lastSeenAt: '2026-09-10T08:00:00.000Z',
            evidenceStatus: 'current',
          },
        ],
        truncated: false,
        nextPosition: null,
        contentVersion: 'report-content.v1',
        updatedAt: new Date('2026-09-11T08:00:00.000Z'),
      }));
      return {
        service: { getSummary, getWeaknesses },
        calls: [getSummary, getWeaknesses],
      };
    },
  },
] as const;

async function expectValidationFailure(
  invocation: Promise<unknown>,
): Promise<void> {
  try {
    const result = await invocation;
    expect(mcpSafeErrorSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  } catch (error) {
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
  }
}

describe('MCP read Tool contracts', () => {
  it.each(cases)(
    '$name exposes complete discovery metadata and the exact runtime schemas',
    (contractCase) => {
      const fixture = contractCase.serviceFixture();
      const Tool = loadTool(contractCase.fileName, contractCase.exportName);
      const tool = new Tool(fixture.service);

      expect(tool.name).toBe(contractCase.name);
      expect(tool.definition.description.length).toBeGreaterThan(20);
      expect(tool.definition.inputSchema).toBe(contractCase.inputSchema);
      expect(tool.definition.outputSchema).toBe(contractCase.outputSchema);
      expect(tool.definition.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.definition._meta).toEqual({
        'en-learning/schemaVersion': MCP_SCHEMA_VERSION,
        'en-learning/requiredScopes': ['learning:read'],
        'en-learning/effect': 'read',
        'en-learning/confirmation': 'none',
        'en-learning/idempotency': 'safe_repeat',
        'en-learning/maxResultBytes': 256 * 1024,
        'en-learning/deadlineMs': contractCase.deadlineMs,
        'en-learning/rateLimitPolicy': 'mcp-read.v1',
        'en-learning/budgetPolicy': contractCase.budgetPolicy,
        'en-learning/retryPolicy': 'safe-read.v1',
        'en-learning/degradation': 'empty-success-or-stable-error',
        'en-learning/operationId': `mcp.tool.${contractCase.name}.v1`,
      });

      expect(
        tool.definition.inputSchema.safeParse(contractCase.validInput).success,
      ).toBe(true);
      for (const invalid of contractCase.invalidInputs) {
        expect(tool.definition.inputSchema.safeParse(invalid).success).toBe(
          false,
        );
      }
    },
  );

  it.each(cases)(
    '$name returns a result accepted by its advertised output schema',
    async (contractCase) => {
      const fixture = contractCase.serviceFixture();
      const Tool = loadTool(contractCase.fileName, contractCase.exportName);
      const tool = new Tool(fixture.service);

      const result = await tool.execute(contractCase.validInput, context);

      expect(tool.definition.outputSchema.safeParse(result).success).toBe(true);
      expect(result).toMatchObject({
        schemaVersion: MCP_SCHEMA_VERSION,
        ok: true,
        traceId: context.traceId,
      });
      expect(fixture.calls.some((call) => call.mock.calls.length > 0)).toBe(
        true,
      );
    },
  );

  it.each(cases)(
    '$name rejects invalid and identity-bearing inputs before business calls',
    async (contractCase) => {
      for (const invalidInput of contractCase.invalidInputs) {
        const fixture = contractCase.serviceFixture();
        const Tool = loadTool(contractCase.fileName, contractCase.exportName);
        const tool = new Tool(fixture.service);

        await expectValidationFailure(tool.execute(invalidInput, context));

        for (const call of fixture.calls) expect(call).not.toHaveBeenCalled();
      }
    },
  );
});
