import { createHash, randomBytes } from 'node:crypto';
import {
  KnowledgeDomainError,
  KnowledgeRetrievalResult,
} from '../domain/knowledge.types';

export type IssuedKnowledgeCitation = Readonly<{
  citationId: string;
  source: string;
  sourceId: string;
  title: string;
  excerpt: string;
  category: KnowledgeRetrievalResult['category'];
  wordId: string | null;
  courseId: string | null;
  accessScope: KnowledgeRetrievalResult['accessScope'];
  status: 'active';
  usage: 'answer_evidence' | 'conflict_context';
}>;

export type KnowledgeCitationRecord = IssuedKnowledgeCitation &
  Readonly<{
    requestId: string;
    chunkId: string;
    documentId: string;
    sourceIdHash: string;
    contentVersion: string;
    embeddingVersion: string;
    excerptHash: string;
    rank: number;
    relevanceScore: number;
  }>;

export interface CitationPersistence {
  insertMany(records: readonly KnowledgeCitationRecord[]): Promise<void>;
  hasId(citationId: string): Promise<boolean>;
}

export class InMemoryCitationPersistence implements CitationPersistence {
  private readonly records = new Map<string, KnowledgeCitationRecord>();

  insertMany(records: readonly KnowledgeCitationRecord[]): Promise<void> {
    for (const record of records) {
      if (this.records.has(record.citationId)) {
        throw new Error('CITATION_ID_COLLISION');
      }
    }
    for (const record of records) this.records.set(record.citationId, record);
    return Promise.resolve();
  }

  hasId(citationId: string): Promise<boolean> {
    return Promise.resolve(this.records.has(citationId));
  }

  snapshot(): readonly KnowledgeCitationRecord[] {
    return Object.freeze([...this.records.values()]);
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const unsafeExcerpt =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:bearer\s+)?eyJ[A-Za-z0-9_-]{8,}\./i;

export class CitationIssuerService {
  constructor(
    private readonly persistence: CitationPersistence,
    private readonly randomId: () => string = () =>
      randomBytes(18).toString('base64url'),
  ) {}

  async issue(input: {
    requestId: string;
    results: readonly KnowledgeRetrievalResult[];
    usage?: 'answer_evidence' | 'conflict_context';
  }): Promise<readonly IssuedKnowledgeCitation[]> {
    if (!input.requestId.trim() || input.results.length > 20) {
      throw new KnowledgeDomainError('CITATION_INVALID');
    }
    const records: KnowledgeCitationRecord[] = [];
    for (const result of input.results) {
      const excerpt = result.content
        .normalize('NFKC')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!excerpt || excerpt.length > 2000 || unsafeExcerpt.test(excerpt)) {
        throw new KnowledgeDomainError('CITATION_INVALID');
      }
      let citationId = '';
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const candidate = `cit_${this.randomId()}`;
        if (
          /^cit_[A-Za-z0-9_-]{10,48}$/.test(candidate) &&
          !records.some((record) => record.citationId === candidate) &&
          !(await this.persistence.hasId(candidate))
        ) {
          citationId = candidate;
          break;
        }
      }
      if (!citationId) throw new Error('CITATION_ID_GENERATION_FAILED');
      records.push(
        Object.freeze({
          citationId,
          requestId: input.requestId,
          chunkId: result.chunkId,
          documentId: result.documentId,
          source: result.source,
          sourceId: result.sourceId,
          sourceIdHash: hash(result.sourceId),
          title: result.title,
          excerpt,
          excerptHash: hash(excerpt),
          category: result.category,
          wordId: result.wordId,
          courseId: result.courseId,
          accessScope: result.accessScope,
          contentVersion: result.contentVersion,
          embeddingVersion: result.embeddingVersion,
          rank: result.rank,
          relevanceScore: result.relevanceScore,
          status: 'active' as const,
          usage: input.usage ?? 'answer_evidence',
        }),
      );
    }
    await this.persistence.insertMany(records);
    return Object.freeze(
      records.map((record) =>
        Object.freeze({
          citationId: record.citationId,
          source: record.source,
          sourceId: record.sourceId,
          title: record.title,
          excerpt: record.excerpt,
          category: record.category,
          wordId: record.wordId,
          courseId: record.courseId,
          accessScope: record.accessScope,
          status: record.status,
          usage: record.usage,
        }),
      ),
    );
  }
}
