import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MCP_CONFIRMATION_SCHEMA_VERSION,
  mcpConfirmationDecisionInputSchema,
  mcpConfirmationDecisionResultSchema,
  mcpConfirmationOperationSummarySchema,
  mcpConfirmationSelectorSchema,
  mcpConfirmationViewSchema,
  type McpConfirmationDecisionResult,
  type McpConfirmationView,
} from '@en/common/mcp';
import type { McpPersistenceIdentity } from '../persistence/mcp-subject.repository';
import type {
  McpConfirmationOwner,
  McpWriteConfirmationRecord,
  WriteConfirmationRepositoryPort,
} from './write-confirmation.repository';

const REQUIRED_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_REAUTHENTICATION_AGE_MS = 5 * 60 * 1_000;

export type WriteConfirmationOptions = Readonly<{
  hmacKey: string;
  ttlMs: number;
  toolVersion: string;
  summaryVersion: string;
  maximumReauthenticationAgeMs?: number;
}>;

export type WriteConfirmationCreateInput = Readonly<{
  idempotencyIntentId: string;
  scopeSnapshotDigest: string;
  exerciseId: string;
  exerciseVersion: string;
  answerDigest: string;
  operationSummary: unknown;
  clientDisplayName: string;
  exerciseTitle?: string | null;
  itemCount: number;
}>;

export type WriteConfirmationWebContext = Readonly<{
  userId: string;
  sessionUserId?: string;
  reauthenticatedAt: Date;
  tokenExpiresAt?: Date;
  csrfVerified: boolean;
  csrfReplayDetected?: boolean;
}>;

export type WriteConfirmationClaimInput = Readonly<{
  idempotencyIntentId: string;
  exerciseId: string;
  exerciseVersion: string;
  answerDigest: string;
  operationSummaryDigest: string;
  scopeSnapshotDigest?: string;
}>;

type StoredOperationSummary = Readonly<{
  clientDisplayName: string;
  exerciseTitle: string | null;
  itemCount: number;
  summary: {
    answerCount: number;
    willSaveAttempt: true;
    willUpdateMastery: true;
    willUpdateReviewSchedule: true;
    notice?: string;
  };
}>;

export class WriteConfirmationError extends Error {
  constructor(
    readonly code:
      | 'UNAUTHENTICATED'
      | 'RESOURCE_NOT_FOUND'
      | 'VALIDATION_FAILED'
      | 'CONFIRMATION_EXPIRED'
      | 'CONFIRMATION_STATE_CONFLICT',
  ) {
    super('The confirmation request could not be completed.');
    this.name = 'WriteConfirmationError';
  }
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new WriteConfirmationError('VALIDATION_FAILED');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value !== 'object') {
    throw new WriteConfirmationError('VALIDATION_FAILED');
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

function validIdentifier(value: unknown, maximum = 128): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximum &&
    /^[A-Za-z0-9_.:-]+$/u.test(value)
  );
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32,128}$/u.test(value);
}

function isStoredOperationSummary(
  value: unknown,
): value is StoredOperationSummary {
  if (!value || typeof value !== 'object') return false;
  const stored = value as Partial<StoredOperationSummary>;
  return (
    typeof stored.clientDisplayName === 'string' &&
    stored.clientDisplayName.length >= 1 &&
    stored.clientDisplayName.length <= 120 &&
    (stored.exerciseTitle === null ||
      (typeof stored.exerciseTitle === 'string' &&
        stored.exerciseTitle.length <= 200)) &&
    Number.isInteger(stored.itemCount) &&
    Number(stored.itemCount) >= 1 &&
    Number(stored.itemCount) <= 50 &&
    mcpConfirmationOperationSummarySchema.safeParse(stored.summary).success
  );
}

@Injectable()
export class WriteConfirmationService {
  constructor(
    private readonly repository: WriteConfirmationRepositoryPort,
    private readonly options: WriteConfirmationOptions,
    private readonly now: () => Date = () => new Date(),
    private readonly createSelector: () => string = () =>
      randomBytes(32).toString('base64url'),
  ) {
    if (
      Buffer.byteLength(options.hmacKey, 'utf8') < 32 ||
      options.ttlMs !== REQUIRED_TTL_MS ||
      !validIdentifier(options.toolVersion, 64) ||
      !validIdentifier(options.summaryVersion, 64) ||
      !Number.isSafeInteger(
        options.maximumReauthenticationAgeMs ?? DEFAULT_REAUTHENTICATION_AGE_MS,
      ) ||
      (options.maximumReauthenticationAgeMs ??
        DEFAULT_REAUTHENTICATION_AGE_MS) < 1 ||
      (options.maximumReauthenticationAgeMs ??
        DEFAULT_REAUTHENTICATION_AGE_MS) > REQUIRED_TTL_MS
    ) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
  }

  async create(
    identity: McpPersistenceIdentity,
    input: WriteConfirmationCreateInput,
  ): Promise<
    Readonly<{ selector: string; confirmation: McpWriteConfirmationRecord }>
  > {
    this.assertIdentity(identity);
    if (
      !validIdentifier(input.idempotencyIntentId) ||
      !validIdentifier(input.exerciseId) ||
      !validIdentifier(input.exerciseVersion) ||
      !validDigest(input.scopeSnapshotDigest) ||
      !validDigest(input.answerDigest) ||
      typeof input.clientDisplayName !== 'string' ||
      input.clientDisplayName.length < 1 ||
      input.clientDisplayName.length > 120 ||
      (input.exerciseTitle !== undefined &&
        input.exerciseTitle !== null &&
        (typeof input.exerciseTitle !== 'string' ||
          input.exerciseTitle.length > 200)) ||
      !Number.isInteger(input.itemCount) ||
      input.itemCount < 1 ||
      input.itemCount > 50
    ) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
    const summary = mcpConfirmationOperationSummarySchema.safeParse(
      input.operationSummary,
    );
    if (!summary.success || summary.data.answerCount !== input.itemCount) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
    const selector = this.createSelector();
    if (!mcpConfirmationSelectorSchema.safeParse(selector).success) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
    const current = this.currentTime();
    const expiresAt = new Date(current.getTime() + REQUIRED_TTL_MS);
    const storedOperationSummary: StoredOperationSummary = Object.freeze({
      clientDisplayName: input.clientDisplayName,
      exerciseTitle: input.exerciseTitle ?? null,
      itemCount: input.itemCount,
      summary: Object.freeze(summary.data),
    });
    const operationSummaryDigest = digest({
      schemaVersion: MCP_CONFIRMATION_SCHEMA_VERSION,
      toolName: 'submit_answer',
      exercise: {
        title: storedOperationSummary.exerciseTitle,
        itemCount: storedOperationSummary.itemCount,
        version: input.exerciseVersion,
      },
      operationSummary: storedOperationSummary.summary,
      operationSummaryVersion: this.options.summaryVersion,
    });
    const record: McpWriteConfirmationRecord = Object.freeze({
      id: `confirmation_${randomUUID().replaceAll('-', '')}`,
      selectorHmac: this.hmac('selector', selector),
      idempotencyIntentId: input.idempotencyIntentId,
      userId: identity.userId,
      authorizationId: identity.authorizationId,
      issuer: identity.issuer,
      clientId: identity.clientId,
      requiredScope: 'answer:submit',
      scopeSnapshotDigest: input.scopeSnapshotDigest,
      toolVersion: this.options.toolVersion,
      exerciseId: input.exerciseId,
      exerciseVersion: input.exerciseVersion,
      answerDigest: input.answerDigest,
      operationSummary: storedOperationSummary,
      operationSummaryVersion: this.options.summaryVersion,
      operationSummaryDigest,
      state: 'PENDING',
      expiresAt,
      confirmedAt: null,
      claimedAt: null,
      consumedAt: null,
      confirmingWebUserIdHmac: null,
      createdAt: current,
      updatedAt: current,
    });
    const confirmation = await this.repository.createScoped(identity, record);
    return Object.freeze({ selector, confirmation });
  }

  async getWeb(
    selector: string,
    webUserId: string,
  ): Promise<McpConfirmationView> {
    const record = await this.findForWeb(selector, webUserId);
    await this.assertNotExpired(record, { userId: webUserId });
    if (!['PENDING', 'CONFIRMED', 'REJECTED'].includes(record.state)) {
      throw new WriteConfirmationError('CONFIRMATION_STATE_CONFLICT');
    }
    if (!isStoredOperationSummary(record.operationSummary)) {
      throw new WriteConfirmationError('CONFIRMATION_STATE_CONFLICT');
    }
    const status = record.state.toLowerCase() as
      | 'pending'
      | 'confirmed'
      | 'rejected';
    return mcpConfirmationViewSchema.parse({
      schemaVersion: MCP_CONFIRMATION_SCHEMA_VERSION,
      status,
      clientDisplayName: record.operationSummary.clientDisplayName,
      toolName: 'submit_answer',
      exercise: {
        title: record.operationSummary.exerciseTitle,
        itemCount: record.operationSummary.itemCount,
        version: record.exerciseVersion,
      },
      operationSummary: record.operationSummary.summary,
      operationSummaryDigest: record.operationSummaryDigest,
      expiresAt: record.expiresAt.toISOString(),
      retryInstruction: 'After confirming, retry the original MCP call.',
    });
  }

  async decideWeb(
    selector: string,
    web: WriteConfirmationWebContext,
    untrustedInput: unknown,
  ): Promise<McpConfirmationDecisionResult> {
    if (!web || typeof web.userId !== 'string' || web.userId.length < 1) {
      throw new WriteConfirmationError('UNAUTHENTICATED');
    }
    const record = await this.findForWeb(selector, web.userId);
    await this.assertNotExpired(record, { userId: web.userId });
    this.assertWebContext(web);
    const parsed = this.parseDecision(untrustedInput);
    if (record.operationSummaryDigest !== parsed.operationSummaryDigest) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
    if (record.state !== 'PENDING') {
      throw new WriteConfirmationError('CONFIRMATION_STATE_CONFLICT');
    }
    const current = this.currentTime();
    const confirmed = parsed.decision === 'confirm';
    const transitioned = await this.repository.transitionOwned(
      { userId: web.userId },
      record.id,
      {
        fromStates: ['PENDING'],
        toState: confirmed ? 'CONFIRMED' : 'REJECTED',
        now: current,
        requireUnexpiredAt: current,
        expected: {
          operationSummaryDigest: record.operationSummaryDigest,
        },
        ...(confirmed
          ? {
              confirmedAt: current,
              confirmingWebUserIdHmac: this.hmac('web-user', web.userId),
            }
          : {}),
      },
    );
    if (!transitioned) {
      throw new WriteConfirmationError('CONFIRMATION_STATE_CONFLICT');
    }
    return mcpConfirmationDecisionResultSchema.parse({
      schemaVersion: MCP_CONFIRMATION_SCHEMA_VERSION,
      status: confirmed ? 'confirmed' : 'rejected',
      writeExecuted: false,
      nextAction: confirmed ? 'retry_original_mcp_call' : 'no_action',
    });
  }

  async claim(
    identity: McpPersistenceIdentity,
    input: WriteConfirmationClaimInput,
  ): Promise<McpWriteConfirmationRecord> {
    this.assertIdentity(identity);
    if (!validIdentifier(input.idempotencyIntentId)) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
    const record = await this.repository.findOwnedByIntent(
      identity,
      input.idempotencyIntentId,
    );
    if (!record) throw new WriteConfirmationError('RESOURCE_NOT_FOUND');
    await this.assertNotExpired(record, identity);
    if (record.state !== 'CONFIRMED') {
      throw new WriteConfirmationError('CONFIRMATION_STATE_CONFLICT');
    }
    if (
      record.exerciseId !== input.exerciseId ||
      record.exerciseVersion !== input.exerciseVersion ||
      record.answerDigest !== input.answerDigest ||
      record.operationSummaryDigest !== input.operationSummaryDigest ||
      (input.scopeSnapshotDigest !== undefined &&
        record.scopeSnapshotDigest !== input.scopeSnapshotDigest)
    ) {
      throw new WriteConfirmationError('CONFIRMATION_STATE_CONFLICT');
    }
    const current = this.currentTime();
    const claimed = await this.repository.transitionOwned(identity, record.id, {
      fromStates: ['CONFIRMED'],
      toState: 'CLAIMED',
      now: current,
      requireUnexpiredAt: current,
      expected: {
        idempotencyIntentId: input.idempotencyIntentId,
        authorizationId: identity.authorizationId,
        issuer: identity.issuer,
        clientId: identity.clientId,
        exerciseId: input.exerciseId,
        exerciseVersion: input.exerciseVersion,
        answerDigest: input.answerDigest,
        operationSummaryDigest: input.operationSummaryDigest,
        ...(input.scopeSnapshotDigest
          ? { scopeSnapshotDigest: input.scopeSnapshotDigest }
          : {}),
      },
      claimedAt: current,
    });
    if (!claimed) {
      throw new WriteConfirmationError('CONFIRMATION_STATE_CONFLICT');
    }
    return claimed;
  }

  async findForSubmit(
    identity: McpPersistenceIdentity,
    intentId: string,
  ): Promise<McpWriteConfirmationRecord | null> {
    this.assertIdentity(identity);
    if (!validIdentifier(intentId)) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
    const record = await this.repository.findOwnedByIntent(identity, intentId);
    if (!record) return null;
    await this.assertNotExpired(record, identity);
    return this.repository.findOwnedByIntent(identity, intentId);
  }

  async consume(
    identity: McpPersistenceIdentity,
    confirmationId: string,
  ): Promise<McpWriteConfirmationRecord> {
    this.assertIdentity(identity);
    if (!validIdentifier(confirmationId)) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
    const current = this.currentTime();
    const consumed = await this.repository.transitionOwned(
      identity,
      confirmationId,
      {
        fromStates: ['CLAIMED'],
        toState: 'CONSUMED',
        now: current,
        requireUnexpiredAt: current,
        consumedAt: current,
      },
    );
    if (!consumed) {
      throw new WriteConfirmationError('CONFIRMATION_STATE_CONFLICT');
    }
    return consumed;
  }

  private parseDecision(untrustedInput: unknown) {
    const candidate =
      untrustedInput &&
      typeof untrustedInput === 'object' &&
      !Array.isArray(untrustedInput) &&
      !('schemaVersion' in untrustedInput)
        ? {
            schemaVersion: MCP_CONFIRMATION_SCHEMA_VERSION,
            ...(untrustedInput as Record<string, unknown>),
          }
        : untrustedInput;
    const parsed = mcpConfirmationDecisionInputSchema.safeParse(candidate);
    if (!parsed.success) throw new WriteConfirmationError('VALIDATION_FAILED');
    return parsed.data;
  }

  private async findForWeb(
    selector: string,
    userId: string,
  ): Promise<McpWriteConfirmationRecord> {
    if (
      typeof userId !== 'string' ||
      userId.length < 1 ||
      !mcpConfirmationSelectorSchema.safeParse(selector).success
    ) {
      throw new WriteConfirmationError('RESOURCE_NOT_FOUND');
    }
    const record = await this.repository.findOwnedBySelector(
      userId,
      this.hmac('selector', selector),
    );
    if (!record) throw new WriteConfirmationError('RESOURCE_NOT_FOUND');
    return record;
  }

  private async assertNotExpired(
    record: McpWriteConfirmationRecord,
    owner: McpConfirmationOwner,
  ): Promise<void> {
    const current = this.currentTime();
    if (current < record.expiresAt) return;
    if (record.state === 'PENDING' || record.state === 'CONFIRMED') {
      await this.repository.transitionOwned(owner, record.id, {
        fromStates: [record.state],
        toState: 'EXPIRED',
        now: current,
      });
    }
    throw new WriteConfirmationError('CONFIRMATION_EXPIRED');
  }

  private assertWebContext(web: WriteConfirmationWebContext): void {
    const current = this.currentTime();
    const maximumAge =
      this.options.maximumReauthenticationAgeMs ??
      DEFAULT_REAUTHENTICATION_AGE_MS;
    if (
      !web ||
      typeof web.userId !== 'string' ||
      web.userId.length < 1 ||
      (web.sessionUserId !== undefined && web.sessionUserId !== web.userId) ||
      !(web.reauthenticatedAt instanceof Date) ||
      Number.isNaN(web.reauthenticatedAt.getTime()) ||
      web.reauthenticatedAt > current ||
      current.getTime() - web.reauthenticatedAt.getTime() > maximumAge ||
      (web.tokenExpiresAt !== undefined &&
        (!(web.tokenExpiresAt instanceof Date) ||
          Number.isNaN(web.tokenExpiresAt.getTime()) ||
          web.tokenExpiresAt <= current))
    ) {
      throw new WriteConfirmationError('UNAUTHENTICATED');
    }
    if (!web.csrfVerified || web.csrfReplayDetected) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
  }

  private assertIdentity(identity: McpPersistenceIdentity): void {
    if (
      !identity ||
      !validIdentifier(identity.userId) ||
      !validIdentifier(identity.authorizationId) ||
      !validIdentifier(identity.clientId, 512) ||
      typeof identity.issuer !== 'string' ||
      identity.issuer.length < 1 ||
      identity.issuer.length > 512 ||
      !validIdentifier(identity.subjectHmac) ||
      typeof identity.audience !== 'string' ||
      identity.audience.length < 1 ||
      !Number.isSafeInteger(identity.authorizationVersion) ||
      identity.authorizationVersion < 1
    ) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
  }

  private currentTime(): Date {
    const current = this.now();
    if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
      throw new WriteConfirmationError('VALIDATION_FAILED');
    }
    return new Date(current);
  }

  private hmac(domain: string, value: string): string {
    return createHmac('sha256', this.options.hmacKey)
      .update(`${domain}\u0000${value}`, 'utf8')
      .digest('hex');
  }
}
