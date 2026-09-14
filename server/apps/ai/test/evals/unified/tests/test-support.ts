import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Missing implementations yield failed behavioral assertions, never skipped tests.
// Once present, load errors propagate normally rather than being disguised as RED.
export function subject(relative: string): any {
  const path = resolve(__dirname, '..', relative);
  return existsSync(`${path}.ts`) ? require(path) : {};
}

export const hash = 'a'.repeat(64);
export const ref = { path: 'synthetic/input.json', hash };
export const requirements = [
  { spec: '005-unified-ai-evaluation', ids: ['FR-001'] },
];
export const unavailable = { value: null, unavailableReason: 'not_returned' };
export const limits = {
  concurrency: 1,
  caseTimeoutMs: 120000,
  runTimeoutMs: 900000,
  repeatCount: 1,
  retryLimit: 0,
  stopGraceMs: 5000,
  budgetMicros: 0,
  currency: 'USD',
  maxTokens: 0,
};
export const evaluationCase = {
  caseId: 'coach:synthetic-1',
  caseVersion: '1',
  module: 'coach',
  legacyRef: null,
  tags: ['schema'],
  risk: 'high',
  requirements,
  inputRef: ref,
  contextRef: null,
  expectedRef: ref,
  expectedSideEffects: [],
  evaluators: [
    {
      evaluatorId: 'schema',
      version: '1',
      type: 'rule',
      rubricRef: null,
      required: true,
      calibrationRef: null,
    },
  ],
  provenance: {
    kind: 'synthetic',
    source: 'handwritten test',
    useBasis: 'repository test',
    authorizationRef: null,
    allowedPurposes: ['check'],
    expiresAt: null,
    revocationRule: 'remove on request',
    deletionRule: 'versioned synthetic',
  },
  split: 'development',
  exposure: { groupId: 'group-1', nearDuplicateIds: [], events: [] },
  groups: {},
  capabilityRequirements: [],
  datasetVersion: '1',
};
export const request = {
  schemaVersion: 'ai-eval-request.v1',
  purpose: 'check',
  profile: 'quick',
  modules: ['coach'],
  modes: ['mock'],
  filters: { caseIds: [], tags: [], risks: [], changedSince: null },
  candidate: '/synthetic/candidate',
  baseline: null,
  intentionalDifferences: [],
  datasetRef: ref,
  controlRef: ref,
  configRef: null,
  outputRoot: '/synthetic/output',
  limits,
  parentRunId: null,
};
export const item = {
  itemId: 'item-1',
  caseId: 'coach:synthetic-1',
  module: 'coach',
  side: 'candidate',
  client: null,
  required: true,
  declaredMode: 'mock',
  expectedRepeatCount: 1,
};
export const result = {
  ...item,
  terminalState: 'passed',
  reasonCodes: [],
  allAttempts: ['attempt-1'],
  requirements,
  expectedRef: ref,
  actualRef: ref,
  evidenceRefs: [],
  steps: [],
};

export function missingCall(api: any, name: string, ...args: any[]): any {
  return api[name]?.(...args);
}
