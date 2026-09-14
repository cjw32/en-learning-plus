import { parseArgs } from 'node:util';
import { limitsSchema } from '../contracts/run.schema';
import { modules } from '../catalog/catalog';

const repeatable = ['mode', 'case', 'tag', 'risk', 'intentional-difference'];
const names = [
  'modules',
  'profile',
  'purpose',
  'changed-since',
  'candidate',
  'candidate-config',
  'baseline',
  'baseline-candidate',
  'baseline-config',
  'dataset',
  'control-root',
  'config',
  'output',
  'concurrency',
  'case-timeout-ms',
  'run-timeout-ms',
  'repeat',
  'retry-limit',
  'budget-micros',
  'currency',
  'max-tokens',
  'run-dir',
  'evidence',
  'artifact-root',
  'policy',
  ...repeatable,
];
export function parseOptions(argv: readonly string[]) {
  const command = argv[0];
  if (
    ![
      'inspect',
      'run',
      'verify',
      'recover',
      'cleanup',
      'attach-client-evidence',
      'purge',
    ].includes(command)
  )
    throw Error('INVALID_COMMAND');
  const options = Object.fromEntries(
    names.map((name) => [
      name,
      { type: 'string' as const, multiple: repeatable.includes(name) },
    ]),
  );
  const parsed = parseArgs({
    args: argv.slice(1),
    options,
    strict: true,
    allowPositionals: false,
    tokens: true,
  });
  const seen = new Set<string>();
  for (const token of parsed.tokens)
    if (token.kind === 'option') {
      if (seen.has(token.name) && !repeatable.includes(token.name))
        throw Error('DUPLICATE_OPTION');
      seen.add(token.name);
    }
  const values = parsed.values as Record<string, string | string[] | undefined>;
  const one = (key: string, fallback?: string) =>
    (values[key] as string | undefined) ?? fallback;
  const many = (key: string) => (values[key] as string[] | undefined) ?? [];
  const integer = (key: string, fallback: number) => {
    const value = one(key);
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw Error('INVALID_LIMIT');
    return Number(value);
  };
  const profile = one('profile', 'quick')!;
  const purpose = one('purpose', 'check')!;
  if (
    !['quick', 'full'].includes(profile) ||
    !['check', 'qualification', 'measurement'].includes(purpose)
  )
    throw Error('INVALID_PROFILE');
  const selected = one('modules', 'all')!.split(',');
  if (
    selected.some((m) => !['all', ...modules].includes(m)) ||
    new Set(selected).size !== selected.length ||
    (selected.includes('all') && selected.length > 1)
  )
    throw Error('INVALID_MODULE');
  const modes = many('mode').length
    ? many('mode')
    : profile === 'quick'
      ? ['deterministic', 'mock', 'replay']
      : ['deterministic', 'mock', 'replay', 'live'];
  if (
    modes.some(
      (m) => !['deterministic', 'mock', 'replay', 'live'].includes(m),
    ) ||
    new Set(modes).size !== modes.length
  )
    throw Error('INVALID_MODE');
  if (
    (one('baseline') && one('baseline-candidate')) ||
    (one('baseline-config') && !one('baseline-candidate'))
  )
    throw Error('INVALID_BASELINE_OPTIONS');
  const differences = many('intentional-difference');
  if (
    differences.some(
      (d) =>
        ![
          'prompt',
          'model',
          'provider',
          'chunking',
          'embedding',
          'index',
          'retrieval-config',
          'tool-schema',
        ].includes(d),
    )
  )
    throw Error('INVALID_DIFFERENCE');
  const limits = limitsSchema.parse({
    concurrency: integer('concurrency', 1),
    caseTimeoutMs: integer('case-timeout-ms', 120000),
    runTimeoutMs: integer('run-timeout-ms', 900000),
    repeatCount: integer('repeat', 1),
    retryLimit: integer('retry-limit', 0),
    stopGraceMs: 5000,
    budgetMicros: integer('budget-micros', 0),
    currency: one('currency', 'USD'),
    maxTokens: integer('max-tokens', 0),
  });
  if (
    profile === 'quick' &&
    (modes.includes('live') || limits.budgetMicros > 0)
  )
    throw Error('QUICK_COST_CONFLICT');
  if (['run', 'inspect'].includes(command) && !one('output'))
    throw Error('OUTPUT_REQUIRED');
  if (
    ['verify', 'recover', 'cleanup', 'attach-client-evidence'].includes(
      command,
    ) &&
    !one('run-dir')
  )
    throw Error('RUN_DIR_REQUIRED');
  if (command === 'attach-client-evidence' && !one('evidence'))
    throw Error('EVIDENCE_REQUIRED');
  if (['recover', 'cleanup', 'purge'].includes(command) && !one('config'))
    throw Error('CONFIG_REQUIRED');
  if (command === 'purge' && (!one('artifact-root') || !one('policy')))
    throw Error('POLICY_REQUIRED');
  return {
    command,
    modules: selected[0] === 'all' ? [...modules] : selected,
    profile,
    purpose,
    modes,
    limits,
    caseIds: many('case'),
    tags: many('tag'),
    risks: many('risk'),
    intentionalDifferences: differences,
    changedSince: one('changed-since'),
    candidate: one('candidate'),
    candidateConfig: one('candidate-config'),
    baseline: one('baseline'),
    baselineCandidate: one('baseline-candidate'),
    baselineConfig: one('baseline-config'),
    dataset: one('dataset'),
    controlRoot: one('control-root'),
    config: one('config'),
    output: one('output'),
    runDir: one('run-dir'),
    evidence: one('evidence'),
    artifactRoot: one('artifact-root'),
    policy: one('policy'),
    explicitOptions: [...seen],
  };
}
export type CliOptions = ReturnType<typeof parseOptions>;
