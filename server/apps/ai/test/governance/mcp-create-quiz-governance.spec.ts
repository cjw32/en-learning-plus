import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MCP_SCHEMA_VERSION } from '@en/common/mcp';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';

type ToolConstructor = new (orchestrator: unknown) => Readonly<{
  execute(
    input: unknown,
    context: McpRequestContext,
    execution?: Readonly<{ deadline?: Date; signal?: AbortSignal }>,
  ): Promise<unknown>;
}>;

function loadTool(): ToolConstructor {
  const path = resolve(__dirname, '../../src/mcp/tools/create-quiz.tool.ts');
  if (!existsSync(path)) throw new Error('Missing create-quiz.tool.ts');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Tool = require(path).McpCreateQuizTool as ToolConstructor | undefined;
  if (!Tool) throw new Error('Missing McpCreateQuizTool export');
  return Tool;
}

const context: McpRequestContext = Object.freeze({
  principal: Object.freeze({
    issuer: 'https://issuer.mcp.test',
    subject: 'create-quiz-governance-subject',
    audience: 'https://resource.mcp.test/ai/v1/mcp',
    clientId: 'create-quiz-governance-client',
    scopes: Object.freeze(['quiz:create'] as const),
    authorizationVersion: 1,
    issuedAtEpochSeconds: 1_789_117_140,
    notBeforeEpochSeconds: 1_789_117_140,
    expiresAtEpochSeconds: 1_789_120_800,
    verificationMethodVersion: 'fixture.v1',
  }),
  userId: 'learner_quiz_a',
  authorizationId: 'authorization_quiz_a',
  requestId: 'request_create_quiz_governance_0001',
  traceId: 'trace_create_quiz_governance_0001',
  protocolVersion: '2026-07-28',
});

const input = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  types: Object.freeze(['MULTIPLE_CHOICE'] as const),
  count: 1,
  difficulty: 'MEDIUM' as const,
  wordIds: Object.freeze(['word_agenda']),
  idempotencyKey: 'quiz-governance-key-0001',
});

const validResult = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  ok: true as const,
  exerciseId: 'exercise_governed_0001',
  exerciseVersion: 'exercise.governed.v1',
  status: 'ready' as const,
  instructions: 'Choose one answer.',
  personalizationReason: 'Practises the due word agenda.',
  items: Object.freeze([
    Object.freeze({
      itemId: 'item_governed_0001',
      position: 1,
      type: 'MULTIPLE_CHOICE' as const,
      prompt: 'Which sentence uses agenda naturally?',
      choices: Object.freeze([
        Object.freeze({ id: 'choice_a', text: 'Review the agenda.' }),
        Object.freeze({ id: 'choice_b', text: 'Agenda the review.' }),
      ]),
      maxScore: 100,
    }),
  ]),
  citations: Object.freeze([
    Object.freeze({
      citationId: 'cit_quiz_governed_0001',
      source: 'approved-dictionary',
      title: 'Agenda',
      excerpt: 'A list of meeting topics.',
      contentVersion: 'dictionary.v2',
      accessScope: 'PUBLIC' as const,
      status: 'active' as const,
    }),
  ]),
  replayed: false,
  traceId: context.traceId,
});

function codedError(code: string) {
  return Object.assign(new Error('The quiz could not be created.'), { code });
}

describe('MCP create_quiz model and runtime governance', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('derives one 30-second total budget and forwards a shorter caller deadline', async () => {
    jest.useFakeTimers().setSystemTime(Date.parse('2026-09-11T08:00:00.000Z'));
    const createQuiz = jest.fn(async () => validResult);
    const Tool = loadTool();
    const tool = new Tool({ createQuiz });

    await tool.execute(input, context);
    expect(createQuiz.mock.calls[0]?.[0]?.deadline).toEqual(
      new Date('2026-09-11T08:00:30.000Z'),
    );

    createQuiz.mockClear();
    const shorter = new Date('2026-09-11T08:00:05.000Z');
    await tool.execute(input, context, { deadline: shorter });
    expect(createQuiz.mock.calls[0]?.[0]?.deadline).toEqual(shorter);
  });

  it.each([
    ['model timeout', 'TIMEOUT'],
    ['budget denial', 'BUDGET_EXCEEDED'],
    ['dependency failure', 'DEPENDENCY_UNAVAILABLE'],
  ])('returns a stable %s without automatic retry', async (_name, code) => {
    const createQuiz = jest.fn(async () => {
      throw codedError(code);
    });
    const Tool = loadTool();
    const tool = new Tool({ createQuiz });

    await expect(tool.execute(input, context)).rejects.toMatchObject({ code });
    expect(createQuiz).toHaveBeenCalledTimes(1);
  });

  it('never exposes invalid or answer-bearing model output', async () => {
    const rawModelOutput = {
      ...validResult,
      answerKey: { item_governed_0001: 'choice_a' },
      rationale: 'choice_a is correct',
    };
    const createQuiz = jest.fn(async () => rawModelOutput);
    const Tool = loadTool();
    const tool = new Tool({ createQuiz });

    await expect(tool.execute(input, context)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(createQuiz).toHaveBeenCalledTimes(1);
  });

  it('cancels before dispatch and starts no orchestration stage', async () => {
    const createQuiz = jest.fn(async () => validResult);
    const Tool = loadTool();
    const tool = new Tool({ createQuiz });
    const controller = new AbortController();
    controller.abort();

    await expect(
      tool.execute(input, context, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(createQuiz).not.toHaveBeenCalled();
  });

  it('forwards mid-flight cancellation and starts no later projection stage', async () => {
    const controller = new AbortController();
    let projectionStages = 0;
    const createQuiz = jest.fn(async (request: { signal?: AbortSignal }) => {
      controller.abort();
      if (request.signal?.aborted) throw codedError('CANCELLED');
      projectionStages += 1;
      return validResult;
    });
    const Tool = loadTool();
    const tool = new Tool({ createQuiz });

    await expect(
      tool.execute(input, context, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(createQuiz).toHaveBeenCalledTimes(1);
    expect(projectionStages).toBe(0);
  });

  it('causes exactly one bounded token/cost metric for one model execution', async () => {
    const metrics: object[] = [];
    let modelCalls = 0;
    const createQuiz = jest.fn(async () => {
      modelCalls += 1;
      metrics.push({
        schemaVersion: 'mcp.quiz-cost.v1',
        operation: 'create_quiz',
        inputTokens: 120,
        outputTokens: 80,
        estimatedCostMicros: 3,
        totalDurationMs: 17,
        cacheOutcome: 'miss',
      });
      return validResult;
    });
    const Tool = loadTool();
    const tool = new Tool({ createQuiz });

    await tool.execute(input, context);

    expect(modelCalls).toBe(1);
    expect(metrics).toEqual([
      {
        schemaVersion: 'mcp.quiz-cost.v1',
        operation: 'create_quiz',
        inputTokens: 120,
        outputTokens: 80,
        estimatedCostMicros: 3,
        totalDurationMs: 17,
        cacheOutcome: 'miss',
      },
    ]);
    expect(Buffer.byteLength(JSON.stringify(metrics[0]), 'utf8')).toBeLessThan(
      2_048,
    );
  });
});
