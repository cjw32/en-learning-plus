import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpPersistenceIdentity } from '../../src/mcp/persistence/mcp-subject.repository';

type ReconciliationIntent = Readonly<{
  id: string;
  status: 'PROCESSING' | 'RECONCILING' | 'COMPLETED';
  createdAt: Date;
  leaseExpiresAt: Date | null;
  exerciseId: string;
  confirmationId: string;
  clientKeyDigest: string;
  requestFingerprint: string;
  safeTerminalProjection: unknown;
}>;

type CommittedBusinessResult = Readonly<{
  submissionId: string;
  attemptId: string;
  gradingHash: string;
  safeTerminalProjection: unknown;
}>;

type ReconciliationRepository = Readonly<{
  loadOwnedIntent(
    identity: McpPersistenceIdentity,
    intentId: string,
  ): Promise<ReconciliationIntent | null>;
  findCommittedByBusinessKeys(
    identity: McpPersistenceIdentity,
    keys: Readonly<{
      exerciseId: string;
      clientKeyDigest: string;
      requestFingerprint: string;
    }>,
  ): Promise<CommittedBusinessResult | null>;
  completeRecovered(
    identity: McpPersistenceIdentity,
    input: Readonly<{
      intentId: string;
      confirmationId: string;
      submissionId: string;
      attemptId: string;
      safeTerminalProjection: unknown;
      now: Date;
    }>,
  ): Promise<void>;
  markRetryable(
    identity: McpPersistenceIdentity,
    intentId: string,
    now: Date,
  ): Promise<void>;
}>;

type ReconciliationResult = Readonly<{
  status: 'recovered' | 'already_completed' | 'retryable' | 'in_progress';
  result?: unknown;
}>;

type ReconciliationServiceConstructor = new (
  repository: ReconciliationRepository,
  options: Readonly<{ recoveryWindowMs: number }>,
  now: () => Date,
) => Readonly<{
  reconcile(
    identity: McpPersistenceIdentity,
    intentId: string,
    execution?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ReconciliationResult>;
}>;

const implementationPath = resolve(
  __dirname,
  '../../src/mcp/confirmation/mcp-submit-reconciliation.service.ts',
);

function serviceConstructor(): ReconciliationServiceConstructor {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing MCP submit reconciliation service');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(implementationPath)
    .McpSubmitReconciliationService as ReconciliationServiceConstructor;
}

const now = new Date('2026-09-11T08:00:00.000Z');
const identity: McpPersistenceIdentity = Object.freeze({
  issuer: 'https://issuer.mcp.test',
  subjectHmac: 'subject_hmac_submit_reconcile_0001',
  userId: 'learner_submit_reconcile',
  authorizationId: 'authorization_submit_reconcile',
  clientId: 'client_submit_reconcile',
  audience: 'https://resource.mcp.test/ai/v1/mcp',
  authorizationVersion: 1,
});

const terminalResult = Object.freeze({
  schemaVersion: 'en-learning.mcp.v1',
  ok: true,
  submissionId: 'submission_submit_reconcile_0001',
  attemptId: 'attempt_submit_reconcile_0001',
  saveStatus: 'saved',
  score: 80,
  items: [
    {
      itemId: 'item_submit_reconcile_0001',
      score: 80,
      correction: 'agenda',
      explanation: 'The target word was used appropriately.',
      errorTypes: [],
    },
  ],
  learningChanges: [],
  traceId: 'trace_submit_reconcile_0001',
});

function intent(
  overrides: Partial<ReconciliationIntent> = {},
): ReconciliationIntent {
  return {
    id: 'intent_submit_reconcile_0001',
    status: 'RECONCILING',
    createdAt: new Date(now.getTime() - 60_000),
    leaseExpiresAt: new Date(now.getTime() - 1),
    exerciseId: 'exercise_submit_reconcile_0001',
    confirmationId: 'confirmation_submit_reconcile_0001',
    clientKeyDigest: 'a'.repeat(64),
    requestFingerprint: 'b'.repeat(64),
    safeTerminalProjection: null,
    ...overrides,
  };
}

function repositoryFixture(current: ReconciliationIntent | null) {
  const repository: ReconciliationRepository & {
    loadOwnedIntent: jest.Mock;
    findCommittedByBusinessKeys: jest.Mock;
    completeRecovered: jest.Mock;
    markRetryable: jest.Mock;
    repeatBusinessWrite: jest.Mock;
  } = {
    loadOwnedIntent: jest.fn(async () => current),
    findCommittedByBusinessKeys: jest.fn(async () => ({
      submissionId: 'submission_submit_reconcile_0001',
      attemptId: 'attempt_submit_reconcile_0001',
      gradingHash: 'c'.repeat(64),
      safeTerminalProjection: terminalResult,
    })),
    completeRecovered: jest.fn(async () => undefined),
    markRetryable: jest.fn(async () => undefined),
    repeatBusinessWrite: jest.fn(async () => undefined),
  };
  return repository;
}

function service(repository: ReconciliationRepository) {
  const Service = serviceConstructor();
  return new Service(
    repository,
    { recoveryWindowMs: 24 * 60 * 60 * 1_000 },
    () => new Date(now),
  );
}

describe('MCP submit_answer cancellation and crash reconciliation', () => {
  it('starts no repository or business step when already cancelled', async () => {
    const repository = repositoryFixture(intent());
    const controller = new AbortController();
    controller.abort();

    await expect(
      service(repository).reconcile(identity, intent().id, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(repository.loadOwnedIntent).not.toHaveBeenCalled();
    expect(repository.findCommittedByBusinessKeys).not.toHaveBeenCalled();
    expect(repository.completeRecovered).not.toHaveBeenCalled();
    expect(repository.repeatBusinessWrite).not.toHaveBeenCalled();
  });

  it('does not steal a live processing lease or begin another write', async () => {
    const repository = repositoryFixture(
      intent({
        status: 'PROCESSING',
        leaseExpiresAt: new Date(now.getTime() + 30_000),
      }),
    );

    await expect(
      service(repository).reconcile(identity, intent().id),
    ).resolves.toEqual({ status: 'in_progress' });
    expect(repository.findCommittedByBusinessKeys).not.toHaveBeenCalled();
    expect(repository.completeRecovered).not.toHaveBeenCalled();
    expect(repository.repeatBusinessWrite).not.toHaveBeenCalled();
  });

  it('recovers a post-commit crash from authoritative business unique keys', async () => {
    const current = intent();
    const repository = repositoryFixture(current);

    await expect(
      service(repository).reconcile(identity, current.id),
    ).resolves.toEqual({ status: 'recovered', result: terminalResult });
    expect(repository.findCommittedByBusinessKeys).toHaveBeenCalledWith(
      identity,
      {
        exerciseId: current.exerciseId,
        clientKeyDigest: current.clientKeyDigest,
        requestFingerprint: current.requestFingerprint,
      },
    );
    expect(repository.completeRecovered).toHaveBeenCalledWith(identity, {
      intentId: current.id,
      confirmationId: current.confirmationId,
      submissionId: 'submission_submit_reconcile_0001',
      attemptId: 'attempt_submit_reconcile_0001',
      safeTerminalProjection: terminalResult,
      now,
    });
    expect(repository.repeatBusinessWrite).not.toHaveBeenCalled();
  });

  it('replays a completed intent without querying or repeating business writes', async () => {
    const current = intent({
      status: 'COMPLETED',
      leaseExpiresAt: null,
      safeTerminalProjection: terminalResult,
    });
    const repository = repositoryFixture(current);

    await expect(
      service(repository).reconcile(identity, current.id),
    ).resolves.toEqual({
      status: 'already_completed',
      result: terminalResult,
    });
    expect(repository.findCommittedByBusinessKeys).not.toHaveBeenCalled();
    expect(repository.completeRecovered).not.toHaveBeenCalled();
    expect(repository.repeatBusinessWrite).not.toHaveBeenCalled();
  });

  it.each([
    ['inside recovery window', 24 * 60 * 60 * 1_000 - 1],
    ['at 24-hour boundary', 24 * 60 * 60 * 1_000],
  ] as const)(
    'settles a no-commit candidate as retryable %s',
    async (_label, ageMs) => {
      const current = intent({ createdAt: new Date(now.getTime() - ageMs) });
      const repository = repositoryFixture(current);
      repository.findCommittedByBusinessKeys.mockResolvedValueOnce(null);

      await expect(
        service(repository).reconcile(identity, current.id),
      ).resolves.toEqual({ status: 'retryable' });
      expect(repository.markRetryable).toHaveBeenCalledWith(
        identity,
        current.id,
        now,
      );
      expect(repository.repeatBusinessWrite).not.toHaveBeenCalled();
    },
  );
});
