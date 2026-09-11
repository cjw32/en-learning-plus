import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpPersistenceIdentity } from '../../src/mcp/persistence/mcp-subject.repository';

type FinalizeInput = Readonly<{
  schemaVersion: 'en-learning.mcp.v1';
  intentId: string;
  confirmationId: string;
  exerciseId: string;
  exerciseVersion: string;
  answers: readonly Readonly<{ itemId: string; response: string }>[];
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

type FinalizeCommand = FinalizeInput & Readonly<{ requestFingerprint: string }>;

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

type AtomicRepository = Readonly<{
  finalizeAtomic(
    identity: McpPersistenceIdentity,
    command: FinalizeCommand,
  ): Promise<FinalizeResult>;
}>;

type SubmitAnswerServiceConstructor = new (
  repository: AtomicRepository,
) => Readonly<{
  finalizeConfirmed(
    identity: McpPersistenceIdentity,
    input: FinalizeInput,
  ): Promise<FinalizeResult>;
}>;

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
  subjectHmac: 'subject_hmac_submit_atomicity_0001',
  userId: 'learner_submit_atomicity',
  authorizationId: 'authorization_submit_atomicity',
  clientId: 'client_submit_atomicity',
  audience: 'https://resource.mcp.test/ai/v1/mcp',
  authorizationVersion: 1,
});

const request: FinalizeInput = Object.freeze({
  schemaVersion: 'en-learning.mcp.v1',
  intentId: 'intent_submit_atomicity_0001',
  confirmationId: 'confirmation_submit_atomicity_0001',
  exerciseId: 'exercise_submit_atomicity_0001',
  exerciseVersion: 'exercise.atomicity.v1',
  answers: Object.freeze([
    Object.freeze({ itemId: 'item_submit_atomicity_0001', response: 'agenda' }),
  ]),
  idempotencyKey: 'submit-atomicity-key-0001',
  grading: Object.freeze({
    submissionId: 'submission_submit_atomicity_0001',
    gradingHash: 'c'.repeat(64),
    score: 80,
    items: Object.freeze([
      Object.freeze({
        itemId: 'item_submit_atomicity_0001',
        score: 80,
        correction: 'agenda',
        explanation: 'The answer demonstrates the target vocabulary.',
        errorTypes: Object.freeze([]),
      }),
    ]),
    learningChanges: Object.freeze([
      Object.freeze({
        targetType: 'WORD',
        targetKey: 'word_agenda',
        previousState: 'LEARNING',
        nextState: 'REVIEW',
        nextReviewAt: '2026-09-12T08:00:00.000Z',
      }),
    ]),
  }),
  traceId: 'trace_submit_atomicity_0001',
});

type TransactionStage =
  | 'after_confirmation_claim'
  | 'after_submission'
  | 'after_attempt'
  | 'after_item_state'
  | 'after_review_event'
  | 'after_confirmation_consume'
  | 'after_idempotency_complete'
  | 'before_commit'
  | 'after_commit';

type DatabaseState = {
  confirmationClaims: string[];
  submissions: string[];
  attempts: string[];
  itemStates: string[];
  reviewEvents: string[];
  consumedConfirmations: string[];
  completedIntents: string[];
};

function emptyState(): DatabaseState {
  return {
    confirmationClaims: [],
    submissions: [],
    attempts: [],
    itemStates: [],
    reviewEvents: [],
    consumedConfirmations: [],
    completedIntents: [],
  };
}

function cloneState(state: DatabaseState): DatabaseState {
  return Object.fromEntries(
    Object.entries(state).map(([key, values]) => [key, [...values]]),
  ) as DatabaseState;
}

class FaultInjectingAtomicRepository implements AtomicRepository {
  state = emptyState();

  constructor(private readonly failAt: TransactionStage | null) {}

  async finalizeAtomic(
    currentIdentity: McpPersistenceIdentity,
    command: FinalizeCommand,
  ): Promise<FinalizeResult> {
    expect(currentIdentity).toEqual(identity);
    expect(command.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const transaction = cloneState(this.state);
    const inject = (stage: TransactionStage) => {
      if (this.failAt === stage) {
        throw Object.assign(new Error(`injected failure at ${stage}`), {
          code: 'DEPENDENCY_UNAVAILABLE',
        });
      }
    };

    transaction.confirmationClaims.push(command.confirmationId);
    inject('after_confirmation_claim');
    transaction.submissions.push(command.grading.submissionId);
    inject('after_submission');
    const attemptId = 'attempt_submit_atomicity_0001';
    transaction.attempts.push(attemptId);
    inject('after_attempt');
    transaction.itemStates.push(command.grading.learningChanges[0]!.targetKey);
    inject('after_item_state');
    transaction.reviewEvents.push('review_submit_atomicity_0001');
    inject('after_review_event');
    transaction.consumedConfirmations.push(command.confirmationId);
    inject('after_confirmation_consume');
    transaction.completedIntents.push(command.intentId);
    inject('after_idempotency_complete');
    inject('before_commit');

    this.state = transaction;
    inject('after_commit');
    return Object.freeze({
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
  }
}

function counts(state: DatabaseState) {
  return Object.values(state).map((rows) => rows.length);
}

function expectFullyLinked(state: DatabaseState) {
  expect(state.confirmationClaims).toEqual([
    'confirmation_submit_atomicity_0001',
  ]);
  expect(state.submissions).toEqual(['submission_submit_atomicity_0001']);
  expect(state.attempts).toEqual(['attempt_submit_atomicity_0001']);
  expect(state.itemStates).toEqual(['word_agenda']);
  expect(state.reviewEvents).toEqual(['review_submit_atomicity_0001']);
  expect(state.consumedConfirmations).toEqual([
    'confirmation_submit_atomicity_0001',
  ]);
  expect(state.completedIntents).toEqual(['intent_submit_atomicity_0001']);
}

describe('MCP submit_answer authoritative transaction atomicity', () => {
  it.each([
    'after_confirmation_claim',
    'after_submission',
    'after_attempt',
    'after_item_state',
    'after_review_event',
    'after_confirmation_consume',
    'after_idempotency_complete',
    'before_commit',
  ] as const)('rolls back every write when %s fails', async (failAt) => {
    const repository = new FaultInjectingAtomicRepository(failAt);
    const Service = serviceConstructor();
    const service = new Service(repository);

    await expect(
      service.finalizeConfirmed(identity, request),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(counts(repository.state)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('exposes only a fully linked state if the response path fails after commit', async () => {
    const repository = new FaultInjectingAtomicRepository('after_commit');
    const Service = serviceConstructor();
    const service = new Service(repository);

    await expect(
      service.finalizeConfirmed(identity, request),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expectFullyLinked(repository.state);
  });

  it('commits every authoritative row together on success', async () => {
    const repository = new FaultInjectingAtomicRepository(null);
    const Service = serviceConstructor();
    const service = new Service(repository);

    await expect(
      service.finalizeConfirmed(identity, request),
    ).resolves.toMatchObject({
      saveStatus: 'saved',
      submissionId: 'submission_submit_atomicity_0001',
      attemptId: 'attempt_submit_atomicity_0001',
    });
    expectFullyLinked(repository.state);
  });
});
