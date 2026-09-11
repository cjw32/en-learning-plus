import type { WordQuery } from '@en/common/word';
import type { PrismaClient } from '@libs/shared/generated/prisma/client';

export const WORD_DICTIONARY_PROJECTABLE_FIELDS = Object.freeze([
  'definition',
  'translation',
  'phonetic',
  'pos',
  'exchange',
] as const);

export type WordDictionaryProjectableField =
  (typeof WORD_DICTIONARY_PROJECTABLE_FIELDS)[number];

export type WordDictionaryRightsContext = Readonly<{
  sourceKey: string;
  rightsVersion: string;
  allowedFields: readonly WordDictionaryProjectableField[];
}>;

export type WordDictionaryRecord = Readonly<{
  id: string;
  word: string;
  definition?: string | null;
  translation?: string | null;
  phonetic?: string | null;
  pos?: string | null;
  exchange?: string | null;
  frq?: string | null;
  updatedAt: Date;
}>;

export type WordDictionaryPage = Readonly<{
  items: readonly WordDictionaryRecord[];
  hasMore: boolean;
}>;

export type WordDictionarySearchInput = Readonly<{
  query: string;
  limit: number;
  afterId?: string;
  cefr?: string;
  tags?: Readonly<
    Partial<
      Record<
        'gk' | 'zk' | 'gre' | 'toefl' | 'ielts' | 'cet6' | 'cet4' | 'ky',
        boolean
      >
    >
  >;
  rights: WordDictionaryRightsContext;
}>;

export class WordDictionaryRepositoryError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'SOURCE_RIGHTS_DENIED') {
    super(
      code === 'VALIDATION_FAILED'
        ? 'Invalid dictionary query.'
        : 'Dictionary source is unavailable.',
    );
    this.name = 'WordDictionaryRepositoryError';
  }
}

type WordDictionaryPrismaClient = Pick<PrismaClient, 'wordBook'>;

const identifierPattern = /^[A-Za-z0-9_-]{1,64}$/;

function assertRights(
  rights: WordDictionaryRightsContext,
): readonly WordDictionaryProjectableField[] {
  const fields = [...new Set(rights.allowedFields)];
  if (
    !rights.sourceKey.trim() ||
    !rights.rightsVersion.trim() ||
    fields.length === 0 ||
    fields.some((field) => !WORD_DICTIONARY_PROJECTABLE_FIELDS.includes(field))
  ) {
    throw new WordDictionaryRepositoryError('SOURCE_RIGHTS_DENIED');
  }
  return fields;
}

function selectFor(
  rights: WordDictionaryRightsContext,
): Readonly<Record<string, true>> {
  return Object.freeze({
    id: true,
    word: true,
    frq: true,
    updatedAt: true,
    ...Object.fromEntries(assertRights(rights).map((field) => [field, true])),
  });
}

function legacyBoolean(value: string | boolean): boolean | undefined {
  return value === 'true' ? true : undefined;
}

export class PrismaWordDictionaryRepository {
  constructor(private readonly prisma: WordDictionaryPrismaClient) {}

  async get(
    input: Readonly<{
      wordId: string;
      rights: WordDictionaryRightsContext;
    }>,
  ): Promise<WordDictionaryRecord | null> {
    if (!identifierPattern.test(input.wordId)) {
      throw new WordDictionaryRepositoryError('VALIDATION_FAILED');
    }
    const row = await this.prisma.wordBook.findFirst({
      where: { id: input.wordId },
      select: selectFor(input.rights),
    });
    return row as WordDictionaryRecord | null;
  }

  async search(input: WordDictionarySearchInput): Promise<WordDictionaryPage> {
    const query = input.query.normalize('NFKC').trim();
    if (
      query.length < 1 ||
      query.length > 200 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50 ||
      (input.afterId !== undefined && !identifierPattern.test(input.afterId)) ||
      (input.cefr !== undefined &&
        !['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(input.cefr))
    ) {
      throw new WordDictionaryRepositoryError('VALIDATION_FAILED');
    }

    const rows = await this.prisma.wordBook.findMany({
      where: {
        word: { contains: query },
        ...(input.tags ?? {}),
      },
      select: selectFor(input.rights),
      orderBy: [{ frq: 'desc' }, { id: 'asc' }],
      ...(input.afterId ? { cursor: { id: input.afterId }, skip: 1 } : {}),
      take: input.limit + 1,
    });

    return Object.freeze({
      items: Object.freeze(
        rows.slice(0, input.limit) as unknown as WordDictionaryRecord[],
      ),
      hasMore: rows.length > input.limit,
    });
  }

  /**
   * Compatibility primitive for the existing `/word-book` application flow.
   * It intentionally preserves the pre-extraction query shape; MCP callers use
   * `get`/`search`, which enforce rights and deterministic keyset ordering.
   */
  async findAll(query: WordQuery): Promise<
    Readonly<{
      total: number;
      list: readonly Record<string, unknown>[];
    }>
  > {
    const { page = 1, pageSize = 12, word, ...rest } = query;
    const tags = Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [key, legacyBoolean(value)]),
    );
    const where = {
      word: word ? { contains: word } : undefined,
      ...tags,
    };
    const [total, list] = await Promise.all([
      this.prisma.wordBook.count({ where }),
      this.prisma.wordBook.findMany({
        where,
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        orderBy: { frq: 'desc' },
      }),
    ]);
    return Object.freeze({
      total,
      list: Object.freeze([...list]) as unknown as readonly Record<
        string,
        unknown
      >[],
    });
  }
}
