import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safePath } from '../core/control-loader';

function mapping(_root: string, raw: any) {
  const family = (
    {
      'rag-eval-case.v1': 'retrieval',
      'rag-lifecycle-case.v1': 'lifecycle',
      'rag-degradation-case.v1': 'degradation',
      'rag-personalization-case.v1': 'personalization',
    } as Record<string, string>
  )[raw.caseVersion];
  if (!family) throw Error('UNMAPPED_LEGACY_CATEGORY');
  const requirements: Record<string, string[]> = {
    retrieval: ['FR-027', 'FR-029', 'FR-032', 'FR-041', 'FR-050', 'FR-054'],
    lifecycle: ['FR-022', 'FR-023', 'FR-024', 'FR-025', 'FR-026'],
    degradation: ['FR-033', 'FR-034', 'FR-037', 'FR-054', 'FR-055', 'FR-056'],
    personalization: ['FR-007', 'FR-008', 'FR-029', 'FR-030', 'FR-057'],
  };
  return {
    family,
    requirementIds: requirements[family],
    polarity: 'unspecified',
    scenario: raw.category ?? raw.scenario ?? raw.id,
    versions: structuredClone(raw.versions),
    observationBasis: 'fixture_self_test_only',
    missing: [
      'actual_retrieval_observation',
      'actual_grounded_answer',
      'authorized_gold_mapping',
    ],
  };
}

const files = [
  ['server/apps/ai/test/evals/fixtures/rag-cases.jsonl', true],
  ['server/apps/ai/test/evals/fixtures/rag-lifecycle.cases.jsonl', true],
  ['server/apps/ai/test/evals/fixtures/rag-degradation.cases.jsonl', true],
  ['server/apps/ai/test/evals/fixtures/rag-personalization.cases.jsonl', true],
] as const;
export function sources(root: string) {
  let primaryCount = 0;
  const records = files.flatMap(([path, primary]) => {
    const bytes = readFileSync(safePath(root, path));
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    const data = path.endsWith('.jsonl')
      ? bytes
          .toString()
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : JSON.parse(bytes.toString()).cases;
    if (!Array.isArray(data) || !data.length)
      throw Error('CASE_METADATA_MISSING');
    if (primary) primaryCount += data.length;
    return data.map((raw: any) => {
      const id = raw.id ?? raw.caseId;
      if (typeof id !== 'string' || !id) throw Error('CASE_METADATA_MISSING');
      return {
        id,
        path,
        hash: fileHash,
        raw,
        primary,
        mapping: mapping(root, raw),
      };
    });
  });
  return { primaryCount, records };
}
