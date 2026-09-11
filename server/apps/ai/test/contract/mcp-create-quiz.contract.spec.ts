import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MCP_SCHEMA_VERSION,
  mcpCreateQuizInputSchema,
  mcpCreateQuizSuccessSchema,
} from '@en/common/mcp';
import type { McpRequestContext } from '../../src/mcp/auth/mcp-principal';

type CreateQuizTool = Readonly<{
  name: 'create_quiz';
  definition: Readonly<{
    description: string;
    inputSchema: typeof mcpCreateQuizInputSchema;
    outputSchema: typeof mcpCreateQuizSuccessSchema;
    annotations: Readonly<{
      readOnlyHint: false;
      destructiveHint: false;
      idempotentHint: true;
      openWorldHint: false;
    }>;
    _meta: Readonly<Record<string, unknown>>;
  }>;
  execute(
    input: unknown,
    context: McpRequestContext,
    execution?: Readonly<{ deadline?: Date; signal?: AbortSignal }>,
  ): Promise<unknown>;
}>;

type ToolConstructor = new (orchestrator: unknown) => CreateQuizTool;

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
    subject: 'create-quiz-contract-subject',
    audience: 'https://resource.mcp.test/ai/v1/mcp',
    clientId: 'create-quiz-contract-client',
    scopes: Object.freeze(['quiz:create'] as const),
    authorizationVersion: 1,
    issuedAtEpochSeconds: 1_789_117_140,
    notBeforeEpochSeconds: 1_789_117_140,
    expiresAtEpochSeconds: 1_789_120_800,
    verificationMethodVersion: 'fixture.v1',
  }),
  userId: 'learner_quiz_a',
  authorizationId: 'authorization_quiz_a',
  requestId: 'request_create_quiz_contract_0001',
  traceId: 'trace_create_quiz_contract_0001',
  protocolVersion: '2026-07-28',
});

const validInput = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  types: Object.freeze(['MULTIPLE_CHOICE', 'FILL_IN_BLANK'] as const),
  count: 2,
  difficulty: 'MEDIUM' as const,
  wordIds: Object.freeze(['word_agenda', 'word_deadline']),
  knowledgeCategories: Object.freeze(['COURSE_LESSON'] as const),
  scenario: 'Prepare for a project status meeting.',
  idempotencyKey: 'quiz-contract-key-0001',
});

const validResult = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  ok: true as const,
  exerciseId: 'exercise_quiz_contract_0001',
  exerciseVersion: 'exercise.v1',
  status: 'ready' as const,
  instructions: 'Answer every question before submitting.',
  personalizationReason: 'Practises due vocabulary and a weak meeting skill.',
  items: Object.freeze([
    Object.freeze({
      itemId: 'item_agenda_0001',
      position: 1,
      type: 'MULTIPLE_CHOICE' as const,
      prompt: 'Which sentence uses “agenda” naturally?',
      choices: Object.freeze([
        Object.freeze({ id: 'choice_a', text: 'Let us review the agenda.' }),
        Object.freeze({ id: 'choice_b', text: 'I agenda the report.' }),
      ]),
      maxScore: 50,
    }),
    Object.freeze({
      itemId: 'item_deadline_0002',
      position: 2,
      type: 'FILL_IN_BLANK' as const,
      prompt: 'We need to finish before the ____.',
      maxScore: 50,
    }),
  ]),
  citations: Object.freeze([
    Object.freeze({
      citationId: 'cit_quiz_contract_0001',
      source: 'course',
      title: 'Project status meetings',
      excerpt: 'Review the agenda and confirm the deadline.',
      contentVersion: 'course-meetings.v3',
      accessScope: 'OWNED_COURSE' as const,
      status: 'active' as const,
    }),
  ]),
  replayed: false,
  traceId: context.traceId,
});

function fixture(result: unknown = validResult) {
  const createQuiz = jest.fn(async () => result);
  const Tool = loadTool();
  return { tool: new Tool({ createQuiz }), createQuiz };
}

describe('MCP create_quiz public contract', () => {
  it('publishes the exact versioned contract and non-progress-changing effect', () => {
    const test = fixture();

    expect(test.tool.name).toBe('create_quiz');
    expect(test.tool.definition).toMatchObject({
      description: expect.stringMatching(/current|owned|mastery|review/iu),
      inputSchema: mcpCreateQuizInputSchema,
      outputSchema: mcpCreateQuizSuccessSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        'en-learning/schemaVersion': MCP_SCHEMA_VERSION,
        'en-learning/requiredScopes': ['quiz:create'],
        'en-learning/effect': 'create_exercise',
        'en-learning/confirmation': 'none',
        'en-learning/idempotency': 'required',
        'en-learning/maxResultBytes': 256 * 1024,
        'en-learning/deadlineMs': 30_000,
        'en-learning/rateLimitPolicy': 'mcp-create-quiz.v1',
        'en-learning/budgetPolicy': 'mcp-create-quiz.v1',
        'en-learning/retryPolicy': 'no-automatic-model-retry.v1',
        'en-learning/degradation': 'stable-error-no-ready-exercise',
        'en-learning/operationId': 'mcp.tool.create_quiz.v1',
      },
    });
  });

  it('returns a ready, answer-free, source-backed current-user quiz', async () => {
    const test = fixture();
    const signal = new AbortController().signal;
    const deadline = new Date('2026-09-11T08:00:30.000Z');

    const result = await test.tool.execute(validInput, context, {
      signal,
      deadline,
    });

    expect(mcpCreateQuizSuccessSchema.safeParse(result).success).toBe(true);
    expect(result).toEqual(validResult);
    expect(test.createQuiz).toHaveBeenCalledWith({
      userId: context.userId,
      authorizationId: context.authorizationId,
      issuer: context.principal.issuer,
      clientId: context.principal.clientId,
      requestId: context.requestId,
      traceId: context.traceId,
      input: validInput,
      deadline,
      signal,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /answerKey|correctAnswer|isCorrect|gradingRubric|rationale|systemPrompt/iu,
    );
  });

  it.each([
    ['zero count', { ...validInput, count: 0 }],
    ['excessive count', { ...validInput, count: 21 }],
    ['empty types', { ...validInput, types: [] }],
    ['unknown type', { ...validInput, types: ['ESSAY'] }],
    [
      'duplicate types',
      { ...validInput, types: ['MULTIPLE_CHOICE', 'MULTIPLE_CHOICE'] },
    ],
    ['unknown level selector', { ...validInput, level: 'B3' }],
    [
      'unknown source selector',
      { ...validInput, sourceIds: ['private_source'] },
    ],
    [
      'invalid knowledge category',
      { ...validInput, knowledgeCategories: ['SYSTEM_PROMPT'] },
    ],
    [
      'too many word targets',
      {
        ...validInput,
        wordIds: Array.from({ length: 51 }, (_, i) => `word_${i}`),
      },
    ],
    ['identity override', { ...validInput, userId: 'learner_quiz_b' }],
    [
      'answer field',
      { ...validInput, answerKey: { item_agenda_0001: 'choice_a' } },
    ],
    ['short idempotency key', { ...validInput, idempotencyKey: 'short' }],
  ])(
    'rejects %s before orchestration or model/business calls',
    async (_name, input) => {
      const test = fixture();

      await expect(test.tool.execute(input, context)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(test.createQuiz).not.toHaveBeenCalled();
    },
  );
});
