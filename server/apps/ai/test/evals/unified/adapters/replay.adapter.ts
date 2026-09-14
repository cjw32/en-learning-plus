import { createHash } from 'node:crypto';
import { replaySchema } from '../contracts/replay.schema';
import { assertSafePayload } from '../core/redaction';
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function recordCassette(input: unknown) {
  const value = input as Record<string, unknown>;
  if (!value || value.provenance !== 'synthetic')
    throw Error('RETENTION_POLICY_REQUIRED');
  assertSafePayload(value.output);
  return replaySchema.parse({ ...value, outputHash: hash(value.output) });
}
export function replayCassette(
  input: unknown,
  expected: {
    caseId: string;
    subjectAlias: string;
    inputHash: string;
    sourceVersion: string;
  },
) {
  const cassette = replaySchema.parse(input);
  if (cassette.provenance !== 'synthetic')
    throw Error('RETENTION_POLICY_REQUIRED');
  for (const [key, value] of Object.entries(expected))
    if (cassette[key] !== value) throw Error('REPLAY_IDENTITY_MISMATCH');
  if (hash(cassette.output) !== cassette.outputHash)
    throw Error('REPLAY_HASH_MISMATCH');
  assertSafePayload(cassette.output);
  return {
    output: structuredClone(cassette.output),
    actualMode: 'replay' as const,
    sourceMode: cassette.sourceMode,
    sourceRunId: cassette.sourceRunId,
  };
}
