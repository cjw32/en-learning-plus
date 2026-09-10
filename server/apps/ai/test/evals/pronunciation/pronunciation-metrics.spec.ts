import {
  accentResidualMetrics,
  errorClassificationMetrics,
  rejectionMetrics,
  repeatDriftMetrics,
  scoreAgreementMetrics,
  timestampErrorMetrics,
  wordErrorRate,
} from './pronunciation-metrics';

describe('pronunciation deterministic evaluation metrics', () => {
  it('computes WER without truncating values above one', () => {
    expect(wordErrorRate(['a'], ['x', 'y', 'z'])).toEqual({
      substitutions: 1,
      deletions: 0,
      insertions: 2,
      referenceWords: 1,
      wer: 3,
    });
  });

  it('reports precision/recall/F1 independently per error status', () => {
    const result = errorClassificationMetrics(
      ['mispronounced', 'omitted', 'inserted', 'correct'],
      ['mispronounced', 'correct', 'inserted', 'mispronounced'],
    );
    expect(result.mispronounced).toMatchObject({ tp: 1, fp: 1, fn: 0 });
    expect(result.mispronounced.precision).toBeCloseTo(0.5);
    expect(result.mispronounced.recall).toBe(1);
    expect(result.mispronounced.f1).toBeCloseTo(2 / 3);
    expect(result.omitted).toMatchObject({ precision: 0, recall: 0, f1: 0 });
    expect(result.inserted).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });

  it('computes timestamp MAE/P95 and score MAE/correlation by hand', () => {
    expect(
      timestampErrorMetrics([
        { goldMs: 0, predictedMs: 10 },
        { goldMs: 0, predictedMs: 20 },
        { goldMs: 0, predictedMs: 30 },
        { goldMs: 0, predictedMs: 100 },
      ]),
    ).toEqual({ sampleCount: 4, maeMs: 40, p95Ms: 100 });
    const score = scoreAgreementMetrics([50, 60, 70], [55, 65, 60]);
    expect(score.mae).toBeCloseTo(20 / 3);
    expect(score.correlation).toBeCloseTo(0.5);
  });

  it('computes repeated-run max/mean absolute score drift', () => {
    expect(
      repeatDriftMetrics([
        [80, 84, 79],
        [60, 60],
      ]),
    ).toEqual({
      comparisonCount: 3,
      maxAbsoluteDelta: 4,
      meanAbsoluteDelta: 5 / 3,
    });
  });

  it('computes bad-audio rejection TPR/FPR without merging them', () => {
    expect(
      rejectionMetrics([true, true, false, false], [true, false, true, false]),
    ).toEqual({
      tp: 1,
      fn: 1,
      fp: 1,
      tn: 1,
      truePositiveRate: 0.5,
      falsePositiveRate: 0.5,
    });
  });

  it('computes matched-score accent residual group means and max gap', () => {
    expect(
      accentResidualMetrics([
        { group: 'A', humanScore: 80, predictedScore: 82 },
        { group: 'A', humanScore: 70, predictedScore: 74 },
        { group: 'B', humanScore: 80, predictedScore: 79 },
        { group: 'B', humanScore: 70, predictedScore: 71 },
      ]),
    ).toEqual({ groupMeanResiduals: { A: 3, B: 0 }, maxGap: 3 });
  });
});
