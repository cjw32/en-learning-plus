import { MCP_SCHEMA_VERSION } from '@en/common/mcp';
import { McpCostMeter } from '../../src/mcp/governance/mcp-cost-meter';
import { WriteConfirmationService } from '../../src/mcp/confirmation/write-confirmation.service';
import { McpModernConfirmationPresenter } from '../../src/mcp/elicitation/mcp-modern-confirmation.presenter';
import { McpLegacyConfirmationPresenter } from '../../src/mcp/elicitation/mcp-legacy-confirmation.presenter';
import { McpSubmitAnswerOrchestrator } from '../../src/mcp/tools/submit-answer.tool';
import { McpSubmitAnswerService } from '@libs/learning';

type ConfirmationState =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CLAIMED'
  | 'CONSUMED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FAILED';

class ConfirmationMemoryRepository {
  record: Record<string, unknown> | null = null;

  async createScoped(_identity: unknown, input: Record<string, unknown>) {
    if (this.record) throw new Error('duplicate confirmation');
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

  async findOwnedById(identity: { userId: string }, confirmationId: string) {
    return this.record?.userId === identity.userId &&
      this.record.id === confirmationId
      ? { ...this.record }
      : null;
  }

  async transitionOwned(
    identity: { userId: string },
    id: string,
    transition: {
      fromStates: readonly ConfirmationState[];
      toState: ConfirmationState;
      now: Date;
      requireUnexpiredAt?: Date;
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
      !transition.fromStates.includes(this.record.state as ConfirmationState) ||
      (transition.requireUnexpiredAt &&
        (this.record.expiresAt as Date) <= transition.requireUnexpiredAt)
    ) {
      return null;
    }
    this.record = {
      ...this.record,
      state: transition.toState,
      updatedAt: transition.now,
      confirmedAt: transition.confirmedAt ?? this.record.confirmedAt,
      claimedAt: transition.claimedAt ?? this.record.claimedAt,
      consumedAt: transition.consumedAt ?? this.record.consumedAt,
      confirmingWebUserIdHmac:
        transition.confirmingWebUserIdHmac ??
        this.record.confirmingWebUserIdHmac,
    };
    return { ...this.record };
  }
}

const identity = Object.freeze({
  issuer: 'https://issuer.e2e.test',
  subjectHmac: 'subject_hmac_submit_e2e_0001',
  userId: 'learner_submit_e2e',
  authorizationId: 'authorization_submit_e2e',
  clientId: 'client-submit-e2e',
  audience: 'https://resource.e2e.test/ai/v1/mcp',
  authorizationVersion: 1,
});

const input = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  exerciseId: 'exercise_submit_e2e_0001',
  exerciseVersion: 'exercise-submit-e2e.v1',
  answers: Object.freeze([
    Object.freeze({ itemId: 'item_submit_e2e_0001', value: 'agenda' }),
  ]),
  idempotencyKey: 'submit-e2e-idempotency-0001',
});

const prepared = Object.freeze({
  schemaVersion: 'mcp.submit-preparation.v1' as const,
  exerciseId: input.exerciseId,
  exerciseVersion: input.exerciseVersion,
  gradeRequestId: 'request_mcp_submit_e2e_0001',
  answerVersion: 'a'.repeat(64),
  gradingHash: 'b'.repeat(64),
  score: 80,
  correction: '',
  explanation: 'The target word was used appropriately.',
  examples: Object.freeze([]),
  errorTypes: Object.freeze([]),
  items: Object.freeze([
    Object.freeze({
      itemId: 'item_submit_e2e_0001',
      isCorrect: true,
      score: 80,
      correction: '',
      explanation: 'The target word was used appropriately.',
      errorTypes: Object.freeze([]),
      examples: Object.freeze([]),
      targetQualities: Object.freeze([
        Object.freeze({
          targetType: 'WORD' as const,
          targetKey: 'word_agenda',
          quality: 4,
        }),
      ]),
    }),
  ]),
});

function context(
  protocolVersion: '2026-07-28' | '2025-11-25',
  traceId: string,
) {
  return Object.freeze({
    principal: Object.freeze({
      issuer: identity.issuer,
      subject: 'subject-submit-e2e',
      audience: identity.audience,
      clientId: identity.clientId,
      scopes: Object.freeze(['answer:submit'] as const),
      authorizationVersion: 1,
      issuedAtEpochSeconds: 1,
      notBeforeEpochSeconds: 1,
      expiresAtEpochSeconds: 4_000_000_000,
      verificationMethodVersion: 'e2e.v1',
    }),
    userId: identity.userId,
    authorizationId: identity.authorizationId,
    requestId: `request_${traceId}`.slice(0, 128),
    traceId,
    protocolVersion,
  });
}

function fixture(protocolVersion: '2026-07-28' | '2025-11-25') {
  let now = new Date();
  let staged: unknown;
  let terminal: unknown;
  let writes = 0;
  let queue = Promise.resolve();
  const intent = {
    id: `intent_submit_e2e_${protocolVersion.replaceAll('-', '_')}`,
    requestFingerprint: 'c'.repeat(64),
  };
  const confirmationRepository = new ConfirmationMemoryRepository();
  const confirmations = new WriteConfirmationService(
    confirmationRepository as never,
    {
      hmacKey: 'submit-e2e-confirmation-hmac-key-000001',
      ttlMs: 5 * 60 * 1_000,
      toolVersion: 'en-learning.mcp.v1',
      summaryVersion: 'mcp.write-summary.v1',
      maximumReauthenticationAgeMs: 5 * 60 * 1_000,
    },
    () => now,
    () => 'selector_submit_e2e_000000000000000001',
  );
  const metrics: Record<string, unknown>[] = [];
  const costs = new McpCostMeter({
    sink: {
      record: () => undefined,
      recordSubmit: (metric) => void metrics.push(metric),
    },
    hmacKey: 'submit-e2e-cost-meter-hmac-key-0000001',
    provider: 'deterministic-e2e',
    model: 'grading-e2e-v1',
    inputMicrosPerMillionTokens: 10_000,
    outputMicrosPerMillionTokens: 20_000,
  });
  const idempotency = {
    beginSubmitAnswer: jest.fn(async () =>
      terminal
        ? { action: 'REPLAY' as const, intent, result: terminal }
        : staged
          ? { action: 'IN_PROGRESS' as const, intent, retryAfterMs: 1_000 }
          : { action: 'EXECUTE' as const, intent },
    ),
    loadSubmitPreparation: jest.fn(async () =>
      staged
        ? {
            intent,
            gradingResult: staged,
            gradingResultHash: 'd'.repeat(64),
          }
        : null,
    ),
    stageSubmitPreparation: jest.fn(),
  };
  const bridge = {
    prepareSubmitAnswer: jest.fn(async (request) => {
      const session = costs.beginSubmit({ traceId: request.traceId });
      session.telemetry.onFirstOutput();
      session.telemetry.onUsage({ inputTokens: 120, outputTokens: 80 });
      staged = prepared;
      await session.finish({
        outcome: 'prepared',
        cancellationOutcome: 'completed',
        gradingMs: 20,
        projectionMs: 5,
        totalMs: 25,
      });
      return prepared;
    }),
  };
  const atomicRepository = {
    finalizeAtomic: jest.fn(async (_currentIdentity, command) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (terminal) {
          return {
            ...(terminal as Record<string, unknown>),
            saveStatus: 'replayed',
            traceId: command.traceId,
          };
        }
        writes += 1;
        terminal = {
          schemaVersion: MCP_SCHEMA_VERSION,
          ok: true,
          submissionId: command.grading.submissionId,
          attemptId: 'attempt_submit_e2e_0001',
          saveStatus: 'saved',
          score: prepared.score,
          items: prepared.items.map((item) => ({
            itemId: item.itemId,
            score: item.score,
            correction: item.correction,
            explanation: item.explanation,
            errorTypes: item.errorTypes,
          })),
          learningChanges: [
            {
              targetType: 'WORD',
              targetKey: 'word_agenda',
              previousState: 'LEARNING',
              nextState: 'REVIEW',
              nextReviewAt: new Date(now.getTime() + 86_400_000).toISOString(),
            },
          ],
          traceId: command.traceId,
        };
        return terminal;
      } finally {
        release();
      }
    }),
  };
  const modern = new McpModernConfirmationPresenter({
    confirmationPageOrigin: 'https://learn.en-learning.test',
    requestStateCodec: { mint: async () => 'signed-modern-e2e-state' },
  });
  const legacyBindings: unknown[] = [];
  const legacy = new McpLegacyConfirmationPresenter({
    confirmationPageOrigin: 'https://learn.en-learning.test',
    sessionBinding: {
      bind: async (binding) => void legacyBindings.push(binding),
    },
  });
  const presenter = {
    present: async (projection) =>
      protocolVersion === '2026-07-28'
        ? modern.present(projection)
        : legacy.present({
            ...projection,
            sessionId: projection.sessionId!,
          }),
  };
  const orchestrator = new McpSubmitAnswerOrchestrator(
    { resolve: async () => identity },
    idempotency as never,
    bridge,
    confirmations,
    {
      summarize: () => ({
        answerCount: 1,
        willSaveAttempt: true,
        willUpdateMastery: true,
        willUpdateReviewSchedule: true,
        notice: 'Your answer will be saved and the review schedule updated.',
      }),
    },
    new McpSubmitAnswerService(atomicRepository as never),
    { reconcile: jest.fn() } as never,
    presenter,
    costs,
    () => now,
  );
  const request = (traceId: string) => ({
    userId: identity.userId,
    authorizationId: identity.authorizationId,
    issuer: identity.issuer,
    clientId: identity.clientId,
    requestId: `request_${traceId}`.slice(0, 128),
    traceId,
    context: context(protocolVersion, traceId),
    input,
    deadline: new Date(Date.now() + 30_000),
    ...(protocolVersion === '2025-11-25'
      ? { sessionId: 'legacy_session_submit_e2e_0001' }
      : {}),
  });
  return {
    orchestrator,
    request,
    confirmations,
    confirmationRepository,
    metrics,
    bridge,
    atomicRepository,
    legacyBindings,
    writes: () => writes,
    currentTime: () => new Date(now),
    advance: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

describe('MCP submit_answer both-era confirmed write flow', () => {
  it.each(['2026-07-28', '2025-11-25'] as const)(
    'requires project Web confirmation and performs one write under %s concurrency',
    async (protocolVersion) => {
      const test = fixture(protocolVersion);
      const first = await test.orchestrator.submit(
        test.request(`trace_submit_e2e_${protocolVersion}_first`),
      );
      const serialized = JSON.stringify(first);
      expect(serialized).toContain(
        'https://learn.en-learning.test/mcp/confirmations/selector_submit_e2e_000000000000000001',
      );
      expect(test.writes()).toBe(0);

      const selector = 'selector_submit_e2e_000000000000000001';
      const view = (await test.confirmations.getWeb(
        selector,
        identity.userId,
      )) as { operationSummaryDigest: string };
      await test.confirmations.decideWeb(
        selector,
        {
          userId: identity.userId,
          sessionUserId: identity.userId,
          reauthenticatedAt: test.currentTime(),
          tokenExpiresAt: new Date(
            test.currentTime().getTime() + 5 * 60 * 1_000,
          ),
          csrfVerified: true,
        },
        {
          decision: 'confirm',
          operationSummaryDigest: view.operationSummaryDigest,
        },
      );

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          test.orchestrator.submit(
            test.request(`trace_submit_e2e_${protocolVersion}_${index}`),
          ),
        ),
      );
      expect(test.writes()).toBe(1);
      expect(test.atomicRepository.finalizeAtomic).toHaveBeenCalledTimes(8);
      expect(
        results.filter(
          (result) => (result as { saveStatus: string }).saveStatus === 'saved',
        ),
      ).toHaveLength(1);
      expect(
        results.filter(
          (result) =>
            (result as { saveStatus: string }).saveStatus === 'replayed',
        ),
      ).toHaveLength(7);
      expect(test.bridge.prepareSubmitAnswer).toHaveBeenCalledTimes(1);
      expect(
        test.metrics.filter((metric) => metric.estimatedCostMicros === 3),
      ).toHaveLength(1);
      expect(
        test.metrics
          .slice(1)
          .every((metric) => metric.estimatedCostMicros === 0),
      ).toBe(true);
      if (protocolVersion === '2025-11-25') {
        expect(test.legacyBindings).toHaveLength(1);
      }
    },
  );

  it('expires at five minutes and creates no authoritative write', async () => {
    const test = fixture('2026-07-28');
    await test.orchestrator.submit(
      test.request('trace_submit_e2e_expiry_first'),
    );
    test.advance(5 * 60 * 1_000);

    await expect(
      test.orchestrator.submit(test.request('trace_submit_e2e_expiry_retry')),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_EXPIRED' });
    expect(test.writes()).toBe(0);
    expect(test.atomicRepository.finalizeAtomic).not.toHaveBeenCalled();
  });
});
