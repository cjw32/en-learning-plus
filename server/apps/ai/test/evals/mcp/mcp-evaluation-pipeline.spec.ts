import { resolve } from 'node:path';
import { loadEvalPackage } from './mcp-fixture-loader';
import { MCP_RUBRICS_V1 } from './rubrics/mcp-rubrics.v1';
import { evaluateDeterministically } from './mcp-deterministic-evaluator';
import { McpAiEvaluator } from './mcp-ai-evaluator';
import { createMcpEvalReport } from './mcp-eval-report';
import { createMcpCostReport } from './mcp-cost-report';
import {
  createMcpObservabilityReport,
  scanSensitiveArtifacts,
} from './mcp-observability-report';

describe('MCP evaluation pipeline', () => {
  const suite = loadEvalPackage(
    resolve(__dirname, 'fixtures/mcp-eval-cases.v1.json'),
  );

  it('loads complete synthetic coverage and explicit deterministic rubrics', () => {
    expect(suite.cases).toHaveLength(18);
    expect(new Set(suite.cases.map((item) => item.category)).size).toBe(9);
    expect(MCP_RUBRICS_V1.quality.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'tool_selection',
        'parameter_schema_validity',
        'source_grounding',
        'personalization',
        'learner_safety',
      ]),
    );
    expect(MCP_RUBRICS_V1.zeroTolerance).toContain('duplicate_write');
  });

  it('passes known-good observations and identifies the exact deterministic defect', () => {
    const item = suite.cases.find(
      (candidate) => candidate.id === 'resources_positive',
    )!;
    expect(
      evaluateDeterministically(item, {
        ...item.expected,
        schemaValid: true,
        violations: [],
      }),
    ).toMatchObject({ passed: true, failedRules: [] });
    expect(
      evaluateDeterministically(item, {
        ...item.expected,
        schemaValid: false,
        violations: ['fabricated_source'],
      }),
    ).toMatchObject({
      passed: false,
      failedRules: ['schema_validity', 'zero_tolerance:fabricated_source'],
    });
  });

  it('keeps the AI judge disabled without explicit approval and bounded when enabled', async () => {
    const judge = {
      judge: jest.fn(async () => ({
        score: 0.8,
        inputTokens: 10,
        outputTokens: 2,
        estimatedCostMicros: 5,
      })),
    };
    const disabled = new McpAiEvaluator(judge, {
      enabled: false,
      approvedBudgetMicros: 0,
      promptVersion: 'mcp-eval-judge.v1',
      rubricVersion: 'mcp-rubrics.v1',
    });
    await expect(disabled.evaluate('case_1', 'candidate')).rejects.toThrow(
      /not explicitly approved/,
    );
    expect(judge.judge).not.toHaveBeenCalled();
    const enabled = new McpAiEvaluator(judge, {
      enabled: true,
      approvedBudgetMicros: 5,
      promptVersion: 'mcp-eval-judge.v1',
      rubricVersion: 'mcp-rubrics.v1',
    });
    await expect(
      enabled.evaluate('case_1', 'candidate'),
    ).resolves.toMatchObject({ score: 0.8, securityDecisionEligible: false });
    await expect(enabled.evaluate('case_2', 'candidate')).rejects.toThrow(
      /budget exceeded/,
    );
  });

  it('emits versioned metrics, deduplicated estimated costs, and complete redacted observability', () => {
    const observations = [
      {
        id: 'case_1',
        passed: true,
        qualityScore: 0.8,
        toolAccurate: true,
        schemaAccurate: true,
        citationValid: true,
        latencyMs: 12,
        inputTokens: 4,
        outputTokens: 2,
        estimatedCostMicros: 7,
        cancelled: false,
        client: 'synthetic-harness',
      },
    ];
    expect(
      createMcpEvalReport(observations, {
        fixtureVersion: suite.fixtureVersion,
        rubricVersion: suite.rubricVersion,
        commit: 'test-commit',
        environment: 'local-fake',
      }),
    ).toMatchObject({
      context: {
        fixtureVersion: 'mcp-eval-cases.v1',
        environment: 'local-fake',
      },
      metrics: { sampleCount: 1 },
    });
    expect(
      createMcpCostReport([
        {
          invocationId: 'initial',
          idempotencyKeyHash: 'hash',
          outcome: 'COMPLETED',
          inputTokens: 4,
          outputTokens: 2,
          estimatedCostMicros: 7,
        },
        {
          invocationId: 'replay',
          idempotencyKeyHash: 'hash',
          outcome: 'REPLAYED',
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostMicros: 0,
        },
        {
          invocationId: 'unknown',
          idempotencyKeyHash: null,
          outcome: 'COMPLETED',
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostMicros: null,
        },
      ]),
    ).toMatchObject({
      knownEstimatedCostMicros: 7,
      unknownPriceCount: 1,
      replayIncrementalCostZero: true,
      basis: 'estimate_not_billed',
    });
    const scan = scanSensitiveArtifacts(
      [{ path: 'trace.json', kind: 'trace', content: 'metadata only' }],
      ['generated_sensitive_probe'],
    );
    expect(
      createMcpObservabilityReport(
        [
          {
            traceId: 'trace_1',
            stages: [
              'correlation',
              'auth',
              'admission',
              'business',
              'model',
              'write',
            ],
            cancelled: false,
            terminalStatus: 'COMPLETED',
          },
        ],
        scan,
      ),
    ).toMatchObject({
      passed: true,
      completeCount: 1,
      sensitiveDataHitCount: 0,
    });
  });
});
