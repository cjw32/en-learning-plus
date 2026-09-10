import {
  KnowledgeDomainError,
  assertKnowledgeStateTransition,
} from './knowledge.types';

describe('knowledge domain state machines', () => {
  it('accepts declared forward lifecycle transitions', () => {
    expect(() =>
      assertKnowledgeStateTransition('release', 'BUILDING', 'READY'),
    ).not.toThrow();
    expect(() =>
      assertKnowledgeStateTransition(
        'ingestion',
        'RETRYABLE_FAILED',
        'PENDING',
      ),
    ).not.toThrow();
    expect(() =>
      assertKnowledgeStateTransition('citation', 'SOURCE_INVALID', 'PURGED'),
    ).not.toThrow();
  });

  it.each([
    ['release', 'ACTIVE', 'READY'],
    ['ingestion', 'SUCCEEDED', 'RUNNING'],
    ['citation', 'PURGED', 'ACTIVE'],
    ['citation', 'ACTIVE', 'ACTIVE'],
  ] as const)('rejects illegal %s transition %s -> %s', (machine, from, to) => {
    expect(() =>
      assertKnowledgeStateTransition(
        machine as never,
        from as never,
        to as never,
      ),
    ).toThrow(KnowledgeDomainError);
    expect(() =>
      assertKnowledgeStateTransition(
        machine as never,
        from as never,
        to as never,
      ),
    ).toThrow('KNOWLEDGE_INVALID_STATE_TRANSITION');
  });
});
