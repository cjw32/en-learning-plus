import type { McpPersistenceIdentity } from '../../src/mcp/persistence/mcp-subject.repository';
import {
  McpIdempotencyRepository,
  type McpIdempotencyClaim,
  type McpIdempotencyIntentRecord,
  type McpIdempotencyRepositoryPort,
  type McpIdempotencyReservation,
  type McpIdempotencyTransition,
} from '../../src/mcp/persistence/mcp-idempotency.repository';
import {
  McpIdempotencyError,
  McpIdempotencyService,
} from '../../src/mcp/idempotency/mcp-idempotency.service';

const identity: McpPersistenceIdentity = Object.freeze({
  issuer: 'https://issuer.mcp.test',
  subjectHmac: 'subject_hash_a',
  userId: 'user-a',
  authorizationId: 'authorization-a',
  clientId: 'client-a',
  audience: 'https://resource.mcp.test/ai/v1/mcp',
  authorizationVersion: 3,
});

const initialTime = new Date('2026-09-11T08:00:00.000Z');
const clientKey = 'quiz-attempt-00000001';

function matchesIdentity(
  record: McpIdempotencyIntentRecord,
  candidate: McpPersistenceIdentity,
): boolean {
  return (
    record.userId === candidate.userId &&
    record.authorizationId === candidate.authorizationId &&
    record.issuer === candidate.issuer &&
    record.clientId === candidate.clientId
  );
}

class InMemoryIdempotencyRepository implements McpIdempotencyRepositoryPort {
  readonly records = new Map<string, McpIdempotencyIntentRecord>();
  private sequence = 0;

  async reserveOrLoad(
    owner: McpPersistenceIdentity,
    reservation: McpIdempotencyReservation,
  ) {
    const uniqueKey = [
      owner.userId,
      owner.issuer,
      owner.clientId,
      reservation.toolName,
      reservation.clientKeyDigest,
    ].join('|');
    const existing = this.records.get(uniqueKey);
    if (existing) return { created: false, intent: existing } as const;

    const intent: McpIdempotencyIntentRecord = {
      id: `intent-${++this.sequence}`,
      userId: owner.userId,
      authorizationId: owner.authorizationId,
      issuer: owner.issuer,
      clientId: owner.clientId,
      toolName: reservation.toolName,
      clientKeyDigest: reservation.clientKeyDigest,
      requestFingerprint: reservation.requestFingerprint,
      logicalResource: reservation.logicalResource ?? null,
      status: 'RESERVED',
      leaseOwnerHmac: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      safeTerminalProjection: null,
      safeErrorCode: null,
      createdAt: reservation.now,
      updatedAt: reservation.now,
      finishedAt: null,
    };
    this.records.set(uniqueKey, intent);
    return { created: true, intent } as const;
  }

  async findOwnedById(owner: McpPersistenceIdentity, intentId: string) {
    return this.findOwned(owner, intentId);
  }

  async claim(
    owner: McpPersistenceIdentity,
    intentId: string,
    claim: McpIdempotencyClaim,
  ) {
    const current = this.findOwned(owner, intentId);
    if (!current || !claim.fromStatuses.includes(current.status)) return null;
    if (
      claim.requireLeaseExpired &&
      (!current.leaseExpiresAt || current.leaseExpiresAt > claim.now)
    ) {
      return null;
    }
    const updated: McpIdempotencyIntentRecord = {
      ...current,
      status: claim.toStatus,
      leaseOwnerHmac: claim.leaseOwnerHmac,
      leaseExpiresAt: claim.leaseExpiresAt,
      attemptCount: current.attemptCount + 1,
      updatedAt: claim.now,
    };
    this.replace(updated);
    return updated;
  }

  async transition(
    owner: McpPersistenceIdentity,
    intentId: string,
    transition: McpIdempotencyTransition,
  ) {
    const current = this.findOwned(owner, intentId);
    if (
      !current ||
      !transition.fromStatuses.includes(current.status) ||
      (transition.leaseOwnerHmac !== undefined &&
        current.leaseOwnerHmac !== transition.leaseOwnerHmac)
    ) {
      return null;
    }
    const updated: McpIdempotencyIntentRecord = {
      ...current,
      status: transition.toStatus,
      leaseOwnerHmac: null,
      leaseExpiresAt: null,
      safeTerminalProjection:
        transition.safeTerminalProjection ?? current.safeTerminalProjection,
      safeErrorCode: transition.safeErrorCode ?? current.safeErrorCode,
      finishedAt: transition.finishedAt ?? current.finishedAt,
      updatedAt: transition.now,
    };
    this.replace(updated);
    return updated;
  }

  private replace(updated: McpIdempotencyIntentRecord) {
    const entry = [...this.records.entries()].find(
      ([, record]) => record.id === updated.id,
    );
    if (!entry) throw new Error('Missing in-memory idempotency record');
    this.records.set(entry[0], updated);
  }

  private findOwned(owner: McpPersistenceIdentity, intentId: string) {
    return (
      [...this.records.values()].find(
        (record) => record.id === intentId && matchesIdentity(record, owner),
      ) ?? null
    );
  }
}

function service(
  repository: McpIdempotencyRepositoryPort,
  leaseOwnerHmac = 'lease_owner_hmac_00000001',
) {
  return new McpIdempotencyService(repository, {
    leaseOwnerHmac,
    leaseDurationMs: 1_000,
  });
}

function beginInput(request: unknown = { count: 5, level: 'B1' }) {
  return {
    toolName: 'CREATE_QUIZ' as const,
    clientKey,
    request,
    logicalResource: 'quiz:daily',
    now: initialTime,
  };
}

describe('MCP durable idempotency state machine', () => {
  it('replays the first safe result for the same key and canonical input', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const idempotency = service(repository);
    const first = await idempotency.begin(
      identity,
      beginInput({ level: 'B1', count: 5 }),
    );
    expect(first.action).toBe('EXECUTE');

    await idempotency.complete(
      identity,
      first.intent.id,
      { quizId: 'quiz-a', state: 'ready' },
      new Date(initialTime.getTime() + 100),
    );
    const replay = await idempotency.begin(
      identity,
      beginInput({ count: 5, level: 'B1' }),
    );

    expect(replay).toMatchObject({
      action: 'REPLAY',
      result: { quizId: 'quiz-a', state: 'ready' },
    });
    expect(replay.intent.attemptCount).toBe(1);
    expect(JSON.stringify([...repository.records.values()])).not.toContain(
      clientKey,
    );
  });

  it('rejects the same key with different input as a permanent conflict', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const idempotency = service(repository);
    await idempotency.begin(identity, beginInput({ count: 5 }));

    await expect(
      idempotency.begin(identity, beginInput({ count: 6 })),
    ).rejects.toMatchObject<McpIdempotencyError>({
      code: 'IDEMPOTENCY_CONFLICT',
      retryable: false,
    });
  });

  it('allows exactly one active claimant under concurrent starts', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const idempotency = service(repository);
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () =>
        idempotency.begin(identity, beginInput()),
      ),
    );

    expect(decisions.filter(({ action }) => action === 'EXECUTE')).toHaveLength(
      1,
    );
    expect(
      decisions.filter(({ action }) => action === 'IN_PROGRESS'),
    ).toHaveLength(19);
    expect([...repository.records.values()]).toHaveLength(1);
  });

  it('moves an expired processing lease to a single reconciliation claimant', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const original = service(repository, 'lease_owner_hmac_original');
    await original.begin(identity, beginInput());
    const afterExpiry = new Date(initialTime.getTime() + 1_001);
    const recovering = service(repository, 'lease_owner_hmac_recovery');

    const decisions = await Promise.all(
      Array.from({ length: 8 }, () =>
        recovering.begin(identity, { ...beginInput(), now: afterExpiry }),
      ),
    );

    expect(
      decisions.filter(({ action }) => action === 'RECONCILE'),
    ).toHaveLength(1);
    expect(
      decisions.filter(({ action }) => action === 'IN_PROGRESS'),
    ).toHaveLength(7);
    expect(decisions[0]?.intent.status).toBe('RECONCILING');
  });

  it('recovers retryable and abandoned reconciliation states without replaying work', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const idempotency = service(repository);
    const first = await idempotency.begin(identity, beginInput());
    await idempotency.failRetryable(
      identity,
      first.intent.id,
      'DEPENDENCY_UNAVAILABLE',
      new Date(initialTime.getTime() + 50),
    );

    const retry = await idempotency.begin(identity, {
      ...beginInput(),
      now: new Date(initialTime.getTime() + 100),
    });
    expect(retry).toMatchObject({
      action: 'EXECUTE',
      intent: { attemptCount: 2 },
    });

    const reconcile = await idempotency.begin(identity, {
      ...beginInput(),
      now: new Date(initialTime.getTime() + 1_101),
    });
    expect(reconcile).toMatchObject({
      action: 'RECONCILE',
      intent: { attemptCount: 3 },
    });
  });

  it('validates caller keys before touching persistence', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const idempotency = service(repository);
    await expect(
      idempotency.begin(identity, { ...beginInput(), clientKey: 'too-short' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repository.records.size).toBe(0);
  });
});

describe('McpIdempotencyRepository ownership and compare-and-swap', () => {
  it('anchors claims to the complete immutable identity', async () => {
    const prisma = {
      mcpIdempotencyIntent: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => ({ id: 'intent-a' })),
      },
    };
    const repository = new McpIdempotencyRepository(prisma as never);
    await repository.claim(identity, 'intent-a', {
      fromStatuses: ['RESERVED'],
      toStatus: 'PROCESSING',
      leaseOwnerHmac: 'lease_owner_hmac_00000001',
      leaseExpiresAt: new Date(initialTime.getTime() + 1_000),
      requireLeaseExpired: false,
      now: initialTime,
    });

    const serialized = JSON.stringify(
      prisma.mcpIdempotencyIntent.updateMany.mock.calls[0]?.[0]?.where,
    );
    for (const value of [
      identity.issuer,
      identity.subjectHmac,
      identity.userId,
      identity.authorizationId,
      identity.clientId,
      identity.audience,
      String(identity.authorizationVersion),
    ]) {
      expect(serialized).toContain(value);
    }
    expect(
      prisma.mcpIdempotencyIntent.updateMany.mock.calls[0]?.[0]?.data,
    ).toMatchObject({
      status: 'PROCESSING',
      leaseOwnerHmac: 'lease_owner_hmac_00000001',
      attemptCount: { increment: 1 },
    });
  });
});
