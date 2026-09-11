import { MCP_SCHEMA_VERSION } from '@en/common/mcp';
import { McpSubmitAnswerOrchestrator } from '../../src/mcp/tools/submit-answer.tool';

const identity = Object.freeze({
  issuer: 'https://issuer.mcp.test',
  subjectHmac: 'subject_hmac_submit_tool_0001',
  userId: 'learner_submit_tool',
  authorizationId: 'authorization_submit_tool',
  clientId: 'client_submit_tool',
  audience: 'https://resource.mcp.test/ai/v1/mcp',
  authorizationVersion: 1,
});

const context = Object.freeze({
  principal: Object.freeze({
    issuer: identity.issuer,
    subject: 'subject-submit-tool',
    audience: identity.audience,
    clientId: identity.clientId,
    scopes: Object.freeze(['answer:submit'] as const),
    authorizationVersion: 1,
    issuedAtEpochSeconds: 1,
    notBeforeEpochSeconds: 1,
    expiresAtEpochSeconds: 4_000_000_000,
    verificationMethodVersion: 'fixture.v1',
  }),
  userId: identity.userId,
  authorizationId: identity.authorizationId,
  requestId: 'request_submit_tool_0001',
  traceId: 'trace_submit_tool_0001',
  protocolVersion: '2026-07-28' as const,
});

const input = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  exerciseId: 'exercise_submit_tool_0001',
  exerciseVersion: 'exercise-submit-tool.v1',
  answers: Object.freeze([
    Object.freeze({ itemId: 'item_submit_tool_0001', value: 'agenda' }),
  ]),
  idempotencyKey: 'submit-tool-idempotency-0001',
});

const intent = Object.freeze({
  id: 'intent_submit_tool_0001',
  requestFingerprint: 'a'.repeat(64),
});

const prepared = Object.freeze({
  schemaVersion: 'mcp.submit-preparation.v1' as const,
  exerciseId: input.exerciseId,
  exerciseVersion: input.exerciseVersion,
  gradeRequestId: 'request_mcp_submit_tool_0001',
  answerVersion: 'b'.repeat(64),
  gradingHash: 'c'.repeat(64),
  score: 80,
  correction: '',
  explanation: 'The answer is appropriate.',
  examples: Object.freeze([]),
  errorTypes: Object.freeze([]),
  items: Object.freeze([
    Object.freeze({
      itemId: 'item_submit_tool_0001',
      isCorrect: true,
      score: 80,
      correction: '',
      explanation: 'The answer is appropriate.',
      errorTypes: Object.freeze([]),
      examples: Object.freeze([]),
      targetQualities: Object.freeze([
        Object.freeze({
          targetType: 'WORD' as const,
          targetKey: 'word_agenda',
          quality: 4,
        }),
      ]),
    }),
  ]),
});

function confirmation(state: string) {
  return {
    id: 'confirmation_submit_tool_0001',
    selectorHmac: 'selector-hmac',
    idempotencyIntentId: intent.id,
    userId: identity.userId,
    authorizationId: identity.authorizationId,
    issuer: identity.issuer,
    clientId: identity.clientId,
    requiredScope: 'answer:submit' as const,
    scopeSnapshotDigest: 'd'.repeat(64),
    toolVersion: 'en-learning.mcp.v1',
    exerciseId: input.exerciseId,
    exerciseVersion: input.exerciseVersion,
    answerDigest: 'e'.repeat(64),
    operationSummary: {
      clientDisplayName: identity.clientId,
      exerciseTitle: null,
      itemCount: 1,
      summary: {
        answerCount: 1,
        willSaveAttempt: true,
        willUpdateMastery: true,
        willUpdateReviewSchedule: true,
        notice: 'This answer will update learning progress.',
      },
    },
    operationSummaryVersion: 'mcp.write-summary.v1',
    operationSummaryDigest: 'f'.repeat(64),
    state,
    expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
    confirmedAt: state === 'CONFIRMED' ? new Date() : null,
    claimedAt: null,
    consumedAt: null,
    confirmingWebUserIdHmac: state === 'CONFIRMED' ? 'web-user-hmac' : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function fixture() {
  let state = 'PENDING';
  let terminal: unknown;
  let calls = 0;
  const beginSubmitAnswer = jest.fn(async () => {
    calls += 1;
    if (terminal)
      return { action: 'REPLAY' as const, intent, result: terminal };
    return calls === 1
      ? { action: 'EXECUTE' as const, intent }
      : { action: 'IN_PROGRESS' as const, intent, retryAfterMs: 1_000 };
  });
  let staged: unknown;
  const loadSubmitPreparation = jest.fn(async () =>
    staged
      ? {
          intent,
          gradingResult: staged,
          gradingResultHash: '9'.repeat(64),
        }
      : null,
  );
  const stageSubmitPreparation = jest.fn();
  const prepareSubmitAnswer = jest.fn(async () => {
    staged = prepared;
    return prepared;
  });
  const findForSubmit = jest.fn(async () => confirmation(state));
  const create = jest.fn(async () => ({
    selector: 'opaque-selector-submit-tool-0000000000000001',
    confirmation: confirmation('PENDING'),
  }));
  const present = jest.fn(async (value) => ({
    resultType: 'input_required',
    confirmationId: value.confirmationId,
  }));
  const finalizeConfirmed = jest.fn(async (_identity, value) => {
    terminal = {
      schemaVersion: MCP_SCHEMA_VERSION,
      ok: true,
      submissionId: value.grading.submissionId,
      attemptId: 'attempt_submit_tool_0001',
      saveStatus: 'saved',
      score: prepared.score,
      items: prepared.items.map((item) => ({
        itemId: item.itemId,
        score: item.score,
        correction: item.correction,
        explanation: item.explanation,
        errorTypes: item.errorTypes,
      })),
      learningChanges: [],
      traceId: context.traceId,
    };
    return terminal;
  });
  const recordSubmit = jest.fn(async () => undefined);
  const orchestrator = new McpSubmitAnswerOrchestrator(
    { resolve: jest.fn(async () => identity) },
    {
      beginSubmitAnswer,
      loadSubmitPreparation,
      stageSubmitPreparation,
    } as never,
    { prepareSubmitAnswer },
    { create, findForSubmit } as never,
    {
      summarize: jest.fn(() => ({
        answerCount: 1,
        willSaveAttempt: true,
        willUpdateMastery: true,
        willUpdateReviewSchedule: true,
      })),
    },
    { finalizeConfirmed } as never,
    { reconcile: jest.fn() } as never,
    { present },
    { recordSubmit } as never,
  );
  const request = {
    userId: identity.userId,
    authorizationId: identity.authorizationId,
    issuer: identity.issuer,
    clientId: identity.clientId,
    requestId: context.requestId,
    traceId: context.traceId,
    context,
    input,
    deadline: new Date(Date.now() + 30_000),
  };
  return {
    orchestrator,
    request,
    beginSubmitAnswer,
    prepareSubmitAnswer,
    create,
    present,
    findForSubmit,
    finalizeConfirmed,
    recordSubmit,
    setState: (value: string) => {
      state = value;
    },
  };
}

describe('MCP submit_answer orchestration', () => {
  it('prepares without a write, waits for Web confirmation, then finalizes once and replays', async () => {
    const test = fixture();

    await expect(test.orchestrator.submit(test.request)).resolves.toMatchObject(
      {
        resultType: 'input_required',
        confirmationId: 'confirmation_submit_tool_0001',
      },
    );
    expect(test.prepareSubmitAnswer).toHaveBeenCalledTimes(1);
    expect(test.create).toHaveBeenCalledTimes(1);
    expect(test.finalizeConfirmed).not.toHaveBeenCalled();

    await expect(test.orchestrator.submit(test.request)).resolves.toMatchObject(
      {
        status: 'confirmation_pending',
      },
    );
    expect(test.finalizeConfirmed).not.toHaveBeenCalled();

    test.setState('CONFIRMED');
    const saved = await test.orchestrator.submit(test.request);
    expect(saved).toMatchObject({ saveStatus: 'saved', score: 80 });
    expect(test.finalizeConfirmed).toHaveBeenCalledTimes(1);

    const replay = await test.orchestrator.submit({
      ...test.request,
      traceId: 'trace_submit_tool_replay_0002',
      context: { ...context, traceId: 'trace_submit_tool_replay_0002' },
    });
    expect(replay).toMatchObject({
      saveStatus: 'replayed',
      traceId: 'trace_submit_tool_replay_0002',
    });
    expect(test.prepareSubmitAnswer).toHaveBeenCalledTimes(1);
    expect(test.finalizeConfirmed).toHaveBeenCalledTimes(1);
    expect(test.recordSubmit).toHaveBeenCalledTimes(3);
  });

  it('does no downstream work when cancellation is already visible', async () => {
    const test = fixture();
    const controller = new AbortController();
    controller.abort();

    await expect(
      test.orchestrator.submit({ ...test.request, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(test.beginSubmitAnswer).not.toHaveBeenCalled();
    expect(test.prepareSubmitAnswer).not.toHaveBeenCalled();
    expect(test.create).not.toHaveBeenCalled();
    expect(test.finalizeConfirmed).not.toHaveBeenCalled();
  });
});
