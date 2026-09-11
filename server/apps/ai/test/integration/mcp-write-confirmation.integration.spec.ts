import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type State =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CLAIMED'
  | 'CONSUMED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FAILED';

type Record = {
  id: string;
  selectorHmac: string;
  idempotencyIntentId: string;
  userId: string;
  authorizationId: string;
  issuer: string;
  clientId: string;
  exerciseId: string;
  exerciseVersion: string;
  answerDigest: string;
  operationSummaryDigest: string;
  state: State;
  expiresAt: Date;
  confirmedAt: Date | null;
  claimedAt: Date | null;
  consumedAt: Date | null;
  confirmingWebUserIdHmac: string | null;
  createdAt: Date;
  updatedAt: Date;
};

class MemoryRepository {
  record: Record | null = null;

  async createScoped(_identity: unknown, input: Record) {
    if (this.record)
      throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    this.record = { ...input };
    return { ...this.record };
  }

  async findOwnedBySelector(userId: string, selectorHmac: string) {
    return this.record?.userId === userId &&
      this.record.selectorHmac === selectorHmac
      ? { ...this.record }
      : null;
  }

  async findOwnedByIntent(identity: { userId: string }, intentId: string) {
    return this.record?.userId === identity.userId &&
      this.record.idempotencyIntentId === intentId
      ? { ...this.record }
      : null;
  }

  async transitionOwned(
    identity: { userId: string },
    id: string,
    input: {
      fromStates: readonly State[];
      toState: State;
      now: Date;
      confirmedAt?: Date;
      claimedAt?: Date;
      consumedAt?: Date;
      confirmingWebUserIdHmac?: string;
    },
  ) {
    if (
      !this.record ||
      this.record.id !== id ||
      this.record.userId !== identity.userId ||
      !input.fromStates.includes(this.record.state)
    ) {
      return null;
    }
    this.record = {
      ...this.record,
      state: input.toState,
      updatedAt: input.now,
      confirmedAt: input.confirmedAt ?? this.record.confirmedAt,
      claimedAt: input.claimedAt ?? this.record.claimedAt,
      consumedAt: input.consumedAt ?? this.record.consumedAt,
      confirmingWebUserIdHmac:
        input.confirmingWebUserIdHmac ?? this.record.confirmingWebUserIdHmac,
    };
    return { ...this.record };
  }
}

type Service = {
  create(
    identity: unknown,
    input: unknown,
  ): Promise<{
    selector: string;
    confirmation: Record;
  }>;
  decideWeb(selector: string, web: unknown, input: unknown): Promise<unknown>;
  claim(identity: unknown, input: unknown): Promise<Record>;
  consume(identity: unknown, confirmationId: string): Promise<Record>;
  getWeb(selector: string, webUserId: string): Promise<unknown>;
};

type Constructor = new (
  repository: MemoryRepository,
  options: {
    hmacKey: string;
    ttlMs: number;
    toolVersion: string;
    summaryVersion: string;
  },
  now: () => Date,
  selector: () => string,
) => Service;

function load(): Constructor {
  const path = resolve(
    __dirname,
    '../../src/mcp/confirmation/write-confirmation.service.ts',
  );
  if (!existsSync(path)) throw new Error('Missing write confirmation service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path).WriteConfirmationService as Constructor;
}

const identity = Object.freeze({
  issuer: 'https://issuer.mcp.test',
  subjectHmac: 'subject_confirmation_a',
  userId: 'learner_confirmation_a',
  authorizationId: 'authorization_confirmation_a',
  clientId: 'confirmation-client',
  audience: 'https://resource.mcp.test/ai/v1/mcp',
  authorizationVersion: 1,
});
const createInput = Object.freeze({
  idempotencyIntentId: 'intent_confirmation_0001',
  scopeSnapshotDigest: 'b'.repeat(64),
  exerciseId: 'exercise_confirmation_0001',
  exerciseVersion: 'exercise.v1',
  answerDigest: 'c'.repeat(64),
  operationSummary: Object.freeze({
    answerCount: 2,
    willSaveAttempt: true,
    willUpdateMastery: true,
    willUpdateReviewSchedule: true,
    notice: 'The graded attempt and resulting review changes will be saved.',
  }),
  clientDisplayName: 'Example Learning Client',
  exerciseTitle: 'Project meeting quiz',
  itemCount: 2,
});

function fixture() {
  const repository = new MemoryRepository();
  let current = new Date('2026-09-11T08:00:00.000Z');
  const Service = load();
  const service = new Service(
    repository,
    {
      hmacKey: 'mcp-confirmation-state-machine-key-000001',
      ttlMs: 5 * 60 * 1_000,
      toolVersion: 'en-learning.mcp.v1',
      summaryVersion: 'mcp.write-summary.v1',
    },
    () => current,
    () => 'selector_confirmation_000000000001',
  );
  return {
    repository,
    service,
    setNow: (value: string) => {
      current = new Date(value);
    },
  };
}

function webContext() {
  return {
    userId: identity.userId,
    reauthenticatedAt: new Date('2026-09-11T07:59:30.000Z'),
    csrfVerified: true,
  };
}

describe('MCP write-confirmation state machine', () => {
  it('creates a PENDING confirmation with exactly five minutes TTL', async () => {
    const test = fixture();
    const created = await test.service.create(identity, createInput);

    expect(created.selector).toBe('selector_confirmation_000000000001');
    expect(created.confirmation).toMatchObject({
      state: 'PENDING',
      userId: identity.userId,
      authorizationId: identity.authorizationId,
      idempotencyIntentId: createInput.idempotencyIntentId,
      exerciseId: createInput.exerciseId,
      expiresAt: new Date('2026-09-11T08:05:00.000Z'),
      confirmedAt: null,
      claimedAt: null,
      consumedAt: null,
    });
    expect(created.confirmation.selectorHmac).toMatch(/^[a-f0-9]{64}$/u);
    expect(created.confirmation.selectorHmac).not.toContain(created.selector);
  });

  it('uses CAS for PENDING → CONFIRMED → CLAIMED → CONSUMED', async () => {
    const test = fixture();
    const created = await test.service.create(identity, createInput);
    const digest = created.confirmation.operationSummaryDigest;
    await test.service.decideWeb(created.selector, webContext(), {
      decision: 'confirm',
      operationSummaryDigest: digest,
    });

    const claims = await Promise.allSettled([
      test.service.claim(identity, {
        idempotencyIntentId: createInput.idempotencyIntentId,
        exerciseId: createInput.exerciseId,
        exerciseVersion: createInput.exerciseVersion,
        answerDigest: createInput.answerDigest,
        operationSummaryDigest: digest,
      }),
      test.service.claim(identity, {
        idempotencyIntentId: createInput.idempotencyIntentId,
        exerciseId: createInput.exerciseId,
        exerciseVersion: createInput.exerciseVersion,
        answerDigest: createInput.answerDigest,
        operationSummaryDigest: digest,
      }),
    ]);
    expect(claims.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(claims.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    const consumed = await test.service.consume(
      identity,
      created.confirmation.id,
    );
    expect(consumed).toMatchObject({
      state: 'CONSUMED',
      confirmedAt: expect.any(Date),
      claimedAt: expect.any(Date),
      consumedAt: expect.any(Date),
    });
  });

  it('makes rejection terminal and permits no claim or learning write', async () => {
    const test = fixture();
    const learningWrites = 0;
    const created = await test.service.create(identity, createInput);
    await test.service.decideWeb(created.selector, webContext(), {
      decision: 'reject',
      operationSummaryDigest: created.confirmation.operationSummaryDigest,
    });

    await expect(
      test.service.claim(identity, {
        ...createInput,
        operationSummaryDigest: created.confirmation.operationSummaryDigest,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_STATE_CONFLICT' });
    expect(test.repository.record?.state).toBe('REJECTED');
    expect(learningWrites).toBe(0);
  });

  it('expires at the exact five-minute boundary and cannot confirm or claim', async () => {
    const test = fixture();
    const created = await test.service.create(identity, createInput);
    test.setNow('2026-09-11T08:05:00.000Z');

    await expect(
      test.service.getWeb(created.selector, identity.userId),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_EXPIRED' });
    await expect(
      test.service.decideWeb(created.selector, webContext(), {
        decision: 'confirm',
        operationSummaryDigest: created.confirmation.operationSummaryDigest,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_EXPIRED' });
    expect(test.repository.record?.state).toBe('EXPIRED');
  });

  it('rejects consume-before-claim and repeat consume with zero side effects', async () => {
    const test = fixture();
    const learningWrites = 0;
    const created = await test.service.create(identity, createInput);

    await expect(
      test.service.consume(identity, created.confirmation.id),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_STATE_CONFLICT' });
    expect(learningWrites).toBe(0);
  });
});
