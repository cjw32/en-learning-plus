/* eslint-disable @typescript-eslint/no-unsafe-argument -- Synchronous typed test doubles preserve async ports, and Jest assertions intentionally inspect mock methods. */

import { resolve } from 'node:path';
import { loadPronunciationEvalCases } from './pronunciation-eval-case.schema';
import {
  PronunciationEvaluationRunner,
  type PronunciationEvaluationProvider,
} from './pronunciation-evaluation.runner';

describe('pronunciation evaluation runner', () => {
  const cases = loadPronunciationEvalCases(
    resolve(__dirname, 'fixtures/manifest.jsonl'),
  );
  const provider: PronunciationEvaluationProvider = {
    evaluate: jest.fn(async (item) => ({
      annotation: item.annotation,
      runtime: item.runtime,
      schemaValidFirstPass: true,
      schemaValidFinal: true,
    })),
  };

  it('produces deterministic JSON with every behavior-affecting version', async () => {
    const runner = new PronunciationEvaluationRunner(provider);
    const input = { mode: 'synthetic' as const, cases };
    const first = await runner.run(input);
    const second = await runner.run(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.caseCount).toBe(3);
    expect(
      first.cases.every((item) =>
        Object.values(item.versions).every(
          (value) => typeof value === 'string' && value.length > 0,
        ),
      ),
    ).toBe(true);
    expect(first.cases[0]).toHaveProperty('versions.dataset', 'synthetic-v1');
    expect(first.metrics).toMatchObject({
      providerSuccessRate: 2 / 3,
      schemaFirstPassRate: 1,
      schemaFinalRate: 1,
      latencyMs: { p50: 10, p95: 20 },
      totalCostMicros: 0,
      wer: { wer: 0.75 },
      timestamps: { sampleCount: 3, maeMs: 20, p95Ms: 40 },
      scoreAgreement: { sampleCount: 2, mae: 2, correlation: 1 },
      rejection: { truePositiveRate: 1, falsePositiveRate: 0 },
    });
  });

  it.each([
    [{}, 10],
    [{ provider: true, privacy: true, model: true, dataset: true }, 0],
    [{ provider: true, privacy: true, model: true }, 10],
  ])(
    'refuses live mode without every approval and positive budget',
    async (approvals, testBudgetMicros) => {
      await expect(
        new PronunciationEvaluationRunner(provider).run({
          mode: 'live',
          cases,
          approvals,
          testBudgetMicros,
        }),
      ).rejects.toThrow('LIVE_PRONUNCIATION_EVALUATION_NOT_APPROVED');
    },
  );
});
