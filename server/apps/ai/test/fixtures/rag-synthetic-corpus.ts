import { createHash } from 'node:crypto';

export type SyntheticKnowledgeCategory =
  | 'WORD_MEANING'
  | 'WORD_TRANSLATION'
  | 'WORD_PRONUNCIATION'
  | 'WORD_FORM'
  | 'WORD_USAGE'
  | 'GRAMMAR_RULE'
  | 'GRAMMAR_EXCEPTION';

export type SyntheticKnowledgeRecord = Readonly<{
  sourceKey: string;
  sourceId: string;
  recordId: string;
  title: string;
  category: SyntheticKnowledgeCategory;
  content: string;
  contentVersion: string;
  rightsVersion: string;
  level: 'A1' | 'A2' | 'B1' | 'B2' | null;
}>;

export function stableRagFixtureId(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value, 'utf8').digest('hex');
  return `${prefix}_${digest.slice(0, 20)}`;
}

export function createSyntheticRagCorpus(): readonly SyntheticKnowledgeRecord[] {
  const rightsVersion = 'rights.synthetic.v1';
  const records = [
    {
      sourceKey: 'synthetic-word-reference',
      recordId: 'word:harbor',
      title: 'Synthetic entry: harbor',
      category: 'WORD_MEANING' as const,
      content: 'Harbor is a sheltered place where boats can anchor safely.',
      level: 'B1' as const,
    },
    {
      sourceKey: 'synthetic-word-reference',
      recordId: 'word:harbor',
      title: 'Synthetic entry: harbor pronunciation',
      category: 'WORD_PRONUNCIATION' as const,
      content: 'The synthetic pronunciation guide for harbor is /ˈhɑːrbər/.',
      level: 'B1' as const,
    },
    {
      sourceKey: 'synthetic-grammar-reference',
      recordId: 'grammar:present-perfect',
      title: 'Synthetic rule: present perfect',
      category: 'GRAMMAR_RULE' as const,
      content:
        'Use the present perfect for a past event with a stated connection to the present.',
      level: 'B1' as const,
    },
  ];

  return Object.freeze(
    records.map((record) => {
      const semanticInput = `${record.sourceKey}:${record.recordId}:${record.category}:${record.content}`;
      return Object.freeze({
        ...record,
        sourceId: stableRagFixtureId('src', record.recordId),
        contentVersion: stableRagFixtureId('content', semanticInput),
        rightsVersion,
      });
    }),
  );
}
