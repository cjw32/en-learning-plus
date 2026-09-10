import { createHash } from 'node:crypto';
import { KnowledgeCategory } from '../../domain/knowledge.types';

export type PublicLearningField = Readonly<{
  key: string;
  category: KnowledgeCategory;
  content: string;
  factKey?: string | null;
  authorityRank?: number | null;
}>;

export type PublicLearningChunk = Readonly<{
  id: string;
  documentId: string;
  chunkKey: string;
  ordinal: number;
  content: string;
  contentHash: string;
  chunkingVersion: string;
  source: string;
  sourceId: string;
  title: string;
  category: KnowledgeCategory;
  level: string | null;
  courseId: string | null;
  wordId: string | null;
  visibility: 'public';
  contentVersion: string;
  factKey: string | null;
  factValueHash: string;
  authorityRank: number | null;
  status: 'STAGED';
}>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export class PublicLearningChunker {
  constructor(private readonly config: Readonly<{ chunkingVersion: string }>) {
    if (!config.chunkingVersion.trim()) {
      throw new Error('CHUNKING_VERSION_REQUIRED');
    }
  }

  version(): string {
    return this.config.chunkingVersion;
  }

  chunkWord(input: {
    documentId: string;
    source: string;
    sourceId: string;
    title: string;
    wordId: string;
    level: string | null;
    contentVersion: string;
    fields: readonly PublicLearningField[];
  }): readonly PublicLearningChunk[] {
    return this.chunk({ ...input, courseId: null });
  }

  chunkGrammar(input: {
    documentId: string;
    source: string;
    sourceId: string;
    title: string;
    level: string | null;
    contentVersion: string;
    sections: readonly PublicLearningField[];
  }): readonly PublicLearningChunk[] {
    return this.chunk({
      ...input,
      wordId: null,
      courseId: null,
      fields: input.sections,
    });
  }

  chunkCourse(input: {
    documentId: string;
    source: string;
    sourceId: string;
    title: string;
    courseId: string;
    level: string | null;
    contentVersion: string;
    sections: readonly PublicLearningField[];
  }): readonly PublicLearningChunk[] {
    return this.chunk({ ...input, wordId: null, fields: input.sections });
  }

  private chunk(input: {
    documentId: string;
    source: string;
    sourceId: string;
    title: string;
    wordId: string | null;
    courseId: string | null;
    level: string | null;
    contentVersion: string;
    fields: readonly PublicLearningField[];
  }): readonly PublicLearningChunk[] {
    for (const field of input.fields) {
      if (!field.key.trim() || !normalize(field.content)) {
        throw new Error('CHUNK_SOURCE_FIELD_INVALID');
      }
    }
    if (
      new Set(input.fields.map((field) => field.key)).size !==
      input.fields.length
    ) {
      throw new Error('CHUNK_SOURCE_KEY_DUPLICATE');
    }

    return Object.freeze(
      input.fields.map((field, ordinal) => {
        const content = normalize(field.content);
        const contentHash = sha256(content);
        const identity = [
          input.documentId,
          this.config.chunkingVersion,
          field.key,
          contentHash,
        ].join('\0');
        return Object.freeze({
          id: `chunk_${sha256(identity).slice(0, 24)}`,
          documentId: input.documentId,
          chunkKey: field.key,
          ordinal,
          content,
          contentHash,
          chunkingVersion: this.config.chunkingVersion,
          source: normalize(input.source),
          sourceId: normalize(input.sourceId),
          title: normalize(input.title),
          category: field.category,
          level: input.level,
          courseId: input.courseId,
          wordId: input.wordId,
          visibility: 'public' as const,
          contentVersion: input.contentVersion,
          factKey: field.factKey ?? null,
          factValueHash: sha256(
            field.factKey ? `${field.factKey}\0${content}` : content,
          ),
          authorityRank: field.authorityRank ?? null,
          status: 'STAGED' as const,
        });
      }),
    );
  }
}
