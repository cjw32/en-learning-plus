import { createHash } from 'node:crypto';

export type McpArtifactKind =
  | 'log'
  | 'error'
  | 'trace'
  | 'eval'
  | 'snapshot'
  | 'report';
export type McpScannableArtifact = Readonly<{
  path: string;
  kind: McpArtifactKind;
  content: string;
}>;

export function scanSensitiveArtifacts(
  artifacts: readonly McpScannableArtifact[],
  canaries: readonly string[],
) {
  const hits: Array<{
    artifactHash: string;
    kind: McpArtifactKind;
    canaryIndex: number;
  }> = [];
  artifacts.forEach((artifact) =>
    canaries.forEach((canary, canaryIndex) => {
      if (artifact.content.includes(canary))
        hits.push({
          artifactHash: createHash('sha256')
            .update(artifact.path)
            .digest('hex')
            .slice(0, 16),
          kind: artifact.kind,
          canaryIndex,
        });
    }),
  );
  return Object.freeze({
    passed: hits.length === 0,
    hitCount: hits.length,
    scannedArtifacts: artifacts.length,
    hits: Object.freeze(hits),
  });
}

export function createMcpObservabilityReport(
  invocations: readonly Readonly<{
    traceId: string;
    stages: readonly string[];
    cancelled: boolean;
    terminalStatus: string;
  }>[],
  scan: ReturnType<typeof scanSensitiveArtifacts>,
) {
  const missing = invocations
    .filter(
      (item) =>
        !['correlation', 'auth', 'admission', 'business'].every((stage) =>
          item.stages.includes(stage),
        ) ||
        (item.cancelled && item.terminalStatus !== 'CANCELLED'),
    )
    .map((item) => item.traceId);
  return Object.freeze({
    schemaVersion: 'mcp-observability-report.v1',
    invocationCount: invocations.length,
    completeCount: invocations.length - missing.length,
    incompleteTraceIds: missing,
    sensitiveDataHitCount: scan.hitCount,
    passed: missing.length === 0 && scan.passed,
  });
}
