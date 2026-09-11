import { scanSensitiveArtifacts } from '../evals/mcp/mcp-observability-report';

describe('MCP sensitive-data scan', () => {
  const canaries = ['secret', 'answer', 'prompt', 'learner'].map(
    (part, index) => ['mcp', part, String(index), 'canary'].join('_'),
  );

  it('finds seeded values across supported artifact kinds without echoing them', () => {
    const artifacts = [
      {
        path: 'logs.json',
        kind: 'log' as const,
        content: `safe ${canaries[0]}`,
      },
      { path: 'trace.json', kind: 'trace' as const, content: canaries[1] },
      {
        path: 'report.md',
        kind: 'report' as const,
        content: `${canaries[2]} ${canaries[3]}`,
      },
    ];
    const result = scanSensitiveArtifacts(artifacts, canaries);
    expect(result.hitCount).toBe(4);
    expect(JSON.stringify(result)).not.toContain(canaries[0]);
  });

  it('requires exactly zero hits for sanitized logs/errors/traces/evals/snapshots/reports', () => {
    const kinds = [
      'log',
      'error',
      'trace',
      'eval',
      'snapshot',
      'report',
    ] as const;
    const result = scanSensitiveArtifacts(
      kinds.map((kind) => ({
        path: `${kind}.txt`,
        kind,
        content: 'metadata only',
      })),
      canaries,
    );
    expect(result).toMatchObject({
      passed: true,
      hitCount: 0,
      scannedArtifacts: 6,
    });
  });
});
