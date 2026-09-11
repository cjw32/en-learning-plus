import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WordQuery } from '@en/common/word';
import { WordBookService } from '../word-book.service';

type WordDictionaryService = Readonly<{
  findAll(
    query: WordQuery,
  ): Promise<Readonly<{ total: number; list: unknown[] }>>;
}>;

type WordDictionaryServiceConstructor = new (
  repository: Readonly<{
    findAll(
      query: WordQuery,
    ): Promise<Readonly<{ total: number; list: unknown[] }>>;
  }>,
) => WordDictionaryService;

const dictionaryServicePath = resolve(
  __dirname,
  '../../../../../libs/learning/src/dictionary/word-dictionary.service.ts',
);

function loadDictionaryService(): WordDictionaryServiceConstructor {
  if (!existsSync(dictionaryServicePath)) {
    throw new Error('Missing shared WordDictionaryService (T051)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Service = require(dictionaryServicePath).WordDictionaryService as
    | WordDictionaryServiceConstructor
    | undefined;
  if (!Service) throw new Error('Missing WordDictionaryService export (T051)');
  return Service;
}

const query = Object.freeze({
  page: 2,
  pageSize: 2,
  word: 'prac',
  cet4: 'true',
  gre: 'false',
}) as unknown as WordQuery;

const rows = Object.freeze([
  Object.freeze({
    id: 'word_practice',
    word: 'practice',
    phonetic: '/ˈpræktɪs/',
    definition: 'to do something repeatedly to improve',
    translation: '练习',
    pos: 'verb',
    frq: '100',
    cet4: true,
    gre: false,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-10T00:00:00.000Z'),
  }),
  Object.freeze({
    id: 'word_practical',
    word: 'practical',
    phonetic: '/ˈpræktɪkəl/',
    definition: 'useful and suitable for a particular purpose',
    translation: '实用的',
    pos: 'adjective',
    frq: '90',
    cet4: true,
    gre: false,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:00.000Z'),
  }),
]);

const page = Object.freeze({ total: 5, list: rows });
const wrappedPage = Object.freeze({ data: page, code: 0, message: 'Success' });

async function legacyFindAllReference(
  response: Readonly<{ success(data: unknown): unknown }>,
  prisma: Readonly<{
    wordBook: Readonly<{
      count(input: unknown): Promise<number>;
      findMany(input: unknown): Promise<unknown>;
    }>;
  }>,
  input: WordQuery,
) {
  const { page = 1, pageSize = 12, word, ...rest } = input;
  const tags = Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [
      key,
      value === 'true' ? true : undefined,
    ]),
  );
  const where = { word: word ? { contains: word } : undefined, ...tags };
  const [total, list] = await Promise.all([
    prisma.wordBook.count({ where }),
    prisma.wordBook.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      orderBy: { frq: 'desc' },
    }),
  ]);
  return response.success({ total, list });
}

describe('WordBook shared dictionary regression', () => {
  it('pins the pre-delegation Prisma query and public response shape', async () => {
    const prisma = {
      wordBook: {
        count: jest.fn(async () => page.total),
        findMany: jest.fn(async () => rows),
      },
    };
    const response = {
      success: jest.fn((data: unknown) => ({
        data,
        code: 0,
        message: 'Success',
      })),
    };
    await expect(
      legacyFindAllReference(response, prisma, query),
    ).resolves.toEqual(wrappedPage);
    expect(prisma.wordBook.count).toHaveBeenCalledWith({
      where: {
        word: { contains: 'prac' },
        cet4: true,
        gre: undefined,
      },
    });
    expect(prisma.wordBook.findMany).toHaveBeenCalledWith({
      where: {
        word: { contains: 'prac' },
        cet4: true,
        gre: undefined,
      },
      skip: 2,
      take: 2,
      orderBy: { frq: 'desc' },
    });
    expect(response.success).toHaveBeenCalledWith(page);
  });

  it('keeps the shared dictionary facade transport-neutral and shape-equivalent', async () => {
    const repository = { findAll: jest.fn(async () => page) };
    const Dictionary = loadDictionaryService();
    const dictionary = new Dictionary(repository);

    await expect(dictionary.findAll(query)).resolves.toEqual(page);
    expect(repository.findAll).toHaveBeenCalledWith(query);
    await expect(dictionary.findAll(query)).resolves.not.toHaveProperty('code');
  });

  it('delegates the application flow once and preserves its response envelope', async () => {
    const dictionary = {
      findAll: jest.fn(async () => page),
    };
    const response = {
      success: jest.fn((data: unknown) => ({
        data,
        code: 0,
        message: 'Success',
      })),
    };
    const service = new WordBookService(response as never, dictionary as never);

    await expect(service.findAll(query)).resolves.toEqual(wrappedPage);
    expect(dictionary.findAll).toHaveBeenCalledTimes(1);
    expect(dictionary.findAll).toHaveBeenCalledWith(query);
    expect(response.success).toHaveBeenCalledTimes(1);
    expect(response.success).toHaveBeenCalledWith(page);
  });
});
