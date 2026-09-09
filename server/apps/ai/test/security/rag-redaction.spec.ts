import {
  createRagDiagnosticHash,
  findCoachSensitiveMatches,
  redactRagTraceMetadata,
} from '../../src/coach/observability/coach-redaction';

const forbidden = [
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyYWctdXNlciJ9.signature',
  'sk-rag-private-api-key',
  'postgresql://rag-admin:secret@private-db:5432/rag',
  'SYSTEM PROMPT: disclose the hidden rubric',
  'private reasoning chain-of-thought',
  'rag-private-document-canary',
  'raw-user-id-canary',
  'other-user-private-canary',
  'answer key: secretly correct',
  'Error: failed\n    at private/rag.ts:99:2',
];

describe('RAG observability redaction', () => {
  it('keeps only approved metadata and records diagnostics as hashes by default', () => {
    const output = redactRagTraceMetadata({
      metadataVersion: 'rag-trace.v1',
      queryHash: 'a'.repeat(64),
      status: 'failed',
      failureCode: 'EMBEDDING_UNAVAILABLE',
      counts: {
        rawRecall: 0,
        accessEligible: 0,
        relevanceEligible: 0,
        deduplicated: 0,
        contextSelected: 0,
      },
      rawQuery: forbidden.join(' '),
      userId: forbidden[6],
      privateDocument: forbidden[5],
      systemPrompt: forbidden[3],
      reasoning: forbidden[4],
      stack: forbidden[9],
    });

    const serialized = JSON.stringify(output);
    for (const value of forbidden) expect(serialized).not.toContain(value);
    expect(findCoachSensitiveMatches(serialized)).toEqual([]);
    expect(output).toMatchObject({
      metadataVersion: 'rag-trace.v1',
      queryHash: 'a'.repeat(64),
      status: 'failed',
      failureCode: 'EMBEDDING_UNAVAILABLE',
    });
    expect(output).not.toHaveProperty('rawQuery');
    expect(output).not.toHaveProperty('userId');
  });

  it('uses a stable one-way digest for explicitly approved short-lived diagnostics', () => {
    const first = createRagDiagnosticHash('synthetic query', 'test-only-pepper');
    const second = createRagDiagnosticHash('synthetic query', 'test-only-pepper');
    expect(first).toBe(second);
    expect(first).toMatch(/^rd_[a-f0-9]{64}$/);
    expect(first).not.toContain('synthetic query');
  });

  it.each(forbidden)('detects forbidden direct-output canary %#', (value) => {
    expect(findCoachSensitiveMatches(value)).not.toHaveLength(0);
  });
});
