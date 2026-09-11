import { createCoachRequestSchema } from '@en/common/coach';
import { McpOperationEnvelopeFactory } from '../../src/coach/mcp/mcp-operation-envelope.factory';

const now = new Date('2026-09-11T08:00:00.000Z');
const input = Object.freeze({
  operation: 'create_quiz' as const,
  userId: 'learner_envelope_a',
  authorizationId: 'authorization_envelope_a',
  invocationId: 'invocation_envelope_0001',
  idempotencyIntentId: 'intent_envelope_0001',
  requestFingerprint: 'a'.repeat(64),
  now,
  deadlineAt: new Date('2026-09-11T08:00:30.000Z'),
});

function factory() {
  return new McpOperationEnvelopeFactory({
    hmacKey: 'mcp-operation-envelope-test-key-at-least-32-bytes',
    envelopeTtlMs: 24 * 60 * 60 * 1_000,
  });
}

describe('MCP internal Coach operation envelope factory', () => {
  it('creates a current-user MCP envelope with only relation metadata', () => {
    const envelope = factory().create(input);

    expect(envelope).toEqual({
      schemaVersion: 'mcp.operation-envelope.v1',
      correlation: {
        invocationId: input.invocationId,
        idempotencyIntentId: input.idempotencyIntentId,
        requestFingerprint: input.requestFingerprint,
      },
      conversation: {
        id: expect.stringMatching(/^conv_mcp_[a-f0-9]{24}$/u),
        userId: input.userId,
        title: null,
        origin: 'MCP',
        checkpointThreadId: expect.stringMatching(/^thread_mcp_[a-f0-9]{24}$/u),
        lastActivityAt: now,
        expiresAt: new Date('2026-09-12T08:00:00.000Z'),
      },
      request: {
        id: expect.stringMatching(/^request_mcp_[a-f0-9]{24}$/u),
        userId: input.userId,
        conversationId: expect.stringMatching(/^conv_mcp_[a-f0-9]{24}$/u),
        clientRequestKey: expect.stringMatching(/^mcp_[a-f0-9]{32}$/u),
        requestBodyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        inputPayload: { type: 'RECOMMENDATION' },
        inputType: 'RECOMMENDATION',
        intent: 'CREATE_EXERCISE',
        status: 'RUNNING',
        deadlineAt: input.deadlineAt,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      },
    });
    expect(envelope.request.conversationId).toBe(envelope.conversation.id);
    expect(
      createCoachRequestSchema.safeParse(envelope.request.inputPayload).success,
    ).toBe(true);
  });

  it('derives deterministic channel-separated IDs and key-domain isolation', () => {
    const first = factory().create(input);
    const replay = factory().create({ ...input });
    const anotherIntent = factory().create({
      ...input,
      idempotencyIntentId: 'intent_envelope_0002',
    });
    const submit = factory().create({ ...input, operation: 'submit_answer' });

    expect(replay).toEqual(first);
    expect(first.conversation.id).not.toBe(first.request.id);
    expect(anotherIntent.conversation.id).not.toBe(first.conversation.id);
    expect(anotherIntent.request.clientRequestKey).not.toBe(
      first.request.clientRequestKey,
    );
    expect(submit.request.intent).toBe('GRADE_ANSWER');
    expect(submit.request.clientRequestKey).not.toBe(
      first.request.clientRequestKey,
    );
  });

  it('contains no chat transcript, raw client key, token, or learner prompt', () => {
    const envelope = factory().create(input);
    const serialized = JSON.stringify(envelope);

    expect(serialized).not.toMatch(
      /message|transcript|chatHistory|learnerPrompt|answerKey|accessToken|Bearer/iu,
    );
    expect(serialized).not.toContain('raw-client-idempotency-key');
    expect(Object.keys(envelope.request.inputPayload)).toEqual(['type']);
  });

  it('rejects invalid identity, correlation, time, and configuration input', () => {
    expect(() => factory().create({ ...input, userId: '' })).toThrow();
    expect(() =>
      factory().create({ ...input, invocationId: 'x\nleak' }),
    ).toThrow();
    expect(() => factory().create({ ...input, deadlineAt: now })).toThrow();
    expect(
      () =>
        new McpOperationEnvelopeFactory({
          hmacKey: 'short',
          envelopeTtlMs: 1,
        }),
    ).toThrow();
  });
});
