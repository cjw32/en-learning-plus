import { ConflictDetector } from './conflict-detector';

function candidate(override: Record<string, unknown> = {}) {
  return {
    chunkId: 'chunk_fact_001',
    citationId: 'cit_fact_000001',
    factKey: 'grammar:tense:definition',
    factValueHash: 'hash_a',
    contentVersion: 'content.v1',
    versionOrdinal: 1,
    authorityRank: 10,
    sourceStatus: 'ACTIVE' as const,
    relevanceScore: 0.9,
    ...override,
  };
}

describe('ConflictDetector', () => {
  it('keeps one same-fact duplicate within the authorized scope', () => {
    const result = new ConflictDetector().evaluate([
      candidate(),
      candidate({
        chunkId: 'chunk_fact_002',
        citationId: 'cit_fact_000002',
        relevanceScore: 0.8,
      }),
    ]);
    expect(result.accepted.map((item) => item.chunkId)).toEqual([
      'chunk_fact_001',
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it('resolves different values by a strictly newer active version', () => {
    const result = new ConflictDetector().evaluate([
      candidate(),
      candidate({
        chunkId: 'chunk_fact_002',
        citationId: 'cit_fact_000002',
        factValueHash: 'hash_b',
        contentVersion: 'content.v2',
        versionOrdinal: 2,
      }),
    ]);
    expect(result.accepted.map((item) => item.chunkId)).toEqual([
      'chunk_fact_002',
    ]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ resolution: 'resolved_by_version' }),
    ]);
  });

  it('does not silently choose an unresolved same-version conflict', () => {
    const result = new ConflictDetector().evaluate([
      candidate(),
      candidate({
        chunkId: 'chunk_fact_002',
        citationId: 'cit_fact_000002',
        factValueHash: 'hash_b',
      }),
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.conflicts).toEqual([
      {
        topic: 'grammar:tense:definition',
        citationIds: ['cit_fact_000001', 'cit_fact_000002'],
        resolution: 'unresolved',
      },
    ]);
    expect(result.citationUsage).toEqual({
      cit_fact_000001: 'conflict_context',
      cit_fact_000002: 'conflict_context',
    });
  });

  it('excludes inactive facts before conflict resolution', () => {
    const result = new ConflictDetector().evaluate([
      candidate({ sourceStatus: 'REVOKED' }),
      candidate({
        chunkId: 'chunk_fact_002',
        citationId: 'cit_fact_000002',
        factValueHash: 'hash_b',
      }),
    ]);
    expect(result.accepted.map((item) => item.chunkId)).toEqual([
      'chunk_fact_002',
    ]);
    expect(JSON.stringify(result)).not.toContain('chunk_fact_001');
  });
});
