import {
  InMemoryKnowledgeSourceRightsRepository,
  SourceRightsService,
} from '@libs/learning/knowledge/ingestion/source-rights.service';

describe('RAG source rights policy', () => {
  const now = new Date('2026-09-08T00:00:00.000Z');

  function service(overrides: Record<string, unknown> = {}) {
    return new SourceRightsService(
      new InMemoryKnowledgeSourceRightsRepository([
        {
          sourceKey: 'approved-source',
          name: 'Synthetic approved source',
          sourceType: 'WORD_BOOK',
          rightsVersion: 'rights.v1',
          status: 'ACTIVE',
          allowEmbedding: true,
          allowExcerptDisplay: true,
          allowEvaluation: true,
          verifiedAt: now,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
          fieldPolicies: [
            {
              recordType: 'WordBook',
              fieldName: 'definition',
              allowEmbedding: true,
              allowExcerptDisplay: true,
              allowEvaluation: true,
              contentCategory: 'WORD_MEANING',
              policyVersion: 'field-policy.v1',
            },
          ],
          ...overrides,
        },
      ]),
    );
  }

  it('authorizes only explicitly allowed source fields and uses', async () => {
    await expect(
      service().authorize({
        sourceKey: 'approved-source',
        recordType: 'WordBook',
        fieldNames: ['definition'],
        usage: 'embedding',
        at: now,
      }),
    ).resolves.toMatchObject({
      rightsVersion: 'rights.v1',
      allowedFields: ['definition'],
    });
  });

  it.each(['oxford', 'collins', 'bnc', 'frq']) (
    'does not treat the %s field name as authorization evidence',
    async (fieldName) => {
      await expect(
        service().authorize({
          sourceKey: 'approved-source',
          recordType: 'WordBook',
          fieldNames: [fieldName],
          usage: 'embedding',
          at: now,
        }),
      ).rejects.toThrow('SOURCE_FIELD_NOT_ALLOWED');
    },
  );

  it.each([
    ['missing source', undefined, 'SOURCE_NOT_FOUND'],
    ['draft source', { status: 'DRAFT' }, 'SOURCE_NOT_ACTIVE'],
    [
      'expired source',
      { validUntil: new Date('2026-01-01T00:00:00.000Z') },
      'SOURCE_RIGHTS_EXPIRED',
    ],
    ['embedding disabled', { allowEmbedding: false }, 'SOURCE_USE_NOT_ALLOWED'],
  ])('rejects %s', async (_name, overrides, code) => {
    const target =
      overrides === undefined
        ? new SourceRightsService(new InMemoryKnowledgeSourceRightsRepository([]))
        : service(overrides);

    await expect(
      target.authorize({
        sourceKey: 'approved-source',
        recordType: 'WordBook',
        fieldNames: ['definition'],
        usage: 'embedding',
        at: now,
      }),
    ).rejects.toThrow(code);
  });
});
