import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpPersistenceIdentity } from '../../src/mcp/persistence/mcp-subject.repository';

type Answer = Readonly<{ itemId: string; response: string }>;
type FinalizeInput = Readonly<{
  schemaVersion: 'en-learning.mcp.v1';
  intentId: string;
  confirmationId: string;
  exerciseId: string;
  exerciseVersion: string;
  answers: readonly Answer[];
  idempotencyKey: string;
  grading: Readonly<{
    submissionId: string;
    gradingHash: string;
    score: number;
    items: readonly Readonly<{
      itemId: string;
      score: number;
      correction: string;
      explanation: string;
      errorTypes: readonly string[];
    }>[];
    learningChanges: readonly Readonly<{
      targetType: string;
      targetKey: string;
      previousState: string;
      nextState: string;
      nextReviewAt: string | null;
    }>[];
  }>;
  traceId: string;
}>;

type FinalizeCommand = FinalizeInput &
  Readonly<{
    requestFingerprint: string;
  }>;

type FinalizeResult = Readonly<{
  schemaVersion: 'en-learning.mcp.v1';
  ok: true;
  submissionId: string;
  attemptId: string;
  saveStatus: 'saved' | 'replayed';
  score: number;
  items: FinalizeInput['grading']['items'];
  learningChanges: FinalizeInput['grading']['learningChanges'];
  traceId: string;
}>;

type SubmitAnswerServiceConstructor = new (repository: {
  finalizeAtomic(
    identity: McpPersistenceIdentity,
    command: FinalizeCommand,
  ): Promise<FinalizeResult>;
}) => {
  finalizeConfirmed(
    identity: McpPersistenceIdentity,
    input: FinalizeInput,
  ): Promise<FinalizeResult>;
};

const implementationPath = resolve(
  __dirname,
  '../../../../libs/learning/src/submission/mcp-submit-answer.service.ts',
);

function serviceConstructor(): SubmitAnswerServiceConstructor {
  if (!existsSync(implementationPath)) {
    throw new Error('Missing atomic MCP submit-answer service');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(implementationPath)
    .McpSubmitAnswerService as SubmitAnswerServiceConstructor;
}

const identity: McpPersistenceIdentity = Object.freeze({
  issuer: 'https://issuer.mcp.test',
  subjectHmac: 'subject_hmac_submit_idempotency_0001',
  userId: 'learner_submit_idempotency',
  authorizationId: 'authorization_submit_idempotency',
  clientId: 'client_submit_idempotency',
  audience: 'https://resource.mcp.test/ai/v1/mcp',
  authorizationVersion: 1,
});

function input(overrides: Partial<FinalizeInput> = {}): FinalizeInput {
  return {
    schemaVersion: 'en-learning.mcp.v1',
    intentId: 'intent_submit_idempotency_0001',
    confirmationId: 'confirmation_submit_idempotency_0001',
    exerciseId: 'exercise_submit_idempotency_0001',
    exerciseVersion: 'exercise.submit.v1',
    answers: [
      { itemId: 'item_submit_0001', response: 'schedule' },
      { itemId: 'item_submit_0002', response: 'agenda' },
    ],
    idempotencyKey: 'submit-idempotency-key-0001',
    grading: {
      submissionId: 'submission_submit_idempotency_0001',
      gradingHash: 'b'.repeat(64),
      score: 80,
      items: [
        {
          itemId: 'item_submit_0001',
          score: 100,
          correction: 'schedule',
          explanation: 'The answer matches the expected usage.',
          errorTypes: [],
        },
        {
          itemId: 'item_submit_0002',
          score: 60,
          correction: 'agenda',
          explanation: 'The answer is usable but needs review.',
          errorTypes: ['VOCABULARY'],
        },
      ],
      learningChanges: [
        {
          targetType: 'WORD',
          targetKey: 'word_schedule',
          previousState: 'LEARNING',
          nextState: 'REVIEW',
          nextReviewAt: '2026-09-12T08:00:00.000Z',
        },
      ],
    },
    traceId: 'trace_submit_idempotency_0001',
    ...overrides,
  };
}

class FakeAtomicSubmitRepository {
  readonly submissions: string[] = [];
  readonly attempts: string[] = [];
  readonly reviewEvents: string[] = [];
  readonly itemStates: string[] = [];
  readonly consumedConfirmations: string[] = [];
  readonly completedIntents: string[] = [];
  readonly commands: FinalizeCommand[] = [];

  private readonly records = new Map<
    string,
    Readonly<{ fingerprint: string; result: FinalizeResult }>
  >();
  private queue: Promise<void> = Promise.resolve();

  async finalizeAtomic(
    currentIdentity: McpPersistenceIdentity,
    command: FinalizeCommand,
  ): Promise<FinalizeResult> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;
    try {
      this.commands.push(command);
      if (!/^[a-f0-9]{64}$/.test(command.requestFingerprint)) {
        throw Object.assign(new Error('invalid fingerprint'), {
          code: 'VALIDATION_FAILED',
        });
      }
      const key = [
        currentIdentity.userId,
        currentIdentity.issuer,
        currentIdentity.clientId,
        command.idempotencyKey,
      ].join(':');
      const existing = this.records.get(key);
      if (existing) {
        if (existing.fingerprint !== command.requestFingerprint) {
          throw Object.assign(new Error('idempotency conflict'), {
            code: 'IDEMPOTENCY_CONFLICT',
          });
        }
        return Object.freeze({
          ...existing.result,
          saveStatus: 'replayed' as const,
          traceId: command.traceId,
        });
      }

      const attemptId = 'attempt_submit_idempotency_0001';
      this.submissions.push(command.grading.submissionId);
      this.attempts.push(attemptId);
      this.reviewEvents.push('review_submit_idempotency_0001');
      this.itemStates.push(command.grading.learningChanges[0]!.targetKey);
      this.consumedConfirmations.push(command.confirmationId);
      this.completedIntents.push(command.intentId);
      const result: FinalizeResult = Object.freeze({
        schemaVersion: 'en-learning.mcp.v1',
        ok: true,
        submissionId: command.grading.submissionId,
        attemptId,
        saveStatus: 'saved',
        score: command.grading.score,
        items: command.grading.items,
        learningChanges: command.grading.learningChanges,
        traceId: command.traceId,
      });
      this.records.set(key, {
        fingerprint: command.requestFingerprint,
        result,
      });
      return result;
    } finally {
      release();
    }
  }
}

function fixture() {
  const repository = new FakeAtomicSubmitRepository();
  const Service = serviceConstructor();
  return {
    repository,
    service: new Service(repository),
  };
}

function expectOneAuthoritativeWrite(repository: FakeAtomicSubmitRepository) {
  expect(repository.submissions).toHaveLength(1);
  expect(repository.attempts).toHaveLength(1);
  expect(repository.reviewEvents).toHaveLength(1);
  expect(repository.itemStates).toHaveLength(1);
  expect(repository.consumedConfirmations).toHaveLength(1);
  expect(repository.completedIntents).toHaveLength(1);
}

describe('MCP submit_answer idempotent finalization', () => {
  it('replays the original result for the same key and canonical answer map', async () => {
    const test = fixture();
    const original = input();

    const first = await test.service.finalizeConfirmed(identity, original);
    const replay = await test.service.finalizeConfirmed(identity, {
      ...original,
      answers: [...original.answers].reverse(),
      traceId: 'trace_submit_idempotency_replay_0002',
    });

    expect(first.saveStatus).toBe('saved');
    expect(replay).toMatchObject({
      saveStatus: 'replayed',
      submissionId: first.submissionId,
      attemptId: first.attemptId,
      score: first.score,
      traceId: 'trace_submit_idempotency_replay_0002',
    });
    expect(test.repository.commands[0]?.requestFingerprint).toBe(
      test.repository.commands[1]?.requestFingerprint,
    );
    expectOneAuthoritativeWrite(test.repository);
  });

  it('rejects the same key with changed answer content before another write', async () => {
    const test = fixture();
    const original = input();
    await test.service.finalizeConfirmed(identity, original);

    await expect(
      test.service.finalizeConfirmed(identity, {
        ...original,
        answers: original.answers.map((answer, index) =>
          index === 0 ? { ...answer, response: 'changed answer' } : answer,
        ),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expectOneAuthoritativeWrite(test.repository);
  });

  it('allows exactly one claimant under concurrent confirmed retries', async () => {
    const test = fixture();
    const request = input();

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        test.service.finalizeConfirmed(identity, {
          ...request,
          traceId: `trace_submit_concurrent_${String(index).padStart(4, '0')}`,
        }),
      ),
    );

    expect(
      results.filter(({ saveStatus }) => saveStatus === 'saved'),
    ).toHaveLength(1);
    expect(
      results.filter(({ saveStatus }) => saveStatus === 'replayed'),
    ).toHaveLength(11);
    expect(new Set(results.map(({ submissionId }) => submissionId))).toEqual(
      new Set(['submission_submit_idempotency_0001']),
    );
    expect(new Set(results.map(({ attemptId }) => attemptId))).toEqual(
      new Set(['attempt_submit_idempotency_0001']),
    );
    expectOneAuthoritativeWrite(test.repository);
  });
});
