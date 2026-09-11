import { createHash, createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export type McpCoachOperation = 'create_quiz' | 'submit_answer';

export type McpOperationEnvelope = Readonly<{
  schemaVersion: 'mcp.operation-envelope.v1';
  correlation: Readonly<{
    invocationId: string;
    idempotencyIntentId: string;
    requestFingerprint: string;
  }>;
  conversation: Readonly<{
    id: string;
    userId: string;
    title: null;
    origin: 'MCP';
    checkpointThreadId: string;
    lastActivityAt: Date;
    expiresAt: Date;
  }>;
  request: Readonly<{
    id: string;
    userId: string;
    conversationId: string;
    clientRequestKey: string;
    requestBodyHash: string;
    inputPayload: Readonly<{ type: 'RECOMMENDATION' }>;
    inputType: 'RECOMMENDATION';
    intent: 'CREATE_EXERCISE' | 'GRADE_ANSWER';
    status: 'RUNNING';
    deadlineAt: Date;
    createdAt: Date;
    updatedAt: Date;
    startedAt: Date;
  }>;
}>;

type Options = Readonly<{
  hmacKey: string;
  envelopeTtlMs: number;
}>;

const defaultOptions: Options = Object.freeze({
  hmacKey: 'disabled-mcp-operation-envelope-hmac-key',
  envelopeTtlMs: 24 * 60 * 60 * 1_000,
});

function assertText(value: string, maximum: number): void {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error('Invalid MCP operation envelope input');
  }
}

@Injectable()
export class McpOperationEnvelopeFactory {
  private readonly options: Options;

  constructor(options: Options = defaultOptions) {
    if (
      Buffer.byteLength(options.hmacKey, 'utf8') < 32 ||
      !Number.isSafeInteger(options.envelopeTtlMs) ||
      options.envelopeTtlMs < 1 ||
      options.envelopeTtlMs > 90 * 24 * 60 * 60 * 1_000
    ) {
      throw new Error('Invalid MCP operation envelope configuration');
    }
    this.options = options;
  }

  create(
    input: Readonly<{
      operation: McpCoachOperation;
      userId: string;
      authorizationId: string;
      invocationId: string;
      idempotencyIntentId: string;
      requestFingerprint: string;
      now: Date;
      deadlineAt: Date;
    }>,
  ): McpOperationEnvelope {
    for (const [value, maximum] of [
      [input.userId, 128],
      [input.authorizationId, 128],
      [input.invocationId, 128],
      [input.idempotencyIntentId, 128],
      [input.requestFingerprint, 128],
    ] as const) {
      assertText(value, maximum);
    }
    if (
      !['create_quiz', 'submit_answer'].includes(input.operation) ||
      Number.isNaN(input.now.getTime()) ||
      Number.isNaN(input.deadlineAt.getTime()) ||
      input.deadlineAt <= input.now
    ) {
      throw new Error('Invalid MCP operation envelope input');
    }

    const binding = [
      'mcp.operation-envelope.v1',
      input.userId,
      input.authorizationId,
      input.operation,
      input.idempotencyIntentId,
    ].join('\0');
    const digest = (label: string) =>
      createHmac('sha256', this.options.hmacKey)
        .update(`${label}\0${binding}`)
        .digest('hex');
    const conversationId = `conv_mcp_${digest('conversation').slice(0, 24)}`;
    const requestId = `request_mcp_${digest('request').slice(0, 24)}`;
    const clientRequestKey = `mcp_${digest('idempotency').slice(0, 32)}`;
    const requestBodyHash = createHash('sha256')
      .update(
        JSON.stringify({
          schemaVersion: 'mcp.operation-envelope.v1',
          operation: input.operation,
          invocationId: input.invocationId,
          idempotencyIntentId: input.idempotencyIntentId,
          requestFingerprint: input.requestFingerprint,
        }),
      )
      .digest('hex');
    return Object.freeze({
      schemaVersion: 'mcp.operation-envelope.v1' as const,
      correlation: Object.freeze({
        invocationId: input.invocationId,
        idempotencyIntentId: input.idempotencyIntentId,
        requestFingerprint: input.requestFingerprint,
      }),
      conversation: Object.freeze({
        id: conversationId,
        userId: input.userId,
        title: null,
        origin: 'MCP' as const,
        checkpointThreadId: `thread_mcp_${digest('checkpoint').slice(0, 24)}`,
        lastActivityAt: input.now,
        expiresAt: new Date(input.now.getTime() + this.options.envelopeTtlMs),
      }),
      request: Object.freeze({
        id: requestId,
        userId: input.userId,
        conversationId,
        clientRequestKey,
        requestBodyHash,
        inputPayload: Object.freeze({ type: 'RECOMMENDATION' as const }),
        inputType: 'RECOMMENDATION' as const,
        intent:
          input.operation === 'create_quiz'
            ? ('CREATE_EXERCISE' as const)
            : ('GRADE_ANSWER' as const),
        status: 'RUNNING' as const,
        deadlineAt: input.deadlineAt,
        createdAt: input.now,
        updatedAt: input.now,
        startedAt: input.now,
      }),
    });
  }
}
