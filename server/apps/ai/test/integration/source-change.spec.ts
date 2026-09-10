import {
  InMemoryKnowledgeOutboxPersistence,
  KnowledgeOutboxRepository,
  SourceChangeService,
} from '@libs/learning';

describe('knowledge source change outbox mapping', () => {
  it.each([
    ['WordBook', null],
    ['Course', null],
    ['LearningAttempt', 'user-a'],
    ['PrivateLearningSummary', 'user-a'],
  ] as const)(
    'maps %s upsert/reembed/delete without source content',
    async (recordType, ownerUserId) => {
      const persistence = new InMemoryKnowledgeOutboxPersistence();
      const changes = new SourceChangeService(
        new KnowledgeOutboxRepository(persistence),
      );
      const base = {
        knowledgeSourceId: `source-${recordType}`,
        recordType,
        recordId: `record-${recordType}`,
        contentVersion: 'content.v1',
        pipelineVersion: 'pipeline.v1',
        ownerUserId,
      } as const;
      await changes.enqueue({ ...base, change: 'UPSERT' });
      await changes.enqueue({ ...base, change: 'UPSERT' });
      await changes.enqueue({ ...base, change: 'REEMBED' });
      await changes.enqueue({ ...base, change: 'DELETE' });

      expect(persistence.snapshot().map((job) => job.operation)).toEqual([
        'UPSERT',
        'REEMBED',
        'INVALIDATE',
      ]);
      expect(JSON.stringify(persistence.snapshot())).not.toMatch(
        /contentText|excerpt|answerKey|summaryFacts|message|email|phone/i,
      );
    },
  );

  it('rejects missing private ownership and public owner injection', () => {
    const changes = new SourceChangeService(
      new KnowledgeOutboxRepository(new InMemoryKnowledgeOutboxPersistence()),
    );
    expect(() =>
      changes.enqueue({
        change: 'UPSERT',
        knowledgeSourceId: 'source-private',
        recordType: 'LearningAttempt',
        recordId: 'attempt-a',
        contentVersion: 'content.v1',
        pipelineVersion: 'pipeline.v1',
        ownerUserId: null,
      }),
    ).toThrow('KNOWLEDGE_SOURCE_CHANGE_INVALID');
    expect(() =>
      changes.enqueue({
        change: 'UPSERT',
        knowledgeSourceId: 'source-public',
        recordType: 'WordBook',
        recordId: 'word-a',
        contentVersion: 'content.v1',
        pipelineVersion: 'pipeline.v1',
        ownerUserId: 'user-a',
      }),
    ).toThrow('KNOWLEDGE_SOURCE_CHANGE_INVALID');
  });
});
