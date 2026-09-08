import { createHash } from 'node:crypto';
import {
  createCoachRequestSchema,
  type CreateCoachRequest,
} from '@en/common/coach';

export type CoachRequestStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'BUDGET_EXCEEDED'
  | 'FAILED';

export type StoredCoachRequest = {
  id: string;
  subjectId: string;
  conversationId: string;
  clientRequestKey: string;
  requestBodyHash: string;
  inputPayload: CreateCoachRequest;
  retryOfRequestId?: string | null;
  errorCode?: string | null;
  inputType: 'MESSAGE' | 'EXERCISE_SUBMISSION' | 'RECOMMENDATION';
  status: CoachRequestStatus;
  deadlineAt: Date;
  createdAt: Date;
  updatedAt: Date;
  queuedAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  cancelRequestedAt?: Date | null;
};

export interface CoachRequestStore {
  isConversationOwned(
    subjectId: string,
    conversationId: string,
  ): Promise<boolean>;
  findByOwnerAndKey(
    subjectId: string,
    key: string,
  ): Promise<StoredCoachRequest | null>;
  findActiveByConversation(
    conversationId: string,
  ): Promise<StoredCoachRequest | null>;
  findById(requestId: string): Promise<StoredCoachRequest | null>;
  create(request: StoredCoachRequest): Promise<StoredCoachRequest>;
  update(request: StoredCoachRequest): Promise<StoredCoachRequest>;
}

export class CoachRequestRuleError extends Error {
  constructor(
    readonly code:
      | 'IDEMPOTENCY_CONFLICT'
      | 'STATE_CONFLICT'
      | 'RESOURCE_NOT_FOUND'
      | 'VALIDATION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'CoachRequestRuleError';
  }
}

const transitions: Record<CoachRequestStatus, readonly CoachRequestStatus[]> = {
  CREATED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'CANCELLED', 'TIMED_OUT', 'BUDGET_EXCEEDED', 'FAILED'],
  COMPLETED: [],
  CANCELLED: [],
  TIMED_OUT: [],
  BUDGET_EXCEEDED: [],
  FAILED: [],
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function hashCoachRequestBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(body)))
    .digest('hex');
}

export class CoachRequestService {
  constructor(
    private readonly store: CoachRequestStore,
    private readonly createId: () => string,
    private readonly now: () => Date = () => new Date(),
    private readonly maxDurationMs = 60_000,
  ) {}

  async create(input: {
    subjectId: string;
    conversationId: string;
    clientRequestKey: string;
    body: CreateCoachRequest;
    retryOfRequestId?: string;
    accessTokenExpiresAtEpochSeconds?: number;
  }): Promise<{ request: StoredCoachRequest; replayed: boolean }> {
    if (
      !input.subjectId ||
      !input.conversationId ||
      input.clientRequestKey.length < 16
    ) {
      throw new CoachRequestRuleError('VALIDATION_FAILED', '请求参数无效');
    }
    const parsedBody = createCoachRequestSchema.safeParse(input.body);
    if (!parsedBody.success) {
      throw new CoachRequestRuleError('VALIDATION_FAILED', '请求参数无效');
    }
    const requestBodyHash = hashCoachRequestBody(parsedBody.data);
    const existing = await this.store.findByOwnerAndKey(
      input.subjectId,
      input.clientRequestKey,
    );
    if (existing) {
      if (existing.requestBodyHash !== requestBodyHash) {
        throw new CoachRequestRuleError(
          'IDEMPOTENCY_CONFLICT',
          '幂等键已绑定到其他请求内容',
        );
      }
      return { request: existing, replayed: true };
    }
    if (
      !(await this.store.isConversationOwned(
        input.subjectId,
        input.conversationId,
      ))
    ) {
      throw new CoachRequestRuleError(
        'RESOURCE_NOT_FOUND',
        '会话不存在或不可访问',
      );
    }
    if (await this.store.findActiveByConversation(input.conversationId)) {
      throw new CoachRequestRuleError(
        'STATE_CONFLICT',
        '该会话已有进行中的请求',
      );
    }
    const timestamp = this.now();
    const accessTokenDeadline = input.accessTokenExpiresAtEpochSeconds
      ? input.accessTokenExpiresAtEpochSeconds * 1000
      : Number.MAX_SAFE_INTEGER;
    const request: StoredCoachRequest = {
      id: this.createId(),
      subjectId: input.subjectId,
      conversationId: input.conversationId,
      clientRequestKey: input.clientRequestKey,
      requestBodyHash,
      inputType: parsedBody.data.type,
      inputPayload: parsedBody.data,
      retryOfRequestId: input.retryOfRequestId ?? null,
      errorCode: null,
      status: 'CREATED',
      deadlineAt: new Date(
        Math.min(timestamp.getTime() + this.maxDurationMs, accessTokenDeadline),
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
      queuedAt: null,
      startedAt: null,
      finishedAt: null,
      cancelRequestedAt: null,
    };
    return { request: await this.store.create(request), replayed: false };
  }

  async transition(
    requestId: string,
    nextStatus: CoachRequestStatus,
  ): Promise<StoredCoachRequest> {
    const request = await this.store.findById(requestId);
    if (!request) {
      throw new CoachRequestRuleError(
        'RESOURCE_NOT_FOUND',
        '请求不存在或不可访问',
      );
    }
    if (!transitions[request.status].includes(nextStatus)) {
      throw new CoachRequestRuleError('STATE_CONFLICT', '请求状态不可转换');
    }
    const timestamp = this.now();
    const terminal = [
      'COMPLETED',
      'CANCELLED',
      'TIMED_OUT',
      'BUDGET_EXCEEDED',
      'FAILED',
    ].includes(nextStatus);
    return this.store.update({
      ...request,
      status: nextStatus,
      updatedAt: timestamp,
      queuedAt: nextStatus === 'QUEUED' ? timestamp : request.queuedAt,
      startedAt: nextStatus === 'RUNNING' ? timestamp : request.startedAt,
      finishedAt: terminal ? timestamp : request.finishedAt,
    });
  }
}
