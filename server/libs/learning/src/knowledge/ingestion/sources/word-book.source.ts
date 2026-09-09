import { SourceRightsService } from '../source-rights.service';
import { PublicLearningField } from '../chunkers/public-learning.chunker';

export type WordBookKnowledgeRecord = Readonly<{
  id: string;
  word: string;
  definition?: string | null;
  translation?: string | null;
  phonetic?: string | null;
  pos?: string | null;
  exchange?: string | null;
  oxford?: string | null;
  collins?: string | null;
  bnc?: string | null;
  frq?: string | null;
  level?: string | null;
  updatedAt: Date;
}>;

const projectedFields = [
  'definition',
  'translation',
  'phonetic',
  'pos',
  'exchange',
] as const;

export class WordBookKnowledgeSourceAdapter {
  constructor(private readonly rights: SourceRightsService) {}

  async project(input: {
    sourceKey: string;
    record: WordBookKnowledgeRecord | null;
    at?: Date;
  }): Promise<
    | Readonly<{ available: false; reason: 'SOURCE_RECORD_UNAVAILABLE' | 'NO_CONTENT' }>
    | Readonly<{
        available: true;
        source: string;
        sourceId: string;
        recordType: 'WordBook';
        recordId: string;
        title: string;
        wordId: string;
        level: string | null;
        sourceUpdatedAt: Date;
        rightsVersion: string;
        fields: readonly (PublicLearningField & { fieldName: string })[];
      }>
  > {
    if (!input.record) {
      return { available: false, reason: 'SOURCE_RECORD_UNAVAILABLE' };
    }
    const values = projectedFields
      .map((fieldName) => ({
        fieldName,
        content: input.record?.[fieldName]?.normalize('NFKC').trim() ?? '',
      }))
      .filter((field) => field.content.length > 0);
    if (values.length === 0) return { available: false, reason: 'NO_CONTENT' };

    const authorization = await this.rights.authorize({
      sourceKey: input.sourceKey,
      recordType: 'WordBook',
      fieldNames: values.map((field) => field.fieldName),
      usage: 'embedding',
      at: input.at,
    });
    const policyByField = new Map(
      authorization.fieldPolicies.map((policy) => [policy.fieldName, policy]),
    );
    return Object.freeze({
      available: true as const,
      source: authorization.sourceKey,
      sourceId: `word:${input.record.id}`,
      recordType: 'WordBook' as const,
      recordId: input.record.id,
      title: input.record.word.trim(),
      wordId: input.record.id,
      level: input.record.level ?? null,
      sourceUpdatedAt: input.record.updatedAt,
      rightsVersion: authorization.rightsVersion,
      fields: Object.freeze(
        values.map((field, index) => {
          const policy = policyByField.get(field.fieldName)!;
          return Object.freeze({
            fieldName: field.fieldName,
            key: `${field.fieldName}:${String(index + 1).padStart(2, '0')}`,
            category: policy.contentCategory,
            content: field.content,
            factKey: `word:${input.record!.id}:${field.fieldName}`,
            authorityRank: null,
          });
        }),
      ),
    });
  }
}
