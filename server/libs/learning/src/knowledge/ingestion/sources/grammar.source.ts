import { PublicLearningField } from '../chunkers/public-learning.chunker';
import { SourceRightsService } from '../source-rights.service';

export type GrammarKnowledgeRecord = Readonly<{
  id: string;
  title: string;
  level?: string | null;
  updatedAt: Date;
  sections: readonly Readonly<{
    fieldName: string;
    semanticKey: string;
    content: string;
  }>[];
}>;

export class GrammarKnowledgeSourceAdapter {
  constructor(private readonly rights: SourceRightsService) {}

  async project(input: {
    sourceKey: string;
    record: GrammarKnowledgeRecord | null;
    at?: Date;
  }): Promise<
    | Readonly<{ available: false; reason: 'SOURCE_RECORD_UNAVAILABLE' | 'NO_CONTENT' }>
    | Readonly<{
        available: true;
        source: string;
        sourceId: string;
        recordType: 'Grammar';
        recordId: string;
        title: string;
        level: string | null;
        sourceUpdatedAt: Date;
        rightsVersion: string;
        sections: readonly (PublicLearningField & { fieldName: string })[];
      }>
  > {
    if (!input.record) {
      return { available: false, reason: 'SOURCE_RECORD_UNAVAILABLE' };
    }
    const sections = input.record.sections
      .map((section) => ({
        ...section,
        semanticKey: section.semanticKey.trim(),
        content: section.content.normalize('NFKC').trim(),
      }))
      .filter((section) => section.semanticKey && section.content);
    if (sections.length === 0) return { available: false, reason: 'NO_CONTENT' };

    const authorization = await this.rights.authorize({
      sourceKey: input.sourceKey,
      recordType: 'Grammar',
      fieldNames: sections.map((section) => section.fieldName),
      usage: 'embedding',
      at: input.at,
    });
    const policyByField = new Map(
      authorization.fieldPolicies.map((policy) => [policy.fieldName, policy]),
    );
    return Object.freeze({
      available: true as const,
      source: authorization.sourceKey,
      sourceId: `grammar:${input.record.id}`,
      recordType: 'Grammar' as const,
      recordId: input.record.id,
      title: input.record.title.trim(),
      level: input.record.level ?? null,
      sourceUpdatedAt: input.record.updatedAt,
      rightsVersion: authorization.rightsVersion,
      sections: Object.freeze(
        sections.map((section) =>
          Object.freeze({
            fieldName: section.fieldName,
            key: section.semanticKey,
            category: policyByField.get(section.fieldName)!.contentCategory,
            content: section.content,
            factKey: `grammar:${input.record!.id}:${section.semanticKey}`,
            authorityRank: null,
          }),
        ),
      ),
    });
  }
}
