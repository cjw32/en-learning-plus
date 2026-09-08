export function linkEvalTrace(input: {
  caseId: string;
  datasetVersion: string;
  traceId: string;
  promptVersion: string;
  modelVersion: string;
  schemaVersion: string;
  feedback: 'UP' | 'DOWN' | null;
}) {
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && !/^[A-Za-z0-9_.-]+$/.test(value)) {
      throw new Error('Eval Trace links accept opaque ids and versions only');
    }
  }
  return Object.freeze({ ...input });
}
