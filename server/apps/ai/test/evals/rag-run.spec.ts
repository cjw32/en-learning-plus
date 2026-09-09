import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadRagEvalCases } from './rag-case.schema';
import { runRagEvaluation, type RagEvalExecution } from './run';

const cases = loadRagEvalCases(resolve(__dirname, 'fixtures/rag-cases.jsonl'));
const versions = {
  datasetVersion: 'rag-eval.synthetic.v1',
  sourceRightsSnapshotVersion: 'rights.synthetic.v1',
  promptVersion: 'coach.rag.v1',
  modelVersion: 'mock-rag-v1',
  embeddingVersion: 'embedding.fake.8d.v1',
  chunkingVersion: 'chunking.v1',
  indexVersion: 'exact-cosine.v1',
  retrievalConfigVersion: 'retrieval.exact.v1',
  schemaVersion: 'coach.result.v2',
  rubricVersion: 'rag-quality.v1',
  priceVersion: 'rag-price.pending.v1',
  generatedAt: '2026-09-08T00:00:00.000Z',
} as const;

describe('RAG evaluation runner modes', () => {
  it('is offline deterministic and atomically writes a reproducible report', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rag-eval-'));
    const output = join(directory, 'report.json');
    try {
      const first = await runRagEvaluation({
        mode: 'deterministic',
        cases,
        versions,
        outputPath: output,
      });
      const serialized = readFileSync(output, 'utf8');
      const second = await runRagEvaluation({
        mode: 'deterministic',
        cases,
        versions,
      });
      expect(second).toEqual(first);
      expect(JSON.parse(serialized)).toEqual(first);
      expect(first.completeness.status).toBe('complete');
      expect(
        existsSync(join(directory, `.report.json.${process.pid}.tmp`)),
      ).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    undefined,
    {
      approved: true,
      approvalId: 'approval_test_1',
      testOnly: true,
      providerApproved: true,
      credentialsAvailable: false,
      maxCostMicros: 100,
    },
  ] as const)(
    'fails closed before an adapter call when live approval is absent/incomplete',
    async (liveApproval) => {
      const executeLive = jest.fn<
        Promise<RagEvalExecution>,
        [(typeof cases)[number]]
      >();
      await expect(
        runRagEvaluation({
          mode: 'live',
          cases,
          versions,
          liveApproval: liveApproval as never,
          executeLive,
        }),
      ).rejects.toThrow('not explicitly approved');
      expect(executeLive).not.toHaveBeenCalled();
    },
  );

  it('enforces the approved live budget and emits no report after overflow', async () => {
    const executeLive = jest.fn(async (item: (typeof cases)[number]) => ({
      result: {
        caseId: item.id,
        deterministicFailures: [],
        securityFailures: [],
        qualityState: 'unscored' as const,
        measurements: {
          ttftMs: 1,
          totalDurationMs: 1,
          inputTokens: 1,
          outputTokens: 1,
          estimatedCostMicros: 6,
        },
        toolPath: ['search_learning_materials'],
      },
      metrics: {
        caseId: item.id,
        expectedRelevantChunkIds: item.expected.relevantChunkIds,
        retrievedChunkIds: item.expected.relevantChunkIds,
        citations: [],
        claims: [],
        schema: { firstPass: true, finalPass: true },
        security: {},
        retrievalLatencyMs: 1,
        contextTokens: 1,
        totalTokens: 2,
        costMicros: 6,
      },
    }));
    await expect(
      runRagEvaluation({
        mode: 'live',
        cases,
        versions,
        liveApproval: {
          approved: true,
          approvalId: 'approval_test_2',
          testOnly: true,
          providerApproved: true,
          credentialsAvailable: true,
          maxCostMicros: 10,
        },
        executeLive,
      }),
    ).rejects.toThrow('budget exceeded');
    expect(executeLive).toHaveBeenCalledTimes(2);
  });
});
