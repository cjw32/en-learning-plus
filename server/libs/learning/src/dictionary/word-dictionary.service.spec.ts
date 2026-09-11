import {
  WordDictionaryService,
  type WordDictionarySourceRights,
} from './word-dictionary.service';

const record = Object.freeze({
  id: 'word_practice',
  word: ' practice ',
  definition: '  repeat   an activity to improve  ',
  translation: ' 练习 ',
  phonetic: '/ˈpræktɪs/',
  pos: 'verb',
  exchange: 'p:practiced/d:practiced/i:practicing/3:practices',
  frq: '100',
  updatedAt: new Date('2026-09-10T08:00:00.000Z'),
});

function fixture(allowed = ['definition', 'translation', 'exchange']) {
  const repository = {
    findAll: jest.fn(async () => ({ total: 1, list: [record] })),
    get: jest.fn(async () => record),
    search: jest.fn(async () => ({ items: [record], hasMore: false })),
  };
  const rights: WordDictionarySourceRights = {
    authorize: jest.fn(async ({ fieldNames }) => {
      if (!allowed.includes(fieldNames[0]!)) throw new Error('field denied');
      return {
        sourceKey: 'word-book',
        sourceName: 'Approved word book',
        rightsVersion: 'rights.v3',
        allowedFields: fieldNames,
      };
    }),
  };
  return {
    repository,
    rights,
    service: new WordDictionaryService(repository, rights, {
      sourceKey: 'word-book',
      now: () => new Date('2026-09-11T08:00:00.000Z'),
    }),
  };
}

describe('WordDictionaryService', () => {
  it('projects only approved fields with stable provenance', async () => {
    const test = fixture();
    const result = await test.service.get({ wordId: 'word_practice' });
    expect(result).toMatchObject({
      word: {
        wordId: 'word_practice',
        word: 'practice',
        definition: 'repeat an activity to improve',
        translation: '练习',
        partOfSpeech: null,
        phonetic: null,
        availability: 'available',
        contentVersion: expect.stringMatching(/^word\.[a-f0-9]{24}$/),
      },
      forms: ['practiced', 'practicing', 'practices'],
      examples: [],
      source: {
        citationId: expect.stringMatching(/^cit_[a-f0-9]{24}$/),
        source: 'word-book',
        title: 'Approved word book',
        accessScope: 'PUBLIC',
        status: 'active',
      },
      updatedAt: new Date('2026-09-10T08:00:00.000Z'),
    });
    expect(test.repository.get).toHaveBeenCalledWith({
      wordId: 'word_practice',
      rights: {
        sourceKey: 'word-book',
        rightsVersion: 'rights.v3',
        allowedFields: ['definition', 'translation', 'exchange'],
      },
    });
    expect(JSON.stringify(result)).not.toContain('/ˈpræktɪs/');
    expect(JSON.stringify(result)).not.toContain('"partOfSpeech":"verb"');
  });

  it('fails closed before repository access when no field is approved', async () => {
    const test = fixture([]);
    await expect(
      test.service.get({ wordId: 'word_practice' }),
    ).rejects.toMatchObject({ code: 'SOURCE_RIGHTS_DENIED' });
    expect(test.repository.get).not.toHaveBeenCalled();
  });

  it('uses the same normalized projection for deterministic search', async () => {
    const test = fixture();
    const page = await test.service.search({ query: 'practice', limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toEqual(
      await test.service.get({ wordId: 'word_practice' }),
    );
    expect(page.hasMore).toBe(false);
  });

  it('preserves the existing application page result without an MCP envelope', async () => {
    const test = fixture();
    const query = { page: 1, pageSize: 12, word: 'practice' };
    await expect(test.service.findAll(query)).resolves.toEqual({
      total: 1,
      list: [record],
    });
    expect(test.repository.findAll).toHaveBeenCalledWith(query);
  });
});
