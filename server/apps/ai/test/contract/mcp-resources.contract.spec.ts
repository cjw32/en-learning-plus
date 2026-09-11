import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mcpCourseMaterialResourceSchema,
  mcpReportResourceSchema,
  mcpReviewsResourceSchema,
  mcpWeaknessResourceSchema,
  mcpWordResourceSchema,
} from '@en/common/mcp';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';

type ResourceHandler = Readonly<{
  read(input: unknown, context: McpRequestContext): Promise<unknown>;
}>;

type ResourceHandlerConstructor = new (service: unknown) => ResourceHandler;

const sourceRoot = resolve(__dirname, '../../src/mcp/resources');
const dictionaryServicePath = resolve(
  __dirname,
  '../../../../libs/learning/src/dictionary/word-dictionary.service.ts',
);

function loadHandler(
  fileName: string,
  exportName: string,
): ResourceHandlerConstructor {
  const path = resolve(sourceRoot, fileName);
  if (!existsSync(path)) {
    throw new Error(`Missing MCP Resource handler ${fileName} (${exportName})`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Handler = require(path)[exportName] as
    | ResourceHandlerConstructor
    | undefined;
  if (!Handler)
    throw new Error(`Missing ${exportName} export from ${fileName}`);
  return Handler;
}

const context: McpRequestContext = Object.freeze({
  principal: Object.freeze({
    issuer: 'https://issuer.mcp.test',
    subject: 'resource-contract-subject',
    audience: 'https://resource.mcp.test/ai/v1/mcp',
    clientId: 'resource-contract-client',
    scopes: Object.freeze(['learning:read'] as const),
    authorizationVersion: 1,
    issuedAtEpochSeconds: 1_789_117_140,
    notBeforeEpochSeconds: 1_789_117_140,
    expiresAtEpochSeconds: 1_789_120_800,
    verificationMethodVersion: 'fixture.v1',
  }),
  userId: 'learner_contract_a',
  authorizationId: 'authorization_contract_a',
  requestId: 'request_contract_resource_0001',
  traceId: 'trace_contract_resource_0001',
  protocolVersion: '2026-07-28',
});

const meta = Object.freeze({
  schemaVersion: 'en-learning.mcp.v1' as const,
  contentVersion: 'content.2026-09-11.1',
  updatedAt: '2026-09-11T08:00:00.000Z',
  truncated: false,
  nextCursor: null,
  traceId: context.traceId,
});

const publicCitation = Object.freeze({
  citationId: 'cit_word_contract_001',
  source: 'approved-word-source',
  title: 'Practice',
  excerpt: 'to do something repeatedly to improve',
  contentVersion: 'word-source.v1',
  accessScope: 'PUBLIC' as const,
  status: 'active' as const,
});

const ownedCourseCitation = Object.freeze({
  citationId: 'cit_course_contract_001',
  source: 'owned-course-release',
  title: 'Meeting practice',
  contentVersion: 'course-release.v3',
  accessScope: 'OWNED_COURSE' as const,
  status: 'active' as const,
});

const validCases = [
  {
    name: 'word template',
    fileName: 'word.resource.ts',
    exportName: 'McpWordResource',
    serviceMethod: 'get',
    request: { uri: 'en-learning://words/word_practice' },
    expectedServiceInput: {
      wordId: 'word_practice',
    },
    serviceResult: {
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
      forms: ['practice', 'practices', 'practiced', 'practicing'],
      examples: ['I practice English every day.'],
      source: publicCitation,
      contentVersion: meta.contentVersion,
      updatedAt: new Date(meta.updatedAt),
    },
    result: {
      kind: 'word',
      uri: 'en-learning://words/word_practice',
      meta,
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
      forms: ['practice', 'practices', 'practiced', 'practicing'],
      examples: ['I practice English every day.'],
      source: publicCitation,
    },
    schema: mcpWordResourceSchema,
  },
  {
    name: 'course-material template',
    fileName: 'course-material.resource.ts',
    exportName: 'McpCourseMaterialResource',
    serviceMethod: 'readCourseMaterial',
    request: {
      uri: 'en-learning://courses/course_business/materials/material_meeting_1',
    },
    expectedServiceInput: {
      userId: context.userId,
      courseId: 'course_business',
      materialId: 'material_meeting_1',
    },
    serviceResult: {
      courseId: 'course_business',
      materialId: 'material_meeting_1',
      title: 'Leading a project meeting',
      summary: 'Practice opening, guiding, and closing a project meeting.',
      locator: 'unit-3/lesson-2',
      source: ownedCourseCitation,
      contentVersion: meta.contentVersion,
      updatedAt: new Date(meta.updatedAt),
    },
    result: {
      kind: 'course_material',
      uri: 'en-learning://courses/course_business/materials/material_meeting_1',
      meta,
      courseId: 'course_business',
      materialId: 'material_meeting_1',
      title: 'Leading a project meeting',
      summary: 'Practice opening, guiding, and closing a project meeting.',
      locator: 'unit-3/lesson-2',
      source: ownedCourseCitation,
    },
    schema: mcpCourseMaterialResourceSchema,
  },
  {
    name: 'today reviews',
    fileName: 'reviews-today.resource.ts',
    exportName: 'McpReviewsTodayResource',
    serviceMethod: 'getDueReviews',
    request: { uri: 'en-learning://me/reviews/today', limit: 20 },
    expectedServiceInput: {
      userId: context.userId,
      limit: 20,
      cursor: undefined,
    },
    serviceResult: {
      learningDate: '2026-09-11',
      timezone: 'Asia/Shanghai',
      totalDue: 1,
      items: [
        {
          wordId: 'word_practice',
          word: 'practice',
          reviewState: 'REVIEW',
          dueAt: '2026-09-11T07:30:00.000Z',
          priority: 10,
          reason: 'Scheduled review is due.',
        },
      ],
      truncated: false,
      nextPosition: null,
      contentVersion: meta.contentVersion,
      updatedAt: new Date(meta.updatedAt),
    },
    result: {
      kind: 'today_reviews',
      uri: 'en-learning://me/reviews/today',
      meta,
      learningDate: '2026-09-11',
      timezone: 'Asia/Shanghai',
      totalDue: 1,
      items: [
        {
          wordId: 'word_practice',
          word: 'practice',
          reviewState: 'REVIEW',
          dueAt: '2026-09-11T07:30:00.000Z',
          priority: 10,
          reason: 'Scheduled review is due.',
        },
      ],
    },
    schema: mcpReviewsResourceSchema,
  },
  {
    name: 'report summary',
    fileName: 'report-summary.resource.ts',
    exportName: 'McpReportSummaryResource',
    serviceMethod: 'getSummary',
    request: { uri: 'en-learning://me/reports/summary' },
    expectedServiceInput: {
      userId: context.userId,
    },
    serviceResult: {
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
      contentVersion: meta.contentVersion,
      updatedAt: new Date(meta.updatedAt),
    },
    result: {
      kind: 'learning_report',
      uri: 'en-learning://me/reports/summary',
      meta,
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
    },
    schema: mcpReportResourceSchema,
  },
  {
    name: 'weakness summary',
    fileName: 'weaknesses.resource.ts',
    exportName: 'McpWeaknessesResource',
    serviceMethod: 'getWeaknesses',
    request: { uri: 'en-learning://me/weaknesses', limit: 10 },
    expectedServiceInput: {
      userId: context.userId,
      limit: 10,
      cursor: undefined,
    },
    serviceResult: {
      dataCompleteness: 'partial',
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
      contentVersion: meta.contentVersion,
      updatedAt: new Date(meta.updatedAt),
    },
    result: {
      kind: 'weaknesses',
      uri: 'en-learning://me/weaknesses',
      meta,
      dataCompleteness: 'partial',
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
    },
    schema: mcpWeaknessResourceSchema,
  },
] as const;

function instantiate(testCase: (typeof validCases)[number], result: unknown) {
  const read = jest.fn(async () => result);
  const service = { [testCase.serviceMethod]: read };
  const Handler = loadHandler(testCase.fileName, testCase.exportName);
  return { handler: new Handler(service), read };
}

describe('English Learning MCP Resource contracts', () => {
  it('projects the shared word facade into the checked-in Resource schema', async () => {
    if (!existsSync(dictionaryServicePath)) {
      throw new Error('Missing shared WordDictionaryService (T051)');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Dictionary = require(dictionaryServicePath).WordDictionaryService;
    const updatedAt = new Date('2026-09-10T08:00:00.000Z');
    const repository = {
      findAll: jest.fn(),
      search: jest.fn(),
      get: jest.fn(async () => ({
        id: 'word_practice',
        word: 'practice',
        definition: 'to do something repeatedly to improve',
        translation: '练习',
        pos: 'verb',
        phonetic: '/ˈpræktɪs/',
        exchange: 'p:practiced/i:practicing/3:practices',
        frq: '100',
        updatedAt,
      })),
    };
    const rights = {
      authorize: jest.fn(async ({ fieldNames }: { fieldNames: string[] }) => ({
        sourceKey: 'word-book',
        sourceName: 'Approved word book',
        rightsVersion: 'rights.v3',
        allowedFields: fieldNames,
      })),
    };
    const dictionary = new Dictionary(repository, rights, {
      sourceKey: 'word-book',
      now: () => new Date('2026-09-11T08:00:00.000Z'),
    });
    const entry = await dictionary.get({ wordId: 'word_practice' });
    const { contentVersion, updatedAt: projectedUpdatedAt, ...content } = entry;
    const resource = {
      kind: 'word',
      uri: 'en-learning://words/word_practice',
      meta: {
        schemaVersion: 'en-learning.mcp.v1',
        contentVersion,
        updatedAt: projectedUpdatedAt.toISOString(),
        truncated: false,
        nextCursor: null,
        traceId: context.traceId,
      },
      ...content,
    };

    expect(mcpWordResourceSchema.parse(resource)).toEqual(resource);
    expect(repository.get).toHaveBeenCalledWith(
      expect.objectContaining({ wordId: 'word_practice' }),
    );
    expect(JSON.stringify(resource)).not.toMatch(
      /access[_-]?token|password|secret|systemPrompt/i,
    );
  });

  it.each(validCases)(
    'reads the $name URI and validates the checked-in public result',
    async (testCase) => {
      const { handler, read } = instantiate(testCase, testCase.serviceResult);
      const result = await handler.read(testCase.request, context);

      expect(testCase.schema.parse(result)).toEqual(testCase.result);
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith(testCase.expectedServiceInput);
      expect(JSON.stringify(result)).not.toMatch(
        /access[_-]?token|authorization: bearer|rawSubject|password|secret|systemPrompt/i,
      );
    },
  );

  it.each([
    {
      name: 'word path traversal',
      caseIndex: 0,
      request: { uri: 'en-learning://words/..%2Fsecret' },
    },
    {
      name: 'course URL injection',
      caseIndex: 1,
      request: {
        uri: 'en-learning://courses/https:%2F%2Fevil.test/materials/material_1',
      },
    },
    {
      name: 'identity-bearing private URI',
      caseIndex: 2,
      request: { uri: 'en-learning://users/learner_b/reviews/today' },
    },
    {
      name: 'over-limit page',
      caseIndex: 2,
      request: { uri: 'en-learning://me/reviews/today', limit: 51 },
    },
    {
      name: 'non-opaque cursor',
      caseIndex: 4,
      request: {
        uri: 'en-learning://me/weaknesses',
        limit: 10,
        cursor: '../../other-user',
      },
    },
    {
      name: 'unknown request field',
      caseIndex: 3,
      request: {
        uri: 'en-learning://me/reports/summary',
        userId: 'learner_attacker',
      },
    },
  ])(
    'rejects $name before calling a service',
    async ({ caseIndex, request }) => {
      const testCase = validCases[caseIndex]!;
      const { handler, read } = instantiate(testCase, testCase.serviceResult);

      await expect(handler.read(request, context)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(validCases)(
    'rejects an invalid $name service projection before serialization',
    async (testCase) => {
      const { handler, read } = instantiate(testCase, {
        ...testCase.serviceResult,
        contentVersion: undefined,
      });

      await expect(
        handler.read(testCase.request, context),
      ).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
      });
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
});
