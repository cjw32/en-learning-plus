import { MCP_SCHEMA_VERSION, mcpCreateQuizSuccessSchema } from '@en/common/mcp';
import {
  McpLearningBridge,
  McpLearningBridgeError,
  type McpCreateQuizBridgeInput,
  type McpQuizBridgeServices,
} from '../../src/coach/mcp/mcp-learning.bridge';
import { McpOperationEnvelopeFactory } from '../../src/coach/mcp/mcp-operation-envelope.factory';

const now = new Date('2026-09-11T08:00:00.000Z');
const input = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  types: Object.freeze(['MULTIPLE_CHOICE'] as const),
  count: 1,
  difficulty: 'MEDIUM' as const,
  wordIds: Object.freeze(['word_alpha']),
  knowledgeCategories: Object.freeze(['COURSE_LESSON'] as const),
  scenario: 'Practise a project meeting.',
  idempotencyKey: 'quiz-bridge-key-0001',
});
const request: McpCreateQuizBridgeInput = Object.freeze({
  userId: 'learner_quiz_bridge_a',
  authorizationId: 'authorization_quiz_bridge_a',
  requestId: 'request_quiz_bridge_0001',
  traceId: 'trace_quiz_bridge_0001',
  invocationId: 'invocation_quiz_bridge_0001',
  idempotencyIntentId: 'intent_quiz_bridge_0001',
  requestFingerprint: 'a'.repeat(64),
  input,
  deadline: new Date('2026-09-11T08:00:30.000Z'),
});

function profile() {
  return {
    snapshotAt: now,
    level: { cefr: 'B1' as const, source: 'USER_DECLARED' as const },
    goal: { type: 'BUSINESS' as const, text: 'Lead project meetings' },
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
        { wordId: 'word_alpha', word: 'agenda', state: 'REVIEW' as const },
      ],
    },
    weakItems: [
      {
        targetType: 'WORD' as const,
        targetKey: 'word_alpha',
        label: 'agenda',
        reviewState: 'REVIEW' as const,
        lastQuality: 2,
        dueAt: now,
      },
    ],
    errorTypes: [],
    recentPerformance: {
      attemptCount: 2,
      averageScore: 70,
      windowStart: new Date('2026-08-12T08:00:00.000Z'),
    },
    signals: [],
  };
}

function ragOutput(overrides: { status?: string; sourceId?: string } = {}) {
  const sourceId = overrides.sourceId ?? 'course:course_business:lesson_alpha';
  return {
    schemaVersion: 'coach.tool.v2',
    ok: true,
    query: 'English practice for agenda',
    appliedFilters: {
      levels: ['B1'],
      levelFilterApplied: true,
      categories: ['COURSE_LESSON'],
      sources: [],
      courseIds: ['course_business'],
      wordIds: ['word_alpha'],
      accessScopes: ['PUBLIC', 'OWNED_COURSE', 'PRIVATE_OWNER'],
      privateOwnerEnforced: true,
      topK: 8,
      minimumRelevance: 0.65,
      sourceRightsSnapshotVersion: 'rights.quiz-bridge.v1',
      contentVersionPolicy: 'content-current.v1',
      chunkingVersion: 'chunking.v1',
      embeddingVersion: 'embedding.v2',
      retrievalConfigVersion: 'retrieval.v2',
      indexVersion: 'index.v7',
    },
    results: [
      {
        resultId: 'result_quiz_bridge_0001',
        chunkId: 'chunk_quiz_bridge_0001',
        documentId: 'document_quiz_bridge_0001',
        citationId: 'cit_quiz_bridge_0001',
        source: 'owned-course',
        sourceId,
        title: 'Project meeting vocabulary',
        category: 'COURSE_LESSON',
        excerpt: 'An agenda lists the topics for a meeting.',
        level: 'B1',
        courseId: 'course_business',
        wordId: 'word_alpha',
        accessScope: 'OWNED_COURSE',
        rank: 1,
        relevanceScore: 0.94,
        contentVersion: 'course-business.v3',
        embeddingVersion: 'embedding.v2',
        status: overrides.status ?? 'valid',
      },
    ],
    citations: [
      {
        citationId: 'cit_quiz_bridge_0001',
        source: 'owned-course',
        sourceId,
        title: 'Project meeting vocabulary',
        excerpt: 'An agenda lists the topics for a meeting.',
        category: 'COURSE_LESSON',
        wordId: 'word_alpha',
        courseId: 'course_business',
        accessScope: 'OWNED_COURSE',
        status: 'active',
        usage: 'answer_evidence',
      },
    ],
    conflicts: [],
    retrievalStatus: 'success',
  };
}

function fixture(raw: unknown = ragOutput()) {
  const stages: string[] = [];
  const getSnapshot = jest.fn(async () => {
    stages.push('profile');
    return profile();
  });
  const getDueWords = jest.fn(async () => {
    stages.push('due');
    return {
      asOf: now,
      words: [
        {
          wordId: 'word_alpha',
          word: 'agenda',
          priority: 1,
          reason: 'due',
          citation: {
            sourceId: 'word:word_alpha',
            materialType: 'word',
            title: 'agenda',
            locator: 'dictionary/word_alpha',
            supports: 'meeting topics',
            accessScope: 'PUBLIC',
          },
        },
      ],
      totalDue: 1,
      truncated: false,
    };
  });
  const select = jest.fn(() => {
    stages.push('targeting');
    return {
      difficulty: 'B1' as const,
      targets: [
        {
          targetType: 'WORD' as const,
          targetKey: 'word_alpha',
          wordId: 'word_alpha',
          label: 'agenda',
        },
      ],
      challengeNotice: null,
      personalizationReason: 'Practises the current due word agenda.',
    };
  });
  const searchV2 = jest.fn(async () => {
    stages.push('rag');
    return raw;
  });
  const envelopeFactory = new McpOperationEnvelopeFactory({
    hmacKey: 'mcp-quiz-bridge-test-key-at-least-32-bytes',
    envelopeTtlMs: 86_400_000,
  });
  const createEnvelope = jest.fn(
    (value: Parameters<McpOperationEnvelopeFactory['create']>[0]) => {
      stages.push('envelope');
      return envelopeFactory.create(value);
    },
  );
  const persistMcpOperationEnvelope = jest.fn(async (envelope) => {
    stages.push('persist');
    return envelope;
  });
  const execute = jest.fn(async (_context, scope) => {
    stages.push('exercise');
    return {
      schemaVersion: 'coach.tool.v1',
      ok: true as const,
      exerciseId: 'exercise_quiz_bridge_0001',
      type: 'MULTIPLE_CHOICE' as const,
      difficulty: 'B1' as const,
      instructions: 'Choose the natural sentence.',
      personalizationReason: scope.personalizationReason,
      items: [
        {
          itemId: 'item_quiz_bridge_0001',
          position: 1,
          prompt: 'Which sentence uses agenda naturally?',
          choices: [
            { id: 'choice_a', text: 'Review the agenda.' },
            { id: 'choice_b', text: 'Agenda the review.' },
          ],
          maxScore: 100,
          citations: [
            {
              sourceId: 'course:course_business:lesson_alpha',
              materialType: 'course',
              title: 'Project meeting vocabulary',
              locator: 'mcp-citation:cit_quiz_bridge_0001',
              supports: 'An agenda lists the topics for a meeting.',
              accessScope: 'OWNED_COURSE',
            },
          ],
        },
      ],
      citations: [
        {
          sourceId: 'course:course_business:lesson_alpha',
          materialType: 'course',
          title: 'Project meeting vocabulary',
          locator: 'mcp-citation:cit_quiz_bridge_0001',
          supports: 'An agenda lists the topics for a meeting.',
          accessScope: 'OWNED_COURSE',
        },
      ],
      expiresAt: '2026-09-12T08:00:00.000Z',
    };
  });
  const services = {
    profiles: { getSnapshot },
    schedules: { getDueWords },
    targeting: { select },
    exercises: { execute },
    envelopes: { create: createEnvelope },
    conversations: { persistMcpOperationEnvelope },
  } as unknown as McpQuizBridgeServices;
  const bridge = new McpLearningBridge(
    { searchV2 } as never,
    undefined,
    undefined,
    () => now,
    services,
  );
  return {
    bridge,
    stages,
    getSnapshot,
    getDueWords,
    select,
    searchV2,
    createEnvelope,
    persistMcpOperationEnvelope,
    execute,
  };
}

describe('MCP createQuiz constrained learning bridge', () => {
  it('uses the approved fixed chain with current-user filters and one model attempt', async () => {
    const signal = new AbortController().signal;
    const test = fixture();

    const output = await test.bridge.createQuiz({ ...request, signal });

    expect(mcpCreateQuizSuccessSchema.safeParse(output).success).toBe(true);
    expect(test.stages).toEqual([
      'profile',
      'due',
      'targeting',
      'rag',
      'envelope',
      'persist',
      'exercise',
    ]);
    expect(test.getSnapshot).toHaveBeenCalledWith(request.userId, 50);
    expect(test.getDueWords).toHaveBeenCalledWith(request.userId, {
      learningDate: '2026-09-11',
      timezone: 'Asia/Shanghai',
      limit: 50,
      courseId: 'course_business',
    });
    expect(test.searchV2).toHaveBeenCalledWith(
      request.userId,
      expect.objectContaining({
        filters: expect.objectContaining({
          categories: ['COURSE_LESSON'],
          courseIds: ['course_business'],
          wordIds: ['word_alpha'],
          levels: ['B1'],
          sources: [],
        }),
      }),
      { requestId: request.requestId, deadline: request.deadline, signal },
      undefined,
    );
    expect(test.createEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: request.userId,
        authorizationId: request.authorizationId,
        idempotencyIntentId: request.idempotencyIntentId,
      }),
    );
    expect(test.execute.mock.calls[0]?.[0]).toMatchObject({
      subjectId: request.userId,
    });
    expect(test.execute.mock.calls[0]?.[1]).toMatchObject({
      signal,
      maxModelAttempts: 1,
      targets: [expect.objectContaining({ targetKey: 'word_alpha' })],
      materials: [
        expect.objectContaining({
          citation: expect.objectContaining({
            sourceId: 'course:course_business:lesson_alpha',
          }),
        }),
      ],
    });
    expect(output).toMatchObject({
      status: 'ready',
      replayed: false,
      traceId: request.traceId,
      citations: [
        expect.objectContaining({
          citationId: 'cit_quiz_bridge_0001',
          contentVersion: 'course-business.v3',
          status: 'active',
        }),
      ],
    });
    expect(JSON.stringify(output)).not.toMatch(
      /answerKey|correctAnswer|gradingRubric|isCorrect|systemPrompt/iu,
    );
  });

  it('rejects an unowned requested word before retrieval, envelope, or model work', async () => {
    const test = fixture();

    await expect(
      test.bridge.createQuiz({
        ...request,
        input: { ...input, wordIds: ['word_private_b'] },
      }),
    ).rejects.toEqual(new McpLearningBridgeError('SOURCE_RIGHTS_DENIED'));
    expect(test.stages).toEqual(['profile', 'due', 'targeting']);
    expect(test.searchV2).not.toHaveBeenCalled();
    expect(test.persistMcpOperationEnvelope).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('rejects stale or mismatched sources before creating an operation envelope', async () => {
    const test = fixture(ragOutput({ status: 'stale' }));

    await expect(test.bridge.createQuiz(request)).rejects.toMatchObject({
      code: 'DATA_NOT_AVAILABLE',
    });
    expect(test.stages).toEqual(['profile', 'due', 'targeting', 'rag']);
    expect(test.createEnvelope).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('stops the fixed chain immediately when cancellation is observed', async () => {
    const controller = new AbortController();
    const test = fixture();
    test.getSnapshot.mockImplementationOnce(async () => {
      test.stages.push('profile');
      controller.abort();
      return profile();
    });

    await expect(
      test.bridge.createQuiz({ ...request, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(test.stages).toEqual(['profile']);
    expect(test.getDueWords).not.toHaveBeenCalled();
    expect(test.searchV2).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('exposes only the bounded read and create methods, never general Coach writes', () => {
    expect(
      Object.getOwnPropertyNames(McpLearningBridge.prototype).sort(),
    ).toEqual([
      'constructor',
      'createQuiz',
      'prepareSubmitAnswer',
      'searchMaterials',
    ]);
  });
});
