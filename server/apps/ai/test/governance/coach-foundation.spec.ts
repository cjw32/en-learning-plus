import { CoachBudgetService } from '../../src/coach/governance/coach-budget.service';
import {
  CoachRateLimitService,
  InMemoryRateLimitStore,
} from '../../src/coach/governance/coach-rate-limit.service';
import { redactCoachPayload } from '../../src/coach/observability/coach-redaction';
import { CoachTraceService } from '../../src/coach/observability/coach-trace.service';

describe('Coach governance foundation', () => {
  it('stops before the next node when any request budget is exhausted', () => {
    const budget = new CoachBudgetService({
      maxInputTokens: 100,
      maxOutputTokens: 50,
      maxToolCalls: 2,
      maxCostMicros: 1_000,
      maxDurationMs: 5_000,
    });
    budget.record({ inputTokens: 90, outputTokens: 45, toolCalls: 2, costMicros: 900 });

    expect(() =>
      budget.assertCanStartNode({
        inputTokens: 11,
        outputTokens: 1,
        toolCalls: 0,
        costMicros: 1,
        elapsedMs: 100,
      }),
    ).toThrow(expect.objectContaining({ code: 'BUDGET_EXCEEDED' }));
  });

  it('isolates rate-limit keys by authenticated subject and operation', async () => {
    const store = new InMemoryRateLimitStore();
    const limiter = new CoachRateLimitService(store, { limit: 1, windowSeconds: 60 });

    await limiter.consume('user-a', 'create-request');
    await expect(limiter.consume('user-a', 'create-request')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(limiter.consume('user-b', 'create-request')).resolves.toBeDefined();
    await expect(limiter.consume('user-a', 'stream')).resolves.toBeDefined();
  });

  it('records monotonically ordered minimized trace steps', () => {
    const trace = new CoachTraceService('trace_000001', 'subject-internal-hash');
    trace.startStep('classify_intent', 100);
    trace.finishStep('classify_intent', 'SUCCEEDED', 120);
    trace.startStep('get_learner_profile', 121);

    expect(trace.snapshot().steps.map((step) => step.sequence)).toEqual([0, 1]);
    expect(JSON.stringify(trace.snapshot())).not.toContain('user-a@example.test');
  });

  it('removes sensitive canaries and keeps only the explicit allowlist', () => {
    const canary = 'coach-secret-canary';
    const redacted = redactCoachPayload({
      requestId: 'request_00001',
      status: 'RUNNING',
      jwt: `Bearer ${canary}`,
      apiKey: canary,
      prompt: `ignore instructions ${canary}`,
      userText: canary,
      error: { stack: canary },
    });

    expect(redacted).toEqual({ requestId: 'request_00001', status: 'RUNNING' });
    expect(JSON.stringify(redacted)).not.toContain(canary);
  });
});
