import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safePath } from '../core/control-loader';

function mapping(_root: string, raw: any) {
  const family = raw.category ?? (raw.prompt ? 'prompts' : 'create_quiz');
  const requirements: Record<string, string[]> = {
    protocol: ['FR-001', 'FR-039', 'FR-059'],
    resources: ['FR-015', 'FR-016', 'FR-035'],
    tools: ['FR-017', 'FR-018', 'FR-019', 'FR-020'],
    prompts: ['FR-027', 'FR-028', 'FR-029', 'FR-030'],
    confirmation: ['FR-023', 'FR-024'],
    duplicate_write: ['FR-025', 'FR-046'],
    cancellation: ['FR-045', 'FR-051'],
    injection: ['FR-029', 'FR-040', 'FR-041'],
    isolation: ['FR-034', 'FR-035', 'FR-036', 'FR-038'],
    create_quiz: ['FR-019', 'FR-021', 'FR-022', 'FR-047'],
  };
  if (!requirements[family]) throw Error('UNMAPPED_LEGACY_CATEGORY');
  return {
    family,
    requirementIds: requirements[family],
    polarity: raw.kind ?? 'unspecified',
    clients: ['codex', 'claude-desktop', 'vscode', 'inspector'],
    clientEvidence: null,
    observationBasis: 'fixture_self_test_only',
    missing: [
      'actual_client_evidence',
      'client_version',
      'verified_subject_context',
      ...(!raw.input && !raw.prompt
        ? ['actual_input', 'expected_parameters']
        : []),
    ],
  };
}

const files = [
  ['server/apps/ai/test/evals/mcp/fixtures/mcp-eval-cases.v1.json', true],
  ['server/apps/ai/test/evals/mcp/fixtures/create-quiz.cases.json', false],
  ['server/apps/ai/test/evals/mcp/fixtures/prompts.cases.json', false],
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
