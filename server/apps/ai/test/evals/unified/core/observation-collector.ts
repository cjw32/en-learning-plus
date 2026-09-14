import { createHash } from 'node:crypto';
import { stepObservationSchema } from '../contracts/evidence.schema';
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function collectObservation(input: {
  stage:
    | 'auth'
    | 'retrieval'
    | 'model'
    | 'tool'
    | 'audio'
    | 'judge'
    | 'write'
    | 'rule';
  actualMode: 'deterministic' | 'mock' | 'replay' | 'live';
  dependencyKind: 'none' | 'mock' | 'replay' | 'real';
  input: unknown;
  output: unknown;
  version: string;
  traceId?: string;
  callId?: string;
  requestId?: string;
  errorCategory?: string;
  usage?: unknown;
  expectedFault?: boolean;
}) {
  return stepObservationSchema.parse({
    stage: input.stage,
    actualMode: input.actualMode,
    dependencyKind: input.dependencyKind,
    inputHash: digest(input.input),
    outputHash: input.output === null ? null : digest(input.output),
    observationRef: null,
    traceId: input.traceId ?? null,
    callId: input.callId ?? null,
    requestId: input.requestId ?? null,
    version: input.version,
    usage: input.usage ?? null,
    sideEffectEvidence: [],
    errorCategory: input.errorCategory ?? null,
    expectedFault: input.expectedFault ?? false,
  });
}
