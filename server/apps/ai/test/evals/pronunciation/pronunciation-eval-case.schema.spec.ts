import { resolve } from 'node:path';
import {
  loadPronunciationEvalCases,
  pronunciationEvalCaseSchema,
} from './pronunciation-eval-case.schema';

const valid = {
  schemaVersion: 'pronunciation-eval-case.v1',
  caseId: 'synthetic-perfect-1',
  datasetVersion: 'synthetic-v1',
  provenance: {
    origin: 'SYNTHETIC',
    authorizationId: 'synthetic-policy-v1',
    permittedUses: ['PRONUNCIATION_EVALUATION'],
    deletion: { revocable: true, deleteBy: null },
  },
  audio: {
    kind: 'SYNTHETIC_PCM',
    fixtureId: 'tone-perfect-1',
    durationMs: 1_000,
    sha256: 'a'.repeat(64),
  },
  annotation: {
    version: 'annotation-v1',
    referenceWords: ['hello'],
    hypothesisWords: ['hello'],
    goldStatuses: ['correct'],
    predictedStatuses: ['correct'],
    timestamps: [{ goldMs: 100, predictedMs: 100 }],
    humanOverallScore: 90,
    predictedOverallScore: 90,
    shouldReject: false,
    predictedReject: false,
    accentGroup: null,
    matchedHumanScore: null,
  },
  versions: {
    provider: 'fake',
    model: 'fake-v1',
    rule: 'rules-v1',
    resultSchema: 'result-v1',
    normalization: 'normalization-v1',
    budget: 'budget-v1',
    price: 'price-v1',
  },
  runtime: { providerSuccess: true, latencyMs: 10, costMicros: 0 },
};

describe('pronunciation evaluation case authorization schema', () => {
  it('accepts a strict fully versioned synthetic case', () => {
    expect(pronunciationEvalCaseSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['provenance', { ...valid, provenance: undefined }],
    [
      'use',
      { ...valid, provenance: { ...valid.provenance, permittedUses: [] } },
    ],
    [
      'deletion',
      { ...valid, provenance: { ...valid.provenance, deletion: undefined } },
    ],
    ['annotation', { ...valid, annotation: undefined }],
    ['version', { ...valid, versions: { ...valid.versions, model: '' } }],
    [
      'sensitive inference',
      { ...valid, inferredSensitiveTraits: { ethnicity: 'guessed' } },
    ],
  ])('rejects missing/unsafe %s data', (_name, value) => {
    expect(pronunciationEvalCaseSchema.safeParse(value).success).toBe(false);
  });

  it('validates every committed fixture and contains no human sample', () => {
    const cases = loadPronunciationEvalCases(
      resolve(__dirname, 'fixtures/manifest.jsonl'),
    );
    expect(cases.length).toBeGreaterThanOrEqual(3);
    expect(cases.every((item) => item.provenance.origin === 'SYNTHETIC')).toBe(
      true,
    );
  });
});
