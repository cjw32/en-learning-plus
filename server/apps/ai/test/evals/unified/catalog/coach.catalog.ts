import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safePath } from '../core/control-loader';

const rubricFiles: Record<string, string> = {
  'correction.v1': 'correction',
  'cefr-fit.v1': 'cefr-fit',
  'exercise-targeting.v1': 'exercise-targeting',
  'grading.v1': 'grading',
  'next-action.v1': 'next-action',
  'citation-support.v1': 'citation-support',
};
const categoryRequirements: Record<string, string[]> = {
  correction: ['FR-003', 'FR-020'],
  cefr_fit: ['FR-011', 'FR-012', 'FR-013'],
  citation: ['FR-028', 'FR-031'],
  exercise_targeting: ['FR-011', 'FR-025'],
  grading: ['FR-007', 'FR-022', 'FR-047'],
  next_action: ['FR-008'],
  failure: ['FR-009', 'FR-010', 'FR-030', 'FR-045'],
  performance: ['FR-027', 'FR-042', 'FR-050'],
  schema: ['FR-020', 'FR-029', 'FR-031', 'FR-032'],
  security: ['FR-016', 'FR-018', 'FR-019', 'FR-026'],
  tool_parameters: ['FR-017', 'FR-020', 'FR-021'],
  tool_selection: ['FR-002', 'FR-003', 'FR-006'],
};
function mapping(root: string, raw: any) {
  const requirementIds = categoryRequirements[raw.category];
  if (!requirementIds) throw Error('UNMAPPED_LEGACY_CATEGORY');
  return {
    requirementIds,
    family: raw.category,
    polarity: /security|failure/.test(raw.category) ? 'failure' : 'unspecified',
    tools: structuredClone(raw.expected),
    compatibility: {
      source: raw.expected.schemaVersion,
      candidate: ['coach.result.v1', 'coach.result.v2'],
      status: 'requires_actual_validation',
    },
    rubrics: raw.qualityRubrics.map((version: string) => {
      if (!rubricFiles[version]) throw Error('UNMAPPED_RUBRIC');
      const path = `server/apps/ai/test/evals/rubrics/${rubricFiles[version]}.json`;
      const bytes = readFileSync(safePath(root, path));
      if (JSON.parse(bytes.toString()).rubricVersion !== version)
        throw Error('RUBRIC_VERSION_MISMATCH');
      return {
        version,
        path,
        hash: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
    missing: [
      'actual_candidate_result',
      ...(raw.qualityRubrics.length
        ? ['independent_quality_rating', 'calibration']
        : []),
    ],
  };
}

const files = [
  ['server/apps/ai/test/evals/fixtures/cases.jsonl', true],
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
