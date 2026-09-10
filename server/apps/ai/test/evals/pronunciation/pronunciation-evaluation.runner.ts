import type { PronunciationEvalCase } from './pronunciation-eval-case.schema';
import {
  accentResidualMetrics,
  errorClassificationMetrics,
  rejectionMetrics,
  scoreAgreementMetrics,
  timestampErrorMetrics,
  wordErrorRate,
} from './pronunciation-metrics';

export type PronunciationEvaluationPrediction = Readonly<{
  annotation: PronunciationEvalCase['annotation'];
  runtime: PronunciationEvalCase['runtime'];
  schemaValidFirstPass: boolean;
  schemaValidFinal: boolean;
}>;

export interface PronunciationEvaluationProvider {
  evaluate(
    item: PronunciationEvalCase,
  ): Promise<PronunciationEvaluationPrediction>;
}

function percentile(
  values: readonly number[],
  fraction: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export class PronunciationEvaluationRunner {
  constructor(private readonly provider: PronunciationEvaluationProvider) {}

  async run(
    input: Readonly<{
      mode: 'synthetic' | 'live';
      cases: readonly PronunciationEvalCase[];
      approvals?: Readonly<{
        provider?: boolean;
        privacy?: boolean;
        model?: boolean;
        dataset?: boolean;
      }>;
      testBudgetMicros?: number;
    }>,
  ) {
    if (input.mode === 'live') this.assertLiveApproved(input);
    const rows = [];
    for (const item of [...input.cases].sort((left, right) =>
      left.caseId.localeCompare(right.caseId),
    )) {
      const prediction = await this.provider.evaluate(item);
      rows.push(
        Object.freeze({
          caseId: item.caseId,
          versions: Object.freeze({
            dataset: item.datasetVersion,
            provider: item.versions.provider,
            model: item.versions.model,
            rule: item.versions.rule,
            resultSchema: item.versions.resultSchema,
            normalization: item.versions.normalization,
            budget: item.versions.budget,
            price: item.versions.price,
            annotation: item.annotation.version,
          }),
          annotation: prediction.annotation,
          runtime: prediction.runtime,
          schemaValidFirstPass: prediction.schemaValidFirstPass,
          schemaValidFinal: prediction.schemaValidFinal,
        }),
      );
    }

    const references = rows.flatMap((row) => row.annotation.referenceWords);
    const hypotheses = rows.flatMap((row) => row.annotation.hypothesisWords);
    const goldStatuses = rows.flatMap((row) => row.annotation.goldStatuses);
    const predictedStatuses = rows.flatMap(
      (row) => row.annotation.predictedStatuses,
    );
    const scored = rows.filter(
      (row) =>
        row.annotation.humanOverallScore !== null &&
        row.annotation.predictedOverallScore !== null,
    );
    const accentSamples = rows.flatMap((row) =>
      row.annotation.accentGroup !== null &&
      row.annotation.matchedHumanScore !== null &&
      row.annotation.predictedOverallScore !== null
        ? [
            {
              group: row.annotation.accentGroup,
              humanScore: row.annotation.matchedHumanScore,
              predictedScore: row.annotation.predictedOverallScore,
            },
          ]
        : [],
    );
    const metrics = Object.freeze({
      wer: wordErrorRate(references, hypotheses),
      errors: errorClassificationMetrics(goldStatuses, predictedStatuses),
      timestamps: timestampErrorMetrics(
        rows.flatMap((row) => row.annotation.timestamps),
      ),
      scoreAgreement:
        scored.length === 0
          ? null
          : scoreAgreementMetrics(
              scored.map((row) => row.annotation.humanOverallScore!),
              scored.map((row) => row.annotation.predictedOverallScore!),
            ),
      rejection: rejectionMetrics(
        rows.map((row) => row.annotation.shouldReject),
        rows.map((row) => row.annotation.predictedReject),
      ),
      accentResidual: accentResidualMetrics(accentSamples),
      providerSuccessRate:
        rows.filter((row) => row.runtime.providerSuccess).length / rows.length,
      schemaFirstPassRate:
        rows.filter((row) => row.schemaValidFirstPass).length / rows.length,
      schemaFinalRate:
        rows.filter((row) => row.schemaValidFinal).length / rows.length,
      latencyMs: Object.freeze({
        p50: percentile(
          rows.map((row) => row.runtime.latencyMs),
          0.5,
        ),
        p95: percentile(
          rows.map((row) => row.runtime.latencyMs),
          0.95,
        ),
      }),
      totalCostMicros: rows.reduce(
        (sum, row) => sum + row.runtime.costMicros,
        0,
      ),
    });
    return Object.freeze({
      schemaVersion: 'pronunciation-evaluation-report.v1',
      mode: input.mode,
      caseCount: rows.length,
      cases: Object.freeze(rows),
      metrics,
    });
  }

  private assertLiveApproved(
    input: Readonly<{
      approvals?: Readonly<{
        provider?: boolean;
        privacy?: boolean;
        model?: boolean;
        dataset?: boolean;
      }>;
      testBudgetMicros?: number;
    }>,
  ): void {
    const approvals = input.approvals;
    if (
      !approvals?.provider ||
      !approvals.privacy ||
      !approvals.model ||
      !approvals.dataset ||
      !Number.isSafeInteger(input.testBudgetMicros) ||
      (input.testBudgetMicros ?? 0) <= 0
    ) {
      throw new Error('LIVE_PRONUNCIATION_EVALUATION_NOT_APPROVED');
    }
  }
}
