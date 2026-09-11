import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type InternalRecord = Record<string, unknown> & {
  id: string;
  userId: string;
  selectorHmac: string;
  state: string;
  expiresAt: Date;
};

class MemoryRepository {
  record: InternalRecord | null = null;

  async createScoped(_identity: unknown, input: InternalRecord) {
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
      fromStates: readonly string[];
      toState: string;
      now: Date;
      confirmedAt?: Date;
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
    confirmation: InternalRecord;
  }>;
  getWeb(selector: string, userId: string): Promise<unknown>;
  decideWeb(selector: string, web: unknown, input: unknown): Promise<unknown>;
};

type Constructor = new (
  repository: MemoryRepository,
  options: Record<string, unknown>,
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

const now = new Date('2026-09-11T08:00:00.000Z');
const identity = Object.freeze({
  issuer: 'https://issuer.mcp.test',
  subjectHmac: 'subject_confirmation_web_a',
  userId: 'learner_confirmation_web_a',
  authorizationId: 'authorization_confirmation_web_a',
  clientId: 'trusted-learning-client',
  audience: 'https://resource.mcp.test/ai/v1/mcp',
  authorizationVersion: 1,
});
const createInput = Object.freeze({
  idempotencyIntentId: 'intent_confirmation_web_0001',
  scopeSnapshotDigest: 'a'.repeat(64),
  exerciseId: 'exercise_confirmation_web_0001',
  exerciseVersion: 'exercise.web.v1',
  answerDigest: 'b'.repeat(64),
  operationSummary: Object.freeze({
    answerCount: 1,
    willSaveAttempt: true,
    willUpdateMastery: true,
    willUpdateReviewSchedule: true,
    notice: 'The graded attempt and resulting review changes will be saved.',
  }),
  clientDisplayName: 'Trusted Learning Client',
  exerciseTitle: 'Meeting vocabulary',
  itemCount: 1,
});

async function fixture() {
  const repository = new MemoryRepository();
  const Service = load();
  const service = new Service(
    repository,
    {
      hmacKey: 'mcp-confirmation-web-security-key-000001',
      ttlMs: 300_000,
      toolVersion: 'en-learning.mcp.v1',
      summaryVersion: 'mcp.write-summary.v1',
      maximumReauthenticationAgeMs: 5 * 60 * 1_000,
    },
    () => now,
    () => 'selector_confirmation_web_000000001',
  );
  const created = await service.create(identity, createInput);
  return { repository, service, created };
}

function validWeb() {
  return {
    userId: identity.userId,
    sessionUserId: identity.userId,
    reauthenticatedAt: new Date('2026-09-11T07:59:30.000Z'),
    tokenExpiresAt: new Date('2026-09-11T08:10:00.000Z'),
    csrfVerified: true,
    csrfReplayDetected: false,
  };
}

describe('MCP Web confirmation identity and leakage safety', () => {
  it('uses a not-found oracle for a wrong user or guessed selector', async () => {
    const test = await fixture();

    await expect(
      test.service.getWeb(test.created.selector, 'learner_confirmation_web_b'),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      test.service.getWeb(
        'selector_confirmation_web_guessed99',
        identity.userId,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      test.service.decideWeb(
        test.created.selector,
        { ...validWeb(), userId: 'learner_confirmation_web_b' },
        {
          decision: 'confirm',
          operationSummaryDigest:
            test.created.confirmation.operationSummaryDigest,
        },
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it.each([
    [
      'stale reauthentication',
      { reauthenticatedAt: new Date('2026-09-11T07:54:59.999Z') },
      'UNAUTHENTICATED',
    ],
    [
      'expired Web token',
      { tokenExpiresAt: new Date('2026-09-11T08:00:00.000Z') },
      'UNAUTHENTICATED',
    ],
    [
      'session identity mismatch',
      { sessionUserId: 'learner_confirmation_web_b' },
      'UNAUTHENTICATED',
    ],
    ['failed CSRF', { csrfVerified: false }, 'VALIDATION_FAILED'],
    ['replayed CSRF', { csrfReplayDetected: true }, 'VALIDATION_FAILED'],
  ] as const)(
    'rejects %s without changing confirmation state',
    async (_name, change, code) => {
      const test = await fixture();

      await expect(
        test.service.decideWeb(
          test.created.selector,
          { ...validWeb(), ...change },
          {
            decision: 'confirm',
            operationSummaryDigest:
              test.created.confirmation.operationSummaryDigest,
          },
        ),
      ).rejects.toMatchObject({ code });
      expect(test.repository.record?.state).toBe('PENDING');
    },
  );

  it('binds the decision to the exact displayed summary and rejects client overrides', async () => {
    const test = await fixture();
    for (const decision of [
      {
        decision: 'confirm',
        operationSummaryDigest: 'f'.repeat(64),
      },
      {
        decision: 'confirm',
        operationSummaryDigest:
          test.created.confirmation.operationSummaryDigest,
        clientId: 'attacker-client',
      },
      {
        decision: 'confirm',
        operationSummaryDigest:
          test.created.confirmation.operationSummaryDigest,
        redirectUrl: 'https://attacker.invalid',
      },
    ]) {
      await expect(
        test.service.decideWeb(test.created.selector, validWeb(), decision),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(test.repository.record?.state).toBe('PENDING');
  });

  it('projects only the learner-visible summary and no secret binding fields', async () => {
    const test = await fixture();
    const view = await test.service.getWeb(
      test.created.selector,
      identity.userId,
    );
    const serialized = JSON.stringify(view);

    expect(view).toMatchObject({
      status: 'pending',
      clientDisplayName: createInput.clientDisplayName,
      toolName: 'submit_answer',
      exercise: { itemCount: 1, version: createInput.exerciseVersion },
    });
    expect(serialized).not.toContain(createInput.answerDigest);
    expect(serialized).not.toContain(identity.subjectHmac);
    expect(serialized).not.toContain(identity.authorizationId);
    expect(serialized).not.toContain(createInput.exerciseId);
    expect(serialized).not.toContain(test.created.selector);
    expect(serialized).not.toMatch(
      /answerKey|gradingRubric|accessToken|Bearer/iu,
    );
  });
});
