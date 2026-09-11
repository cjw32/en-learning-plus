import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  mcpCreateQuizInputSchema,
  mcpCreateQuizSuccessSchema,
  mcpSubmitAnswerInputSchema,
  mcpSubmitAnswerSuccessSchema,
  type McpToolResult,
} from '@en/common/mcp';
import type { McpPersistenceIdentity } from '../persistence/mcp-subject.repository';
import type {
  McpIdempotencyIntentRecord,
  McpIdempotencyRepositoryPort,
  McpIdempotencyToolName,
} from '../persistence/mcp-idempotency.repository';
import { validateMcpResult } from '../results/mcp-result-validator';

const MAX_RESULT_BYTES = 256 * 1024;
const ACTIVE_STATUSES = ['PROCESSING', 'RECONCILING'] as const;

export type McpIdempotencyOptions = Readonly<{
  leaseOwnerHmac: string;
  leaseDurationMs: number;
}>;

export type McpIdempotencyBeginInput = Readonly<{
  toolName: McpIdempotencyToolName;
  clientKey: string;
  request: unknown;
  logicalResource?: string;
  now: Date;
}>;

export type McpIdempotencyDecision =
  | Readonly<{ action: 'EXECUTE'; intent: McpIdempotencyIntentRecord }>
  | Readonly<{ action: 'RECONCILE'; intent: McpIdempotencyIntentRecord }>
  | Readonly<{
      action: 'IN_PROGRESS';
      intent: McpIdempotencyIntentRecord;
      retryAfterMs: number;
    }>
  | Readonly<{
      action: 'REPLAY';
      intent: McpIdempotencyIntentRecord;
      result: unknown;
    }>
  | Readonly<{
      action: 'TERMINAL';
      intent: McpIdempotencyIntentRecord;
      errorCode: string | null;
    }>;

export type McpSubmitPreparationRecord = Readonly<{
  intent: McpIdempotencyIntentRecord;
  gradingResult: unknown;
  gradingResultHash: string;
}>;

export class McpIdempotencyError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'IN_PROGRESS'
      | 'STATE_CONFLICT',
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'McpIdempotencyError';
  }
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new McpIdempotencyError('VALIDATION_FAILED', false);
  }
  if (ancestors.has(value)) {
    throw new McpIdempotencyError('VALIDATION_FAILED', false);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, ancestors)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(object[key], ancestors)}`,
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashMcpIntent(input: {
  toolName: McpIdempotencyToolName;
  request: unknown;
  logicalResource?: string;
}): string {
  return sha256(
    canonicalJson({
      schemaVersion: 'en-learning.mcp.intent.v1',
      toolName: input.toolName,
      logicalResource: input.logicalResource ?? null,
      request: input.request,
    }),
  );
}

function validateInput(input: McpIdempotencyBeginInput): void {
  if (
    typeof input.clientKey !== 'string' ||
    input.clientKey.length < 16 ||
    input.clientKey.length > 128 ||
    !['CREATE_QUIZ', 'SUBMIT_ANSWER'].includes(input.toolName) ||
    Number.isNaN(input.now.getTime()) ||
    (input.logicalResource !== undefined &&
      (input.logicalResource.length < 1 || input.logicalResource.length > 128))
  ) {
    throw new McpIdempotencyError('VALIDATION_FAILED', false);
  }
}

@Injectable()
export class McpIdempotencyService {
  constructor(
    private readonly repository: McpIdempotencyRepositoryPort,
    private readonly options: McpIdempotencyOptions,
  ) {
    if (
      !/^[A-Za-z0-9_.-]{16,128}$/.test(options.leaseOwnerHmac) ||
      !Number.isSafeInteger(options.leaseDurationMs) ||
      options.leaseDurationMs < 1 ||
      options.leaseDurationMs > 86_400_000
    ) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
  }

  async begin(
    identity: McpPersistenceIdentity,
    input: McpIdempotencyBeginInput,
  ): Promise<McpIdempotencyDecision> {
    validateInput(input);
    const requestFingerprint = hashMcpIntent(input);
    const reservation = await this.repository.reserveOrLoad(identity, {
      toolName: input.toolName,
      clientKeyDigest: sha256(input.clientKey),
      requestFingerprint,
      logicalResource: input.logicalResource,
      now: input.now,
    });
    if (reservation.intent.requestFingerprint !== requestFingerprint) {
      throw new McpIdempotencyError('IDEMPOTENCY_CONFLICT', false);
    }
    return this.decide(identity, reservation.intent, input.now, 0);
  }

  async complete(
    identity: McpPersistenceIdentity,
    intentId: string,
    safeTerminalProjection: unknown,
    now: Date,
    business?: Readonly<{
      exerciseId?: string;
      submissionId?: string;
      learningAttemptId?: string;
    }>,
  ): Promise<McpIdempotencyIntentRecord> {
    const serialized = canonicalJson(safeTerminalProjection);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const safeCopy = JSON.parse(serialized) as unknown;
    const completed = await this.repository.transition(identity, intentId, {
      fromStatuses: ACTIVE_STATUSES,
      toStatus: 'COMPLETED',
      leaseOwnerHmac: this.options.leaseOwnerHmac,
      safeTerminalProjection: safeCopy,
      safeErrorCode: null,
      ...(business?.exerciseId ? { exerciseId: business.exerciseId } : {}),
      ...(business?.submissionId
        ? { submissionId: business.submissionId }
        : {}),
      ...(business?.learningAttemptId
        ? { learningAttemptId: business.learningAttemptId }
        : {}),
      finishedAt: now,
      now,
    });
    if (!completed) throw new McpIdempotencyError('STATE_CONFLICT', false);
    return completed;
  }

  async beginCreateQuiz(
    identity: McpPersistenceIdentity,
    untrustedInput: unknown,
    now: Date,
  ): Promise<McpIdempotencyDecision> {
    const parsed = mcpCreateQuizInputSchema.safeParse(untrustedInput);
    if (!parsed.success) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const { idempotencyKey, ...request } = parsed.data;
    const decision = await this.begin(identity, {
      toolName: 'CREATE_QUIZ',
      clientKey: idempotencyKey,
      request,
      logicalResource: 'quiz:create',
      now,
    });
    if (decision.action !== 'REPLAY') return decision;
    const replay = mcpCreateQuizSuccessSchema.safeParse(decision.result);
    if (!replay.success) {
      throw new McpIdempotencyError('STATE_CONFLICT', false);
    }
    return Object.freeze({
      ...decision,
      result: validateMcpResult(mcpCreateQuizSuccessSchema, {
        ...replay.data,
        replayed: true,
      }),
    });
  }

  async completeCreateQuiz(
    identity: McpPersistenceIdentity,
    intentId: string,
    untrustedResult: McpToolResult,
    now: Date,
  ): Promise<McpIdempotencyIntentRecord> {
    const parsed = mcpCreateQuizSuccessSchema.safeParse(untrustedResult);
    if (!parsed.success || parsed.data.replayed) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const safeResult = validateMcpResult(
      mcpCreateQuizSuccessSchema,
      parsed.data,
    );
    return this.complete(identity, intentId, safeResult, now, {
      exerciseId: parsed.data.exerciseId,
    });
  }

  async beginSubmitAnswer(
    identity: McpPersistenceIdentity,
    untrustedInput: unknown,
    now: Date,
  ): Promise<McpIdempotencyDecision> {
    const parsed = mcpSubmitAnswerInputSchema.safeParse(untrustedInput);
    if (!parsed.success) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const { idempotencyKey, ...request } = parsed.data;
    const decision = await this.begin(identity, {
      toolName: 'SUBMIT_ANSWER',
      clientKey: idempotencyKey,
      request,
      logicalResource: parsed.data.exerciseId,
      now,
    });
    if (decision.action !== 'REPLAY') return decision;
    const replay = mcpSubmitAnswerSuccessSchema.safeParse(decision.result);
    if (!replay.success || replay.data.saveStatus === 'not_saved') {
      throw new McpIdempotencyError('STATE_CONFLICT', false);
    }
    return Object.freeze({
      ...decision,
      result: validateMcpResult(mcpSubmitAnswerSuccessSchema, {
        ...replay.data,
        saveStatus: 'replayed',
      }),
    });
  }

  async loadSubmitPreparation(
    identity: McpPersistenceIdentity,
    intentId: string,
    requestFingerprint: string,
  ): Promise<McpSubmitPreparationRecord | null> {
    if (
      typeof intentId !== 'string' ||
      intentId.length < 1 ||
      intentId.length > 128 ||
      !/^[a-f0-9]{64}$/u.test(requestFingerprint)
    ) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const intent = await this.repository.findOwnedById(identity, intentId);
    if (!intent) throw new McpIdempotencyError('STATE_CONFLICT', false);
    if (
      intent.toolName !== 'SUBMIT_ANSWER' ||
      intent.requestFingerprint !== requestFingerprint
    ) {
      throw new McpIdempotencyError('IDEMPOTENCY_CONFLICT', false);
    }
    if (intent.gradingResult === null || intent.gradingResult === undefined) {
      if (intent.gradingResultHash) {
        throw new McpIdempotencyError('STATE_CONFLICT', false);
      }
      return null;
    }
    const serialized = canonicalJson(intent.gradingResult);
    const expected = sha256(serialized);
    if (
      intent.gradingResultHash !== expected ||
      Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES
    ) {
      throw new McpIdempotencyError('STATE_CONFLICT', false);
    }
    return Object.freeze({
      intent,
      gradingResult: JSON.parse(serialized) as unknown,
      gradingResultHash: expected,
    });
  }

  async stageSubmitPreparation(
    identity: McpPersistenceIdentity,
    input: Readonly<{
      intentId: string;
      requestFingerprint: string;
      exerciseId: string;
      gradingResult: unknown;
      now: Date;
    }>,
  ): Promise<McpSubmitPreparationRecord> {
    if (
      typeof input.exerciseId !== 'string' ||
      input.exerciseId.length < 10 ||
      input.exerciseId.length > 64 ||
      Number.isNaN(input.now.getTime())
    ) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const existing = await this.loadSubmitPreparation(
      identity,
      input.intentId,
      input.requestFingerprint,
    );
    const serialized = canonicalJson(input.gradingResult);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const gradingResultHash = sha256(serialized);
    if (existing) {
      if (
        existing.intent.exerciseId !== input.exerciseId ||
        existing.gradingResultHash !== gradingResultHash
      ) {
        throw new McpIdempotencyError('IDEMPOTENCY_CONFLICT', false);
      }
      return existing;
    }
    if (!this.repository.stageGrading) {
      throw new McpIdempotencyError('STATE_CONFLICT', false);
    }
    const intent = await this.repository.stageGrading(
      identity,
      input.intentId,
      {
        requestFingerprint: input.requestFingerprint,
        leaseOwnerHmac: this.options.leaseOwnerHmac,
        exerciseId: input.exerciseId,
        gradingResult: JSON.parse(serialized) as unknown,
        gradingResultHash,
        now: input.now,
      },
    );
    if (intent) {
      return Object.freeze({
        intent,
        gradingResult: JSON.parse(serialized) as unknown,
        gradingResultHash,
      });
    }
    const concurrent = await this.loadSubmitPreparation(
      identity,
      input.intentId,
      input.requestFingerprint,
    );
    if (
      concurrent?.intent.exerciseId === input.exerciseId &&
      concurrent.gradingResultHash === gradingResultHash
    ) {
      return concurrent;
    }
    throw new McpIdempotencyError('STATE_CONFLICT', false);
  }

  async failRetryable(
    identity: McpPersistenceIdentity,
    intentId: string,
    safeErrorCode: string,
    now: Date,
  ): Promise<McpIdempotencyIntentRecord> {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(safeErrorCode)) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const failed = await this.repository.transition(identity, intentId, {
      fromStatuses: ACTIVE_STATUSES,
      toStatus: 'FAILED_RETRYABLE',
      leaseOwnerHmac: this.options.leaseOwnerHmac,
      safeErrorCode,
      finishedAt: null,
      now,
    });
    if (!failed) throw new McpIdempotencyError('STATE_CONFLICT', false);
    return failed;
  }

  async failFinal(
    identity: McpPersistenceIdentity,
    intentId: string,
    safeErrorCode: string,
    now: Date,
  ): Promise<McpIdempotencyIntentRecord> {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(safeErrorCode)) {
      throw new McpIdempotencyError('VALIDATION_FAILED', false);
    }
    const failed = await this.repository.transition(identity, intentId, {
      fromStatuses: ['RESERVED', ...ACTIVE_STATUSES, 'FAILED_RETRYABLE'],
      toStatus: 'FAILED_FINAL',
      leaseOwnerHmac: this.options.leaseOwnerHmac,
      safeErrorCode,
      finishedAt: now,
      now,
    });
    if (!failed) throw new McpIdempotencyError('STATE_CONFLICT', false);
    return failed;
  }

  private async decide(
    identity: McpPersistenceIdentity,
    intent: McpIdempotencyIntentRecord,
    now: Date,
    retries: number,
  ): Promise<McpIdempotencyDecision> {
    if (intent.status === 'COMPLETED') {
      return Object.freeze({
        action: 'REPLAY',
        intent,
        result: intent.safeTerminalProjection,
      });
    }
    if (intent.status === 'FAILED_FINAL' || intent.status === 'CANCELLED') {
      return Object.freeze({
        action: 'TERMINAL',
        intent,
        errorCode: intent.safeErrorCode,
      });
    }

    if (intent.status === 'RESERVED' || intent.status === 'FAILED_RETRYABLE') {
      const claimed = await this.repository.claim(identity, intent.id, {
        fromStatuses: [intent.status],
        toStatus: 'PROCESSING',
        leaseOwnerHmac: this.options.leaseOwnerHmac,
        leaseExpiresAt: new Date(now.getTime() + this.options.leaseDurationMs),
        requireLeaseExpired: false,
        now,
      });
      if (claimed) return Object.freeze({ action: 'EXECUTE', intent: claimed });
      return this.reloadAndDecide(identity, intent.id, now, retries);
    }

    const leaseExpiresAt = intent.leaseExpiresAt;
    if (leaseExpiresAt !== null && leaseExpiresAt > now) {
      return Object.freeze({
        action: 'IN_PROGRESS',
        intent,
        retryAfterMs: Math.max(1, leaseExpiresAt.getTime() - now.getTime()),
      });
    }

    const claimed = await this.repository.claim(identity, intent.id, {
      fromStatuses: [intent.status],
      toStatus: 'RECONCILING',
      leaseOwnerHmac: this.options.leaseOwnerHmac,
      leaseExpiresAt: new Date(now.getTime() + this.options.leaseDurationMs),
      requireLeaseExpired: intent.leaseExpiresAt !== null,
      now,
    });
    if (claimed) return Object.freeze({ action: 'RECONCILE', intent: claimed });
    return this.reloadAndDecide(identity, intent.id, now, retries);
  }

  private async reloadAndDecide(
    identity: McpPersistenceIdentity,
    intentId: string,
    now: Date,
    retries: number,
  ): Promise<McpIdempotencyDecision> {
    if (retries >= 2) {
      throw new McpIdempotencyError('IN_PROGRESS', true);
    }
    const current = await this.repository.findOwnedById(identity, intentId);
    if (!current) throw new McpIdempotencyError('STATE_CONFLICT', false);
    return this.decide(identity, current, now, retries + 1);
  }
}
