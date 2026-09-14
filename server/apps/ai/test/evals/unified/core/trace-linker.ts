import { idSchema } from '../contracts/case.schema';
export function linkTrace(input: {
  runId: string;
  itemId: string;
  attemptId: string;
  traceId?: string;
  requestId?: string;
  callId?: string;
}) {
  for (const value of Object.values(input))
    if (value !== undefined) idSchema.parse(value);
  return Object.freeze({
    runId: input.runId,
    itemId: input.itemId,
    attemptId: input.attemptId,
    traceId: input.traceId ?? null,
    requestId: input.requestId ?? null,
    callId: input.callId ?? null,
    executionRecordId: `${input.runId}/${input.itemId}/${input.attemptId}`,
  });
}
