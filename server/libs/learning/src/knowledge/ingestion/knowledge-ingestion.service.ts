import { createHash } from 'node:crypto';
import {
  KnowledgeReleaseStatus,
  assertKnowledgeStateTransition,
} from '../domain/knowledge.types';
import { KnowledgeContentValidator } from './content-validator';
import { EmbeddingGateway, assertEmbeddingVectors } from './embedding.gateway';
import {
  PublicLearningChunk,
  PublicLearningChunker,
} from './chunkers/public-learning.chunker';
import { SourceRightsService } from './source-rights.service';

type IngestionRelease = {
  id: string;
  scopeKey: string;
  contentVersion: string;
  rightsVersion: string;
  chunkingVersion: string;
  embeddingVersion: string;
  retrievalConfigVersion: string;
  indexVersion: string;
  expectedChunkCount: number;
  readyEmbeddingCount: number;
  status: KnowledgeReleaseStatus;
};

type IngestionChunk = Omit<PublicLearningChunk, 'status'> & {
  status: 'STAGED' | 'ACTIVE' | 'SUPERSEDED' | 'INVALID';
};

export interface KnowledgeIngestionPersistence {
  stage(input: {
    release: IngestionRelease;
    document: Readonly<Record<string, unknown>>;
    chunks: readonly PublicLearningChunk[];
  }): Promise<void>;
  activate(input: {
    releaseId: string;
    embeddings: readonly Readonly<{
      chunkId: string;
      vector: readonly number[];
      provider: string;
      model: string;
      dimensions: number;
      embeddingVersion: string;
    }>[];
  }): Promise<IngestionRelease>;
  invalidate(releaseId: string): Promise<void>;
}

// Promise-based interface methods resolve synchronously in this test adapter.
/* eslint-disable @typescript-eslint/require-await */
export class InMemoryKnowledgeIngestionPersistence implements KnowledgeIngestionPersistence {
  private readonly releases: IngestionRelease[] = [];
  private readonly documents: Array<Record<string, unknown>> = [];
  private readonly chunks: IngestionChunk[] = [];
  private readonly embeddings: Array<Record<string, unknown>> = [];

  async stage(input: {
    release: IngestionRelease;
    document: Readonly<Record<string, unknown>>;
    chunks: readonly PublicLearningChunk[];
  }): Promise<void> {
    const existingRelease = this.releases.find(
      (item) => item.id === input.release.id,
    );
    if (existingRelease) {
      if (
        existingRelease.scopeKey !== input.release.scopeKey ||
        existingRelease.contentVersion !== input.release.contentVersion ||
        existingRelease.embeddingVersion !== input.release.embeddingVersion ||
        existingRelease.expectedChunkCount !== input.release.expectedChunkCount
      ) {
        throw new Error('KNOWLEDGE_RELEASE_ID_COLLISION');
      }
    } else {
      this.releases.push({ ...input.release });
    }
    const documentId = String(input.document.id);
    const existingDocument = this.documents.find(
      (item) => String(item.id) === documentId,
    );
    if (!existingDocument) {
      this.documents.push({ ...input.document, status: 'STAGED' });
    }
    for (const chunk of input.chunks) {
      const existing = this.chunks.find((item) => item.id === chunk.id);
      if (existing && existing.contentHash !== chunk.contentHash) {
        throw new Error('KNOWLEDGE_CHUNK_ID_COLLISION');
      }
      if (!existing) this.chunks.push({ ...chunk });
    }
  }

  async activate(input: {
    releaseId: string;
    embeddings: readonly Readonly<Record<string, unknown>>[];
  }): Promise<IngestionRelease> {
    const release = this.releases.find((item) => item.id === input.releaseId);
    if (!release) throw new Error('KNOWLEDGE_RELEASE_NOT_FOUND');
    if (input.embeddings.length !== release.expectedChunkCount) {
      throw new Error('KNOWLEDGE_RELEASE_INCOMPLETE');
    }
    if (release.status === 'ACTIVE') return { ...release };
    if (release.status !== 'BUILDING') {
      throw new Error('KNOWLEDGE_RELEASE_NOT_BUILDING');
    }
    assertKnowledgeStateTransition('release', release.status, 'READY');
    release.status = 'READY';
    release.readyEmbeddingCount = input.embeddings.length;
    assertKnowledgeStateTransition('release', release.status, 'ACTIVE');
    for (const oldRelease of this.releases) {
      if (
        oldRelease.id !== release.id &&
        oldRelease.scopeKey === release.scopeKey &&
        oldRelease.status === 'ACTIVE'
      ) {
        oldRelease.status = 'SUPERSEDED';
        const oldDocumentIds = new Set(
          this.documents
            .filter((document) => document.releaseId === oldRelease.id)
            .map((document) => String(document.id)),
        );
        for (const document of this.documents) {
          if (document.releaseId === oldRelease.id) {
            document.status = 'SUPERSEDED';
          }
        }
        for (const chunk of this.chunks) {
          if (oldDocumentIds.has(chunk.documentId)) {
            chunk.status = 'SUPERSEDED';
          }
        }
      }
    }
    release.status = 'ACTIVE';
    for (const document of this.documents) {
      if (document.releaseId === release.id) document.status = 'ACTIVE';
    }
    for (const chunk of this.chunks) {
      if (
        chunk.documentId ===
        this.documents.find((d) => d.releaseId === release.id)?.id
      ) {
        chunk.status = 'ACTIVE';
      }
    }
    for (const embedding of input.embeddings) {
      const existing = this.embeddings.find(
        (item) =>
          item.chunkId === embedding.chunkId &&
          item.embeddingVersion === embedding.embeddingVersion,
      );
      if (!existing) {
        this.embeddings.push({
          ...embedding,
          releaseId: release.id,
          status: 'READY',
        });
      }
    }
    return { ...release };
  }

  async invalidate(releaseId: string): Promise<void> {
    const release = this.releases.find((item) => item.id === releaseId);
    if (!release || release.status === 'INVALID') return;
    if (release.status === 'ACTIVE' || release.status === 'SUPERSEDED') {
      throw new Error('KNOWLEDGE_RELEASE_INVALIDATION_REQUIRES_COORDINATOR');
    }
    release.status = 'INVALID';
    const documentIds = new Set(
      this.documents
        .filter((document) => document.releaseId === releaseId)
        .map((document) => String(document.id)),
    );
    for (const document of this.documents) {
      if (document.releaseId === releaseId) document.status = 'INVALID';
    }
    for (const chunk of this.chunks) {
      if (documentIds.has(chunk.documentId)) chunk.status = 'INVALID';
    }
  }

  searchableChunks(): readonly IngestionChunk[] {
    const activeDocumentIds = new Set(
      this.documents
        .filter((document) => document.status === 'ACTIVE')
        .map((document) => String(document.id)),
    );
    return this.chunks.filter(
      (chunk) =>
        chunk.status === 'ACTIVE' && activeDocumentIds.has(chunk.documentId),
    );
  }

  snapshot() {
    return {
      releases: this.releases.map((item) => ({ ...item })),
      documents: this.documents.map((item) => ({ ...item })),
      chunks: this.chunks.map((item) => ({ ...item })),
      embeddings: this.embeddings.map((item) => ({ ...item })),
    };
  }
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

/* eslint-enable @typescript-eslint/require-await */
export class KnowledgeIngestionService {
  constructor(
    private readonly dependencies: Readonly<{
      rights: SourceRightsService;
      validator: KnowledgeContentValidator;
      chunker: PublicLearningChunker;
      embedding: EmbeddingGateway;
      persistence: KnowledgeIngestionPersistence;
    }>,
  ) {}

  async ingestPublicWord(input: {
    sourceKey: string;
    recordType: 'WordBook';
    recordId: string;
    sourceId: string;
    title: string;
    wordId: string;
    level: string | null;
    sourceUpdatedAt: Date;
    fields: readonly Readonly<{
      fieldName: string;
      key: string;
      category: PublicLearningChunk['category'];
      content: string;
    }>[];
    versions: Readonly<{
      contentVersion: string;
      rightsVersion: string;
      chunkingVersion: string;
      embeddingVersion: string;
      retrievalConfigVersion: string;
      indexVersion: string;
    }>;
    embeddingDimensions: number;
    at?: Date;
  }): Promise<IngestionRelease> {
    const authorization = await this.dependencies.rights.authorize({
      sourceKey: input.sourceKey,
      recordType: input.recordType,
      fieldNames: input.fields.map((field) => field.fieldName),
      usage: 'embedding',
      at: input.at,
    });
    if (authorization.rightsVersion !== input.versions.rightsVersion) {
      throw new Error('SOURCE_RIGHTS_VERSION_MISMATCH');
    }
    if (
      input.versions.chunkingVersion !== this.dependencies.chunker.version()
    ) {
      throw new Error('CHUNKING_VERSION_MISMATCH');
    }

    const scopeKey = `${input.sourceKey}:${input.recordType}:${input.recordId}`;
    const releaseId = stableId(
      'release',
      `${scopeKey}\0${Object.values(input.versions).join('\0')}`,
    );
    const documentId = stableId(
      'document',
      `${scopeKey}\0${input.versions.contentVersion}`,
    );
    const fields = input.fields.map((field) => ({
      key: field.key,
      category: field.category,
      content: this.dependencies.validator.validate({
        content: field.content,
        visibility: 'public',
        accessScope: 'PUBLIC',
        ownerUserId: null,
      }).content,
      factKey: `${input.sourceId}:${field.key}`,
    }));
    const chunks = this.dependencies.chunker.chunkWord({
      documentId,
      source: input.sourceKey,
      sourceId: input.sourceId,
      title: input.title,
      wordId: input.wordId,
      level: input.level,
      contentVersion: input.versions.contentVersion,
      fields,
    });
    if (chunks.length === 0) throw new Error('KNOWLEDGE_RELEASE_EMPTY');

    const release: IngestionRelease = {
      id: releaseId,
      scopeKey,
      ...input.versions,
      expectedChunkCount: chunks.length,
      readyEmbeddingCount: 0,
      status: 'BUILDING',
    };
    await this.dependencies.persistence.stage({
      release,
      document: {
        id: documentId,
        releaseId,
        source: input.sourceKey,
        sourceId: input.sourceId,
        sourceRecordType: input.recordType,
        sourceRecordId: input.recordId,
        title: input.title,
        wordId: input.wordId,
        level: input.level,
        contentVersion: input.versions.contentVersion,
        sourceUpdatedAt: input.sourceUpdatedAt,
        accessScope: 'PUBLIC',
        visibility: 'public',
      },
      chunks,
    });

    try {
      const response = await this.dependencies.embedding.embed({
        texts: chunks.map((chunk) => chunk.content),
        expectedDimensions: input.embeddingDimensions,
        embeddingVersion: input.versions.embeddingVersion,
      });
      assertEmbeddingVectors(
        response.vectors,
        chunks.length,
        input.embeddingDimensions,
      );
      return await this.dependencies.persistence.activate({
        releaseId,
        embeddings: chunks.map((chunk, index) => ({
          chunkId: chunk.id,
          vector: response.vectors[index],
          provider: response.provider,
          model: response.model,
          dimensions: response.dimensions,
          embeddingVersion: response.embeddingVersion,
        })),
      });
    } catch (error) {
      await this.dependencies.persistence.invalidate(releaseId);
      throw error;
    }
  }
}
