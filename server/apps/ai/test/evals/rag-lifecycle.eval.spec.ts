import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type LifecycleCase = {
  schemaVersion: 'rag-lifecycle-case.v1';
  id: string;
  events: string[];
  expected: {
    activeContentVersion: string | null;
    releaseCount: number;
    forbiddenChunkIds: string[];
  };
  versions: Record<string, string>;
  measurement: {
    providerCalls: number;
    estimatedCostMicros: number;
    qualityCheck: string;
  };
};

const fixturePath = resolve(__dirname, 'fixtures/rag-lifecycle.cases.jsonl');
const cases = readFileSync(fixturePath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as LifecycleCase);

function evaluate(test: LifecycleCase) {
  const releases = new Map<string, 'ACTIVE' | 'SUPERSEDED' | 'INVALID'>();
  let active: string | null = null;
  for (const event of test.events) {
    const [kind, version] = event.split(':');
    if (kind === 'UPSERT' || kind === 'REEMBED') {
      if (!releases.has(version!)) {
        if (active) releases.set(active, 'SUPERSEDED');
        releases.set(version!, 'ACTIVE');
        active = version!;
      }
    } else if (kind === 'PARTIAL') {
      releases.set(version!, 'INVALID');
    } else if (kind === 'DELETE' || kind === 'REVOKE') {
      if (active) releases.set(active, 'INVALID');
      active = null;
    }
  }
  const searchableChunkIds = active ? [`chunk-${active}`] : [];
  return {
    activeContentVersion: active,
    releaseCount: releases.size,
    searchableChunkIds,
  };
}

describe('deterministic RAG lifecycle evaluation', () => {
  it('covers every required lifecycle transition with fixed versions and zero provider cost', () => {
    expect(cases.map((test) => test.id).sort()).toEqual([
      'content-update',
      'duplicate-ingestion',
      'partial-embedding-failure',
      'reembedding-switch',
      'source-delete',
      'source-revoke',
    ]);
    for (const test of cases) {
      expect(test.schemaVersion).toBe('rag-lifecycle-case.v1');
      expect(Object.keys(test.versions).sort()).toEqual([
        'chunking',
        'embedding',
        'retrieval',
        'rights',
      ]);
      expect(test.measurement).toMatchObject({
        providerCalls: 0,
        estimatedCostMicros: 0,
      });
    }
  });

  it.each(cases)(
    '$id reproduces active state and forbids stale chunks',
    (test) => {
      const result = evaluate(test);
      expect(result.activeContentVersion).toBe(
        test.expected.activeContentVersion,
      );
      expect(result.releaseCount).toBe(test.expected.releaseCount);
      for (const forbidden of test.expected.forbiddenChunkIds) {
        expect(result.searchableChunkIds).not.toContain(forbidden);
      }
    },
  );
});
