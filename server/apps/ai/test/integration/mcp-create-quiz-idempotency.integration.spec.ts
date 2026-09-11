import { MCP_SCHEMA_VERSION, type McpToolResult } from '@en/common/mcp';
import type { McpPersistenceIdentity } from '../../src/mcp/persistence/mcp-subject.repository';
import type {
  McpIdempotencyClaim,
  McpIdempotencyIntentRecord,
  McpIdempotencyRepositoryPort,
  McpIdempotencyReservation,
  McpIdempotencyTransition,
} from '../../src/mcp/persistence/mcp-idempotency.repository';
import {
  McpIdempotencyError,
  McpIdempotencyService,
  type McpIdempotencyDecision,
} from '../../src/mcp/idempotency/mcp-idempotency.service';

type CreateQuizInput = Readonly<{
  schemaVersion: typeof MCP_SCHEMA_VERSION;
  types: readonly ['MULTIPLE_CHOICE'];
  count: number;
  difficulty: 'MEDIUM';
  wordIds: readonly string[];
  idempotencyKey: string;
}>;

type CreateQuizIdempotency = McpIdempotencyService &
  Readonly<{
    beginCreateQuiz(
      identity: McpPersistenceIdentity,
      input: CreateQuizInput,
      now: Date,
    ): Promise<McpIdempotencyDecision>;
    completeCreateQuiz(
      identity: McpPersistenceIdentity,
      intentId: string,
      result: McpToolResult,
      now: Date,
    ): Promise<McpIdempotencyIntentRecord>;
  }>;

const identity: McpPersistenceIdentity = Object.freeze({
  issuer: 'https://issuer.mcp.test',
  subjectHmac: 'subject_hash_quiz_a',
  userId: 'learner_quiz_a',
  authorizationId: 'authorization_quiz_a',
  clientId: 'create-quiz-idempotency-client',
  audience: 'https://resource.mcp.test/ai/v1/mcp',
  authorizationVersion: 1,
});

const initialTime = new Date('2026-09-11T08:00:00.000Z');

const input: CreateQuizInput = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  types: Object.freeze(['MULTIPLE_CHOICE'] as const),
  count: 1,
  difficulty: 'MEDIUM',
  wordIds: Object.freeze(['word_agenda']),
  idempotencyKey: 'quiz-idempotency-key-0001',
});

const result = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  ok: true as const,
  exerciseId: 'exercise_idempotent_0001',
  exerciseVersion: 'exercise.idempotent.v1',
  status: 'ready' as const,
  instructions: 'Choose one answer.',
  personalizationReason: 'Practises the due word agenda.',
  items: Object.freeze([
    Object.freeze({
      itemId: 'item_idempotent_0001',
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
      citationId: 'cit_quiz_idempotent_0001',
      source: 'approved-dictionary',
      title: 'Agenda',
      excerpt: 'A list of topics for a meeting.',
      contentVersion: 'dictionary.v2',
      accessScope: 'PUBLIC' as const,
      status: 'active' as const,
    }),
  ]),
  replayed: false,
  traceId: 'trace_quiz_idempotency_0001',
});

function matches(
  record: McpIdempotencyIntentRecord,
  owner: McpPersistenceIdentity,
) {
  return (
    record.userId === owner.userId &&
    record.authorizationId === owner.authorizationId &&
    record.issuer === owner.issuer &&
    record.clientId === owner.clientId
  );
}

class MemoryRepository implements McpIdempotencyRepositoryPort {
  readonly records = new Map<string, McpIdempotencyIntentRecord>();
  private sequence = 0;

  async reserveOrLoad(
    owner: McpPersistenceIdentity,
    reservation: McpIdempotencyReservation,
  ) {
    const key = [
      owner.userId,
      owner.issuer,
      owner.clientId,
      reservation.toolName,
      reservation.clientKeyDigest,
    ].join('|');
    const existing = this.records.get(key);
    if (existing) return { created: false, intent: existing } as const;
    const intent: McpIdempotencyIntentRecord = {
      id: `intent-create-quiz-${++this.sequence}`,
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
    this.records.set(key, intent);
    return { created: true, intent } as const;
  }

  async findOwnedById(owner: McpPersistenceIdentity, intentId: string) {
    return this.find(owner, intentId);
  }

  async claim(
    owner: McpPersistenceIdentity,
    intentId: string,
    claim: McpIdempotencyClaim,
  ) {
    const current = this.find(owner, intentId);
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
    const current = this.find(owner, intentId);
    if (
      !current ||
      !transition.fromStatuses.includes(current.status) ||
      (transition.leaseOwnerHmac !== undefined &&
        transition.leaseOwnerHmac !== current.leaseOwnerHmac)
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
      exerciseId: transition.exerciseId ?? current.exerciseId,
      submissionId: transition.submissionId ?? current.submissionId,
      learningAttemptId:
        transition.learningAttemptId ?? current.learningAttemptId,
      finishedAt: transition.finishedAt ?? current.finishedAt,
      updatedAt: transition.now,
    };
    this.replace(updated);
    return updated;
  }

  private replace(record: McpIdempotencyIntentRecord) {
    const entry = [...this.records.entries()].find(
      ([, candidate]) => candidate.id === record.id,
    );
    if (!entry) throw new Error('Missing idempotency record');
    this.records.set(entry[0], record);
  }

  private find(owner: McpPersistenceIdentity, intentId: string) {
    return (
      [...this.records.values()].find(
        (record) => record.id === intentId && matches(record, owner),
      ) ?? null
    );
  }
}

function fixture(leaseOwnerHmac = 'lease_create_quiz_owner_0001') {
  const repository = new MemoryRepository();
  const service = new McpIdempotencyService(repository, {
    leaseOwnerHmac,
    leaseDurationMs: 1_000,
  }) as CreateQuizIdempotency;
  return { repository, service };
}

describe('MCP create_quiz idempotency and concurrency', () => {
  it('replays one safe public quiz for the same key/input without a second model charge', async () => {
    const test = fixture();
    let modelCharges = 0;

    const first = await test.service.beginCreateQuiz(
      identity,
      input,
      initialTime,
    );
    expect(first.action).toBe('EXECUTE');
    modelCharges += 1;
    await test.service.completeCreateQuiz(
      identity,
      first.intent.id,
      result,
      new Date(initialTime.getTime() + 100),
    );

    const replay = await test.service.beginCreateQuiz(
      identity,
      { ...input },
      new Date(initialTime.getTime() + 200),
    );
    expect(replay).toMatchObject({
      action: 'REPLAY',
      result: { ...result, replayed: true },
    });
    expect(modelCharges).toBe(1);
    expect(test.repository.records.size).toBe(1);
    expect([...test.repository.records.values()][0]).toMatchObject({
      status: 'COMPLETED',
      exerciseId: result.exerciseId,
      submissionId: undefined,
      learningAttemptId: undefined,
    });
    expect(JSON.stringify([...test.repository.records.values()])).not.toContain(
      input.idempotencyKey,
    );
  });

  it('rejects the same key with changed quiz input as a permanent conflict', async () => {
    const test = fixture();
    await test.service.beginCreateQuiz(identity, input, initialTime);

    await expect(
      test.service.beginCreateQuiz(
        identity,
        { ...input, count: 2 },
        new Date(initialTime.getTime() + 1),
      ),
    ).rejects.toMatchObject<McpIdempotencyError>({
      code: 'IDEMPOTENCY_CONFLICT',
      retryable: false,
    });
  });

  it('allows one model charge for concurrent callers sharing a key', async () => {
    const test = fixture();
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () =>
        test.service.beginCreateQuiz(identity, input, initialTime),
      ),
    );
    let modelCharges = 0;
    for (const decision of decisions) {
      if (decision.action === 'EXECUTE') modelCharges += 1;
    }

    expect(decisions.filter(({ action }) => action === 'EXECUTE')).toHaveLength(
      1,
    );
    expect(
      decisions.filter(({ action }) => action === 'IN_PROGRESS'),
    ).toHaveLength(19);
    expect(modelCharges).toBe(1);
    expect(test.repository.records.size).toBe(1);
  });

  it('reconciles one expired in-progress intent from an authoritative exercise without recharging', async () => {
    const original = fixture('lease_create_quiz_original_0001');
    const started = await original.service.beginCreateQuiz(
      identity,
      input,
      initialTime,
    );
    expect(started.action).toBe('EXECUTE');
    const modelCharges = 1;
    const recovering = new McpIdempotencyService(original.repository, {
      leaseOwnerHmac: 'lease_create_quiz_recovery_0001',
      leaseDurationMs: 1_000,
    }) as CreateQuizIdempotency;
    const afterExpiry = new Date(initialTime.getTime() + 1_001);

    const decisions = await Promise.all(
      Array.from({ length: 8 }, () =>
        recovering.beginCreateQuiz(identity, input, afterExpiry),
      ),
    );
    const reconciliation = decisions.find(
      ({ action }) => action === 'RECONCILE',
    );
    expect(reconciliation).toBeDefined();
    expect(
      decisions.filter(({ action }) => action === 'RECONCILE'),
    ).toHaveLength(1);
    expect(
      decisions.filter(({ action }) => action === 'IN_PROGRESS'),
    ).toHaveLength(7);

    await recovering.completeCreateQuiz(
      identity,
      reconciliation!.intent.id,
      result,
      new Date(afterExpiry.getTime() + 20),
    );
    const replay = await recovering.beginCreateQuiz(
      identity,
      input,
      new Date(afterExpiry.getTime() + 30),
    );
    expect(replay).toMatchObject({
      action: 'REPLAY',
      result: { exerciseId: result.exerciseId, replayed: true },
    });
    expect(modelCharges).toBe(1);
  });

  it('rejects a non-public or answer-bearing completion projection', async () => {
    const test = fixture();
    const started = await test.service.beginCreateQuiz(
      identity,
      input,
      initialTime,
    );

    await expect(
      test.service.completeCreateQuiz(
        identity,
        started.intent.id,
        { ...result, answerKey: { item_idempotent_0001: 'choice_a' } } as never,
        new Date(initialTime.getTime() + 1),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
