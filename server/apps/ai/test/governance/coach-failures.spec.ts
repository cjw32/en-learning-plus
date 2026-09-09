import {
  CoachBudgetService,
  type CoachBudgetLimits,
} from '../../src/coach/governance/coach-budget.service';
import {
  CoachConcurrencyLimitService,
  CoachRateLimitService,
  InMemoryRateLimitStore,
} from '../../src/coach/governance/coach-rate-limit.service';
import {
  CoachCostMeter,
} from '../../src/coach/governance/coach-cost-meter';
import {
  CoachModelPriceCatalog,
} from '../../src/coach/governance/model-price.catalog';
import { mapCoachFailure } from '../../src/coach/governance/coach-failure.mapper';
import { buildCoachFailureFallback } from '../../src/coach/workflow/fallback.builder';
import {
  runCoachGovernedSteps,
} from '../../src/coach/queue/coach.processor';
import {
  CoachAdmissionService,
  type CoachConcurrencyStore,
} from '../../src/coach/governance/coach-admission.service';

const limits: CoachBudgetLimits = {
  maxInputTokens: 100,
  maxOutputTokens: 50,
  maxModelCalls: 2,
  maxToolCalls: 3,
  maxCostMicros: 1_000,
  maxDurationMs: 500,
};

describe('Coach governance and failure handling', () => {
  it('enforces approved distributed subject, IP and concurrency admission', async () => {
    const active = new Set<string>();
    const concurrency: CoachConcurrencyStore = {
      async acquire(key) {
        if (active.has(key)) return false;
        active.add(key);
        return true;
      },
      async release(key) {
        active.delete(key);
      },
    };
    const service = new CoachAdmissionService(
      new InMemoryRateLimitStore(),
      concurrency,
      {
        COACH_RATE_LIMIT_WINDOW_SECONDS: '60',
        COACH_RATE_LIMIT_SUBJECT_COUNT: '10',
        COACH_RATE_LIMIT_IP_COUNT: '1',
        COACH_MAX_CONCURRENT_REQUESTS: '1',
        COACH_MAX_DURATION_MS: '60000',
      },
    );
    await service.consumeIp('203.0.113.10');
    await expect(service.consumeIp('203.0.113.10')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await service.acquireSubject('user-a');
    await expect(service.acquireSubject('user-a')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await service.releaseSubject('user-a');
    await expect(service.acquireSubject('user-a')).resolves.toBeUndefined();
  });

  it('fails closed when admission thresholds are not approved', async () => {
    const concurrency: CoachConcurrencyStore = {
      async acquire() {
        return true;
      },
      async release() {},
    };
    const service = new CoachAdmissionService(
      new InMemoryRateLimitStore(),
      concurrency,
      {},
    );
    await expect(service.acquireSubject('user-a')).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });
  });

  it.each([
    ['inputTokens', { inputTokens: 101, outputTokens: 0, modelCalls: 0, toolCalls: 0, costMicros: 0, elapsedMs: 0 }],
    ['outputTokens', { inputTokens: 0, outputTokens: 51, modelCalls: 0, toolCalls: 0, costMicros: 0, elapsedMs: 0 }],
    ['modelCalls', { inputTokens: 0, outputTokens: 0, modelCalls: 3, toolCalls: 0, costMicros: 0, elapsedMs: 0 }],
    ['toolCalls', { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 4, costMicros: 0, elapsedMs: 0 }],
    ['costMicros', { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 0, costMicros: 1_001, elapsedMs: 0 }],
    ['elapsedMs', { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 0, costMicros: 0, elapsedMs: 500 }],
  ] as const)('fails closed before a node exceeding %s', (_name, projected) => {
    expect(() => new CoachBudgetService(limits).assertCanStartNode(projected)).toThrow(
      expect.objectContaining({ code: 'BUDGET_EXCEEDED' }),
    );
  });

  it('applies independent user, IP and concurrency admission limits', async () => {
    const limiter = new CoachRateLimitService(
      new InMemoryRateLimitStore(),
      { limit: 1, windowSeconds: 60 },
      () => 0,
    );
    await limiter.consume('user-a', 'request');
    await expect(limiter.consume('user-a', 'request')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await limiter.consumeIp('203.0.113.10', 'request');
    await expect(limiter.consumeIp('203.0.113.10', 'request')).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    const concurrency = new CoachConcurrencyLimitService(1);
    const lease = concurrency.acquire('user-a');
    expect(() => concurrency.acquire('user-a')).toThrow(
      expect.objectContaining({ code: 'RATE_LIMITED' }),
    );
    lease.release();
    expect(() => concurrency.acquire('user-a')).not.toThrow();
  });

  it('computes repeatable model cost and refuses unknown or expired prices', () => {
    const catalog = new CoachModelPriceCatalog([
      {
        provider: 'deepseek',
        modelName: 'deepseek-chat',
        priceVersion: 'price-v1',
        inputMicrosPerMillionTokens: 1_000_000,
        outputMicrosPerMillionTokens: 2_000_000,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2027-01-01T00:00:00.000Z',
      },
    ]);
    const meter = new CoachCostMeter(catalog);
    expect(
      meter.estimate({
        provider: 'deepseek',
        modelName: 'deepseek-chat',
        priceVersion: 'price-v1',
        inputTokens: 100,
        outputTokens: 50,
        at: new Date('2026-09-02T00:00:00.000Z'),
      }),
    ).toEqual({ estimatedCostMicros: 200, currency: 'USD', priceVersion: 'price-v1' });
    expect(() =>
      meter.estimate({
        provider: 'deepseek',
        modelName: 'unknown',
        priceVersion: 'price-v1',
        inputTokens: 1,
        outputTokens: 1,
        at: new Date('2026-09-02T00:00:00.000Z'),
      }),
    ).toThrow(expect.objectContaining({ code: 'BUDGET_EXCEEDED' }));
  });

  it.each([
    ['MODEL_UNAVAILABLE', true],
    ['DATA_NOT_AVAILABLE', true],
    ['TOOL_TIMEOUT', true],
    ['REQUEST_TIMEOUT', true],
    ['BUDGET_EXCEEDED', false],
    ['STATE_CONFLICT', false],
    ['INTERNAL_ERROR', true],
  ] as const)('maps %s to a stable safe failure', (code, retryable) => {
    const failure = mapCoachFailure({
      code,
      message: 'provider SQL failed\n    at private.ts:42:1',
      stack: 'private stack',
    });
    expect(failure).toMatchObject({ code, retryable, saveStatus: 'NOT_STARTED' });
    expect(JSON.stringify(failure)).not.toMatch(/provider|SQL|private\.ts|stack/i);
    const fallback = buildCoachFailureFallback('trace_failure_001', failure);
    expect(fallback.result).toMatchObject({
      responseType: 'degraded',
      score: null,
      citations: [],
    });
    expect(fallback.result).not.toHaveProperty('learningUpdate');
  });

  it('aborts a timed-out tool and never starts the following write step', async () => {
    const save = jest.fn();
    let toolSignal: AbortSignal | undefined;
    await expect(
      runCoachGovernedSteps({
        budget: new CoachBudgetService(limits),
        startedAtMs: 0,
        now: () => 10,
        signal: new AbortController().signal,
        steps: [
          {
            name: 'materials',
            kind: 'tool',
            timeoutMs: 5,
            projected: { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 1, costMicros: 0 },
            run: async (signal) => {
              toolSignal = signal;
              await new Promise((resolve) => setTimeout(resolve, 20));
              return { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 1, costMicros: 0 };
            },
          },
          {
            name: 'save_attempt',
            kind: 'write',
            timeoutMs: 50,
            projected: { inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 1, costMicros: 0 },
            run: save,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' });
    expect(toolSignal?.aborted).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
