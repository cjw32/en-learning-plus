import { subject, hash } from './test-support';
const replay = subject('adapters/replay.adapter');
const cassette = {
  schemaVersion: 'ai-eval-replay.v1',
  caseId: 'case-1',
  subjectAlias: 'synthetic-a',
  inputHash: hash,
  sourceVersion: 'source-1',
  sourceMode: 'mock',
  sourceRunId: 'run-1',
  provenance: 'synthetic',
  authorizationRef: null,
  output: { answer: 'observed, not expected' },
  outputHash: '',
  recordedAt: '2026-09-14T00:00:00Z',
};
const expected = {
  caseId: 'case-1',
  subjectAlias: 'synthetic-a',
  inputHash: hash,
  sourceVersion: 'source-1',
};
describe('T034 record and replay identity', () => {
  test('records actual output hash then replays without external execution', () => {
    const saved = replay.recordCassette?.(cassette);
    expect(saved?.outputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(replay.replayCassette?.(saved, expected)).toMatchObject({
      output: cassette.output,
      actualMode: 'replay',
      sourceMode: 'mock',
    });
  });
  test('missing, mismatched owner/version, or altered content never falls back to live', () => {
    expect(() => replay.replayCassette?.(null, expected)).toThrow();
    const saved = replay.recordCassette?.(cassette);
    expect(() =>
      replay.replayCassette?.(saved, { ...expected, subjectAlias: 'another' }),
    ).toThrow();
    expect(() =>
      replay.replayCassette?.(
        { ...saved, output: { answer: 'tampered' } },
        expected,
      ),
    ).toThrow();
  });
  test('secrets and authorized content without policy are rejected before record', () => {
    expect(() =>
      replay.recordCassette?.({ ...cassette, output: { apiKey: 'no-secret' } }),
    ).toThrow();
    expect(() =>
      replay.recordCassette?.({ ...cassette, provenance: 'authorized' }),
    ).toThrow();
  });
});
