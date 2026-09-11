import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PrismaWordDictionaryRepository,
  type WordDictionaryRightsContext,
} from './word-dictionary.repository';

const rights: WordDictionaryRightsContext = Object.freeze({
  sourceKey: 'word-book',
  rightsVersion: 'rights.v1',
  allowedFields: Object.freeze(['definition', 'translation']),
});

function fixture() {
  const prisma = {
    wordBook: {
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => ({
        id: 'word_practice',
        word: 'practice',
        definition: 'repeat an activity to improve',
        translation: '练习',
        frq: '100',
        updatedAt: new Date('2026-09-11T08:00:00.000Z'),
      })),
      findMany: jest.fn(async () => [
        {
          id: 'word_practice',
          word: 'practice',
          definition: 'repeat an activity to improve',
          translation: '练习',
          frq: '100',
          updatedAt: new Date('2026-09-11T08:00:00.000Z'),
        },
      ]),
    },
  };
  return {
    repository: new PrismaWordDictionaryRepository(prisma as never),
    prisma,
  };
}

describe('PrismaWordDictionaryRepository', () => {
  it('requires an approved source-rights context before querying', async () => {
    const test = fixture();
    await expect(
      test.repository.get({
        wordId: 'word_practice',
        rights: { ...rights, allowedFields: [] },
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_RIGHTS_DENIED' });
    expect(test.prisma.wordBook.findFirst).not.toHaveBeenCalled();
  });

  it('selects only identity/version fields plus rights-approved content fields', async () => {
    const test = fixture();
    await test.repository.get({ wordId: 'word_practice', rights });
    expect(test.prisma.wordBook.findFirst).toHaveBeenCalledWith({
      where: { id: 'word_practice' },
      select: {
        id: true,
        word: true,
        frq: true,
        updatedAt: true,
        definition: true,
        translation: true,
      },
    });
    expect(test.prisma.wordBook.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ exchange: true, phonetic: true }),
      }),
    );
  });

  it('uses a bounded deterministic search with an ID tie-breaker', async () => {
    const test = fixture();
    await test.repository.search({
      query: ' practice ',
      limit: 10,
      afterId: 'word_previous',
      tags: { cet4: true },
      rights,
    });
    expect(test.prisma.wordBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { word: { contains: 'practice' }, cet4: true },
        orderBy: [{ frq: 'desc' }, { id: 'asc' }],
        cursor: { id: 'word_previous' },
        skip: 1,
        take: 11,
      }),
    );
  });

  it('does not depend on MCP transport or request-context types', () => {
    const source = readFileSync(
      resolve(__dirname, 'word-dictionary.repository.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/apps\/ai|mcp\/transport|McpRequestContext/);
  });
});
