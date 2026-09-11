import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MCP_SCHEMA_VERSION, mcpCreateQuizSuccessSchema } from '@en/common/mcp';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';

type ToolConstructor = new (orchestrator: unknown) => Readonly<{
  execute(input: unknown, context: McpRequestContext): Promise<unknown>;
}>;

function loadTool(): ToolConstructor {
  const path = resolve(__dirname, '../../src/mcp/tools/create-quiz.tool.ts');
  if (!existsSync(path)) throw new Error('Missing create-quiz.tool.ts');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Tool = require(path).McpCreateQuizTool as ToolConstructor | undefined;
  if (!Tool) throw new Error('Missing McpCreateQuizTool export');
  return Tool;
}

type UserId = 'learner_a' | 'learner_b';

function context(userId: UserId): McpRequestContext {
  return Object.freeze({
    principal: Object.freeze({
      issuer: 'https://issuer.mcp.test',
      subject: `create-quiz-security-subject-${userId}`,
      audience: 'https://resource.mcp.test/ai/v1/mcp',
      clientId: 'create-quiz-security-client',
      scopes: Object.freeze(['quiz:create'] as const),
      authorizationVersion: 1,
      issuedAtEpochSeconds: 1_789_117_140,
      notBeforeEpochSeconds: 1_789_117_140,
      expiresAtEpochSeconds: 1_789_120_800,
      verificationMethodVersion: 'fixture.v1',
    }),
    userId,
    authorizationId: `authorization_${userId}`,
    requestId: `request_create_quiz_security_${userId}`,
    traceId: `trace_create_quiz_security_${userId}`,
    protocolVersion: '2026-07-28',
  });
}

const input = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  types: Object.freeze(['MULTIPLE_CHOICE'] as const),
  count: 1,
  difficulty: 'MEDIUM' as const,
  wordIds: Object.freeze(['word_alpha']),
  knowledgeCategories: Object.freeze(['COURSE_LESSON'] as const),
  idempotencyKey: 'quiz-security-key-0001',
});

const issuedCitation = Object.freeze({
  citationId: 'cit_quiz_security_0001',
  source: 'owned-course',
  title: 'Authorized alpha lesson',
  excerpt: 'Use agenda to describe the meeting plan.',
  contentVersion: 'course-alpha.v3',
  accessScope: 'OWNED_COURSE' as const,
  status: 'active' as const,
});

function result(traceId: string, citation: object = issuedCitation) {
  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    ok: true,
    exerciseId: 'exercise_security_0001',
    exerciseVersion: 'exercise.security.v1',
    status: 'ready',
    instructions: 'Choose the natural sentence.',
    personalizationReason: 'Uses the current learner’s due word.',
    items: [
      {
        itemId: 'item_security_0001',
        position: 1,
        type: 'MULTIPLE_CHOICE',
        prompt: 'Which sentence uses agenda naturally?',
        choices: [
          { id: 'choice_a', text: 'Let us review the agenda.' },
          { id: 'choice_b', text: 'I agenda the document.' },
        ],
        maxScore: 100,
      },
    ],
    citations: [citation],
    replayed: false,
    traceId,
  };
}

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

function fixture() {
  const state = {
    mastery: [{ userId: 'learner_a', wordId: 'word_alpha', state: 'REVIEW' }],
    reviewSchedules: [
      {
        userId: 'learner_a',
        wordId: 'word_alpha',
        dueAt: '2026-09-11T07:00:00.000Z',
      },
    ],
    submissions: [{ id: 'submission_existing', userId: 'learner_a' }],
    attempts: [{ id: 'attempt_existing', userId: 'learner_a' }],
    exercises: [] as object[],
    sourceReads: 0,
    modelCalls: 0,
  };
  const createQuiz = jest.fn(
    async (request: {
      userId: UserId;
      traceId: string;
      input: typeof input;
    }) => {
      if (request.userId !== 'learner_a') {
        throw Object.assign(new Error('Quiz is unavailable.'), {
          code: 'RESOURCE_NOT_FOUND',
        });
      }
      if (request.input.wordIds?.some((wordId) => wordId !== 'word_alpha')) {
        throw Object.assign(new Error('Quiz is unavailable.'), {
          code: 'SOURCE_RIGHTS_DENIED',
        });
      }
      state.sourceReads += 1;
      state.modelCalls += 1;
      const created = result(request.traceId);
      state.exercises.push({
        id: created.exerciseId,
        userId: request.userId,
        status: created.status,
        origin: 'MCP',
      });
      return created;
    },
  );
  const Tool = loadTool();
  return { state, createQuiz, tool: new Tool({ createQuiz }) };
}

describe('MCP create_quiz access, provenance, and state safety', () => {
  it('uses only the authenticated current user and denies another user before content/model work', async () => {
    const test = fixture();

    await expect(
      test.tool.execute(input, context('learner_b')),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(test.createQuiz).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'learner_b',
        authorizationId: 'authorization_learner_b',
      }),
    );
    expect(test.state.sourceReads).toBe(0);
    expect(test.state.modelCalls).toBe(0);
    expect(test.state.exercises).toEqual([]);
  });

  it('denies an unauthorized target/source before content or model work', async () => {
    const test = fixture();

    await expect(
      test.tool.execute(
        { ...input, wordIds: ['word_private_b'] },
        context('learner_a'),
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_RIGHTS_DENIED' });
    expect(test.state.sourceReads).toBe(0);
    expect(test.state.modelCalls).toBe(0);
    expect(test.state.exercises).toEqual([]);
  });

  it('creates only one current-user exercise and changes no learning state', async () => {
    const test = fixture();
    const before = protectedSnapshot(test.state);

    const output = await test.tool.execute(input, context('learner_a'));

    expect(mcpCreateQuizSuccessSchema.safeParse(output).success).toBe(true);
    expect(output).toMatchObject({
      status: 'ready',
      citations: [issuedCitation],
      traceId: context('learner_a').traceId,
    });
    expect(test.state.exercises).toEqual([
      {
        id: 'exercise_security_0001',
        userId: 'learner_a',
        status: 'ready',
        origin: 'MCP',
      },
    ]);
    expect(protectedSnapshot(test.state)).toEqual(before);
    expect(test.state.sourceReads).toBe(1);
    expect(test.state.modelCalls).toBe(1);
  });

  it.each([
    ['inactive citation', { ...issuedCitation, status: 'unavailable' }],
    [
      'citation carrying an internal source field',
      { ...issuedCitation, sourceId: 'database-row-private-1' },
    ],
    [
      'quiz carrying an answer key',
      issuedCitation,
      { answerKey: { item_security_0001: 'choice_a' } },
    ],
  ])(
    'rejects %s from an untrusted orchestration result',
    async (_name, citation, extra = {}) => {
      const createQuiz = jest.fn(async () => ({
        ...result(context('learner_a').traceId, citation),
        ...extra,
      }));
      const Tool = loadTool();
      const tool = new Tool({ createQuiz });

      await expect(
        tool.execute(input, context('learner_a')),
      ).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
      });
      expect(createQuiz).toHaveBeenCalledTimes(1);
    },
  );
});
