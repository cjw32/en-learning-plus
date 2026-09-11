import { createHash } from 'node:crypto';
import type { WordQuery } from '@en/common/word';
import {
  WORD_DICTIONARY_PROJECTABLE_FIELDS,
  WordDictionaryRepositoryError,
  type PrismaWordDictionaryRepository,
  type WordDictionaryProjectableField,
  type WordDictionaryRecord,
  type WordDictionaryRightsContext,
  type WordDictionarySearchInput,
} from './word-dictionary.repository';

export type WordDictionarySourceAuthorization = Readonly<{
  sourceKey: string;
  sourceName: string;
  rightsVersion: string;
  allowedFields: readonly string[];
}>;

export interface WordDictionarySourceRights {
  authorize(
    input: Readonly<{
      sourceKey: string;
      recordType: 'WordBook';
      fieldNames: readonly string[];
      usage: 'excerptDisplay';
      at?: Date;
    }>,
  ): Promise<WordDictionarySourceAuthorization>;
}

export type WordDictionaryEntry = Readonly<{
  word: Readonly<{
    wordId: string;
    word: string;
    definition?: string | null;
    translation?: string | null;
    partOfSpeech?: string | null;
    phonetic?: string | null;
    cefr?: null;
    availability: 'available' | 'partially_available';
    contentVersion: string;
  }>;
  forms: readonly string[];
  examples: readonly string[];
  source: Readonly<{
    citationId: string;
    source: string;
    title: string;
    excerpt?: string;
    contentVersion: string;
    accessScope: 'PUBLIC';
    status: 'active';
  }>;
  contentVersion: string;
  updatedAt: Date;
}>;

type Repository = Pick<
  PrismaWordDictionaryRepository,
  'findAll' | 'get' | 'search'
>;

export class WordDictionaryServiceError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'SOURCE_RIGHTS_DENIED'
      | 'RESOURCE_NOT_FOUND'
      | 'DATA_NOT_AVAILABLE',
  ) {
    super('The dictionary entry is unavailable.');
    this.name = 'WordDictionaryServiceError';
  }
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value: string | null | undefined): string | null {
  const normalized = value?.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized ? normalized : null;
}

function forms(exchange: string | null | undefined): readonly string[] {
  if (!exchange) return Object.freeze([]);
  const normalized = exchange
    .normalize('NFKC')
    .split(/[;,/|]/u)
    .map((value) => value.replace(/^[a-z0-9]+:/iu, '').trim())
    .filter(Boolean);
  return Object.freeze([...new Set(normalized)].slice(0, 20));
}

function project(
  record: WordDictionaryRecord,
  rights: WordDictionaryRightsContext,
  sourceName: string,
): WordDictionaryEntry {
  const allowed = new Set(rights.allowedFields);
  const definition = allowed.has('definition')
    ? normalize(record.definition)
    : null;
  const translation = allowed.has('translation')
    ? normalize(record.translation)
    : null;
  const partOfSpeech = allowed.has('pos') ? normalize(record.pos) : null;
  const phonetic = allowed.has('phonetic') ? normalize(record.phonetic) : null;
  const version = `word.${stableHash(
    `${record.id}\0${record.updatedAt.toISOString()}\0${rights.rightsVersion}\0${rights.allowedFields.join(',')}`,
  ).slice(0, 24)}`;
  const excerpt = definition ?? translation ?? undefined;

  return Object.freeze({
    word: Object.freeze({
      wordId: record.id,
      word: record.word.normalize('NFKC').trim(),
      definition,
      translation,
      partOfSpeech,
      phonetic,
      cefr: null,
      availability:
        definition || translation ? 'available' : 'partially_available',
      contentVersion: version,
    }),
    forms: allowed.has('exchange') ? forms(record.exchange) : Object.freeze([]),
    examples: Object.freeze([]),
    source: Object.freeze({
      citationId: `cit_${stableHash(
        `${rights.sourceKey}\0${record.id}\0${version}`,
      ).slice(0, 24)}`,
      source: rights.sourceKey,
      title: sourceName,
      ...(excerpt ? { excerpt: excerpt.slice(0, 2_000) } : {}),
      contentVersion: version,
      accessScope: 'PUBLIC' as const,
      status: 'active' as const,
    }),
    contentVersion: version,
    updatedAt: new Date(record.updatedAt),
  });
}

export class WordDictionaryService {
  constructor(
    private readonly repository: Repository,
    private readonly sourceRights?: WordDictionarySourceRights,
    private readonly options: Readonly<{
      sourceKey: string;
      now: () => Date;
    }> = {
      sourceKey: 'word-book',
      now: () => new Date(),
    },
  ) {}

  findAll(query: WordQuery) {
    return this.repository.findAll(query);
  }

  async get(input: Readonly<{ wordId: string }>): Promise<WordDictionaryEntry> {
    const authorization = await this.authorizeFields();
    let record: WordDictionaryRecord | null;
    try {
      record = await this.repository.get({
        wordId: input.wordId,
        rights: authorization.rights,
      });
    } catch (error) {
      this.rethrow(error);
    }
    if (!record) throw new WordDictionaryServiceError('RESOURCE_NOT_FOUND');
    return project(record, authorization.rights, authorization.sourceName);
  }

  async search(input: Omit<WordDictionarySearchInput, 'rights'>): Promise<
    Readonly<{
      items: readonly WordDictionaryEntry[];
      hasMore: boolean;
    }>
  > {
    const authorization = await this.authorizeFields();
    try {
      const page = await this.repository.search({
        ...input,
        rights: authorization.rights,
      });
      return Object.freeze({
        items: Object.freeze(
          page.items.map((record) =>
            project(record, authorization.rights, authorization.sourceName),
          ),
        ),
        hasMore: page.hasMore,
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  private async authorizeFields(): Promise<
    Readonly<{
      rights: WordDictionaryRightsContext;
      sourceName: string;
    }>
  > {
    if (!this.sourceRights) {
      throw new WordDictionaryServiceError('DATA_NOT_AVAILABLE');
    }
    const approved: WordDictionaryProjectableField[] = [];
    let sourceName = this.options.sourceKey;
    let rightsVersion = '';
    for (const fieldName of WORD_DICTIONARY_PROJECTABLE_FIELDS) {
      try {
        const authorization = await this.sourceRights.authorize({
          sourceKey: this.options.sourceKey,
          recordType: 'WordBook',
          fieldNames: [fieldName],
          usage: 'excerptDisplay',
          at: this.options.now(),
        });
        approved.push(fieldName);
        sourceName = authorization.sourceName;
        rightsVersion = authorization.rightsVersion;
      } catch {
        // Field-level denial removes the field; it never falls back to raw data.
      }
    }
    if (approved.length === 0 || !rightsVersion) {
      throw new WordDictionaryServiceError('SOURCE_RIGHTS_DENIED');
    }
    return Object.freeze({
      rights: Object.freeze({
        sourceKey: this.options.sourceKey,
        rightsVersion,
        allowedFields: Object.freeze(approved),
      }),
      sourceName,
    });
  }

  private rethrow(error: unknown): never {
    if (error instanceof WordDictionaryRepositoryError) {
      throw new WordDictionaryServiceError(error.code);
    }
    throw error;
  }
}
