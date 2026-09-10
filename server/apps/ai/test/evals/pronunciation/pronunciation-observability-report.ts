const forbiddenKeys = new Set([
  'authorization',
  'subscriptionkey',
  'apikey',
  'userid',
  'subjectid',
  'referencestext',
  'referencetext',
  'recognizedtext',
  'audiobytes',
  'objectkey',
  'bucket',
  'storageurl',
  'rawresponse',
  'stack',
]);

function scan(value: unknown, traceId: string, output: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => scan(item, traceId, output));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKeys.has(key.toLowerCase())) output.push(`${traceId}:${key}`);
    scan(item, traceId, output);
  }
}

function complete(trace: Record<string, any>): boolean {
  const durations = trace.durations;
  const cost = trace.cost;
  const versions = trace.versions;
  return Boolean(
    trace.traceId &&
    trace.assessmentId &&
    trace.terminalStatus &&
    durations &&
    ['uploadMs', 'queueMs', 'providerMs', 'totalMs'].every(
      (key) => Number.isSafeInteger(durations[key]) && durations[key] >= 0,
    ) &&
    cost &&
    Number.isSafeInteger(cost.actualMicros) &&
    cost.actualMicros >= 0 &&
    typeof cost.currency === 'string' &&
    versions &&
    [
      'dataset',
      'provider',
      'model',
      'rule',
      'schema',
      'normalization',
      'budget',
      'price',
    ].every(
      (key) => typeof versions[key] === 'string' && versions[key].length > 0,
    ) &&
    trace.stepsComplete === true,
  );
}

export function buildPronunciationObservabilityReport(
  input: Readonly<{
    assessmentIds: readonly string[];
    traces: readonly Record<string, any>[];
  }>,
) {
  const traceAssessmentIds = new Set(
    input.traces.map((trace) => trace.assessmentId),
  );
  const missingAssessmentIds = input.assessmentIds.filter(
    (assessmentId) => !traceAssessmentIds.has(assessmentId),
  );
  const incompleteTraceIds = input.traces
    .filter((trace) => !complete(trace))
    .map((trace) => String(trace.traceId ?? 'unknown'));
  const sensitiveMatches: string[] = [];
  for (const trace of input.traces) {
    scan(trace, String(trace.traceId ?? 'unknown'), sensitiveMatches);
  }
  const linkedTraceCount =
    input.assessmentIds.length - missingAssessmentIds.length;
  const linkageRate =
    input.assessmentIds.length === 0
      ? 0
      : linkedTraceCount / input.assessmentIds.length;
  return Object.freeze({
    schemaVersion: 'pronunciation-observability-report.v1',
    assessmentCount: input.assessmentIds.length,
    linkedTraceCount,
    linkageRate,
    missingAssessmentIds: Object.freeze(missingAssessmentIds),
    incompleteTraceIds: Object.freeze(incompleteTraceIds),
    sensitiveMatches: Object.freeze(sensitiveMatches),
    passed:
      linkageRate === 1 &&
      incompleteTraceIds.length === 0 &&
      sensitiveMatches.length === 0,
  });
}
