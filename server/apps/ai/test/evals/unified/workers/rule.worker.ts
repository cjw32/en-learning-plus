import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { loadCatalog } from '../catalog/catalog';
import { collectObservation } from '../core/observation-collector';
import { executionItemSchema } from '../contracts/run.schema';

const controlRoot = resolve(__dirname, '../../../../../../..');
const candidateRoot = process.env.UNIFIED_CANDIDATE_ROOT ?? controlRoot;
const candidateRequire = createRequire(
  join(candidateRoot, 'server/package.json'),
);
async function executeMessage(message: any) {
  try {
    const item = executionItemSchema.parse(message.item);
    let valid = false;
    let input: unknown;
    let code = 'CONTRACT_BREAK';
    let expectedRef: any = null;
    const fixturePath =
      'server/apps/ai/test/evals/unified/fixtures/assurance-cases.jsonl';
    if (item.caseId.startsWith('ue-')) {
      const fixtures = readFileSync(join(controlRoot, fixturePath), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const fixture = fixtures.find((f) => f.id === item.caseId);
      if (!fixture) throw Error('REQUIRED_ITEM_MISSING');
      input = fixture.candidate;
      if (fixture.validator === 'coach-result')
        valid =
          candidateRequire('@en/common/coach').coachResultSchema.safeParse(
            input,
          ).success;
      else if (fixture.validator === 'rag-citations') {
        const validator = candidateRequire(
          join(
            candidateRoot,
            'server/apps/ai/src/coach/workflow/final-result.validator.ts',
          ),
        );
        valid = validator.validateGroundedClaims(
          input,
          new Set(fixture.issuedCitationIds),
        );
        code = 'FABRICATED_CITATION';
      } else if (fixture.validator === 'mcp-tool') {
        const { McpToolRegistry } = candidateRequire(
          join(
            candidateRoot,
            'server/apps/ai/src/mcp/tools/mcp-tool.registry.ts',
          ),
        );
        const registry = new McpToolRegistry({
          authorization: { assertActive: async () => {} },
          handlers: {},
        });
        try {
          await registry.call(
            fixture.candidate.tool,
            fixture.candidate.arguments,
            {},
          );
          valid = true;
        } catch {
          valid = false;
        }
      }
    } else {
      const catalog = loadCatalog(controlRoot);
      const raw: any = catalog.rawById.get(item.caseId);
      if (!raw) throw Error('REQUIRED_ITEM_MISSING');
      input = raw;
      expectedRef = catalog.cases.find(
        (c) => c.caseId === item.caseId,
      )!.expectedRef;
      if (item.module === 'coach')
        valid = candidateRequire(
          join(
            candidateRoot,
            'server/apps/ai/test/evals/deterministic-assertions.ts',
          ),
        ).evalCaseSchema.safeParse(raw).success;
      else if (item.module === 'rag') {
        if (raw.caseVersion === 'rag-eval-case.v1')
          valid = candidateRequire(
            join(candidateRoot, 'server/apps/ai/test/evals/rag-case.schema.ts'),
          ).ragEvalCaseSchema.safeParse(raw).success;
        else
          valid = Boolean(
            raw.id &&
            raw.expected &&
            raw.versions &&
            /synthetic/.test(raw.datasetVersion),
          );
      } else if (item.module === 'pronunciation')
        valid = candidateRequire(
          join(
            candidateRoot,
            'server/apps/ai/test/evals/pronunciation/pronunciation-eval-case.schema.ts',
          ),
        ).pronunciationEvalCaseSchema.safeParse(raw).success;
      else
        valid = Boolean(
          raw.id &&
          (raw.synthetic === true || raw.prompt || raw.learnerContext),
        );
    }
    const steps = [
      collectObservation({
        stage: 'rule',
        actualMode: 'deterministic',
        dependencyKind: 'none',
        input,
        output: { valid },
        version: 'unified-rule.v1',
      }),
    ];
    process.send?.({
      type: 'result',
      itemId: item.itemId,
      result: {
        ...item,
        terminalState: valid ? 'passed' : 'failed',
        reasonCodes: valid ? [] : [code],
        allAttempts: [`${item.itemId}-attempt-0`],
        requirements: [
          { spec: '005-unified-ai-evaluation', ids: ['FR-005', 'FR-050'] },
        ],
        expectedRef,
        actualRef: null,
        evidenceRefs: [],
        steps,
      },
    });
    process.disconnect?.();
  } catch {
    process.send?.({
      type: 'error',
      itemId: message?.item?.itemId ?? 'unknown',
      reason: 'WORKER_RULE_FAILED',
    });
    process.disconnect?.();
  }
}
process.on('message', (message) => {
  executeMessage(message).catch(() => {
    process.exitCode = 2;
    if (process.connected) process.disconnect();
  });
});
