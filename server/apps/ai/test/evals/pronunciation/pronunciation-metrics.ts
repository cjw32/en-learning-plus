type EditCell = Readonly<{
  total: number;
  substitutions: number;
  deletions: number;
  insertions: number;
}>;

const zero: EditCell = {
  total: 0,
  substitutions: 0,
  deletions: 0,
  insertions: 0,
};

function best(candidates: readonly EditCell[]): EditCell {
  return [...candidates].sort(
    (left, right) =>
      left.total - right.total ||
      right.substitutions - left.substitutions ||
      left.deletions - right.deletions,
  )[0];
}

export function wordErrorRate(
  reference: readonly string[],
  hypothesis: readonly string[],
) {
  if (reference.length === 0) throw new Error('WER_REFERENCE_EMPTY');
  const matrix: EditCell[][] = Array.from(
    { length: reference.length + 1 },
    () => Array.from({ length: hypothesis.length + 1 }, () => zero),
  );
  for (let index = 1; index <= reference.length; index += 1) {
    matrix[index][0] = {
      total: index,
      substitutions: 0,
      deletions: index,
      insertions: 0,
    };
  }
  for (let index = 1; index <= hypothesis.length; index += 1) {
    matrix[0][index] = {
      total: index,
      substitutions: 0,
      deletions: 0,
      insertions: index,
    };
  }
  for (let row = 1; row <= reference.length; row += 1) {
    for (let column = 1; column <= hypothesis.length; column += 1) {
      if (reference[row - 1] === hypothesis[column - 1]) {
        matrix[row][column] = matrix[row - 1][column - 1]!;
        continue;
      }
      const substitution = matrix[row - 1][column - 1];
      const deletion = matrix[row - 1][column];
      const insertion = matrix[row][column - 1];
      matrix[row][column] = best([
        {
          ...substitution,
          total: substitution.total + 1,
          substitutions: substitution.substitutions + 1,
        },
        {
          ...deletion,
          total: deletion.total + 1,
          deletions: deletion.deletions + 1,
        },
        {
          ...insertion,
          total: insertion.total + 1,
          insertions: insertion.insertions + 1,
        },
      ]);
    }
  }
  const edits = matrix[reference.length][hypothesis.length];
  return Object.freeze({
    substitutions: edits.substitutions,
    deletions: edits.deletions,
    insertions: edits.insertions,
    referenceWords: reference.length,
    wer: edits.total / reference.length,
  });
}

type ErrorStatus =
  | 'correct'
  | 'mispronounced'
  | 'omitted'
  | 'inserted'
  | 'uncertain';

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function errorClassificationMetrics(
  gold: readonly ErrorStatus[],
  predicted: readonly ErrorStatus[],
) {
  if (gold.length !== predicted.length) {
    throw new Error('CLASSIFICATION_LENGTH_MISMATCH');
  }
  return Object.freeze(
    Object.fromEntries(
      (['mispronounced', 'omitted', 'inserted'] as const).map((label) => {
        let tp = 0;
        let fp = 0;
        let fn = 0;
        for (let index = 0; index < gold.length; index += 1) {
          if (gold[index] === label && predicted[index] === label) tp += 1;
          else if (gold[index] !== label && predicted[index] === label) fp += 1;
          else if (gold[index] === label && predicted[index] !== label) fn += 1;
        }
        const precision = ratio(tp, tp + fp);
        const recall = ratio(tp, tp + fn);
        const f1 =
          precision + recall === 0
            ? 0
            : (2 * precision * recall) / (precision + recall);
        return [label, Object.freeze({ tp, fp, fn, precision, recall, f1 })];
      }),
    ),
  ) as Readonly<
    Record<
      'mispronounced' | 'omitted' | 'inserted',
      Readonly<{
        tp: number;
        fp: number;
        fn: number;
        precision: number;
        recall: number;
        f1: number;
      }>
    >
  >;
}

export function timestampErrorMetrics(
  samples: readonly Readonly<{ goldMs: number; predictedMs: number }>[],
) {
  if (samples.length === 0) {
    return Object.freeze({ sampleCount: 0, maeMs: null, p95Ms: null });
  }
  const errors = samples
    .map((sample) => Math.abs(sample.predictedMs - sample.goldMs))
    .sort((left, right) => left - right);
  return Object.freeze({
    sampleCount: errors.length,
    maeMs: errors.reduce((sum, value) => sum + value, 0) / errors.length,
    p95Ms: errors[Math.ceil(errors.length * 0.95) - 1],
  });
}

export function scoreAgreementMetrics(
  human: readonly number[],
  predicted: readonly number[],
) {
  if (human.length === 0 || human.length !== predicted.length) {
    throw new Error('SCORE_SAMPLE_MISMATCH');
  }
  const mae =
    human.reduce(
      (sum, value, index) => sum + Math.abs(value - predicted[index]),
      0,
    ) / human.length;
  const humanMean = human.reduce((sum, value) => sum + value, 0) / human.length;
  const predictedMean =
    predicted.reduce((sum, value) => sum + value, 0) / predicted.length;
  let covariance = 0;
  let humanVariance = 0;
  let predictedVariance = 0;
  for (let index = 0; index < human.length; index += 1) {
    const left = human[index] - humanMean;
    const right = predicted[index] - predictedMean;
    covariance += left * right;
    humanVariance += left ** 2;
    predictedVariance += right ** 2;
  }
  const denominator = Math.sqrt(humanVariance * predictedVariance);
  return Object.freeze({
    sampleCount: human.length,
    mae,
    correlation: denominator === 0 ? null : covariance / denominator,
  });
}

export function repeatDriftMetrics(groups: readonly (readonly number[])[]) {
  const deltas = groups.flatMap((scores) =>
    scores.slice(1).map((score) => Math.abs(score - scores[0])),
  );
  return Object.freeze({
    comparisonCount: deltas.length,
    maxAbsoluteDelta: deltas.length ? Math.max(...deltas) : 0,
    meanAbsoluteDelta:
      deltas.length === 0
        ? 0
        : deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
  });
}

export function rejectionMetrics(
  shouldReject: readonly boolean[],
  predictedReject: readonly boolean[],
) {
  if (
    shouldReject.length === 0 ||
    shouldReject.length !== predictedReject.length
  ) {
    throw new Error('REJECTION_SAMPLE_MISMATCH');
  }
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  for (let index = 0; index < shouldReject.length; index += 1) {
    if (shouldReject[index] && predictedReject[index]) tp += 1;
    else if (shouldReject[index]) fn += 1;
    else if (predictedReject[index]) fp += 1;
    else tn += 1;
  }
  return Object.freeze({
    tp,
    fn,
    fp,
    tn,
    truePositiveRate: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
  });
}

export function accentResidualMetrics(
  samples: readonly Readonly<{
    group: string;
    humanScore: number;
    predictedScore: number;
  }>[],
) {
  const grouped = new Map<string, number[]>();
  for (const sample of samples) {
    const values = grouped.get(sample.group) ?? [];
    values.push(sample.predictedScore - sample.humanScore);
    grouped.set(sample.group, values);
  }
  const groupMeanResiduals = Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, values]) => [
        group,
        values.reduce((sum, value) => sum + value, 0) / values.length,
      ]),
  );
  const means = Object.values(groupMeanResiduals);
  return Object.freeze({
    groupMeanResiduals: Object.freeze(groupMeanResiduals),
    maxGap: means.length < 2 ? 0 : Math.max(...means) - Math.min(...means),
  });
}
