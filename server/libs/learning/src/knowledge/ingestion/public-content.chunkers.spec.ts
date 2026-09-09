import { PublicLearningChunker } from './chunkers/public-learning.chunker';

describe('public learning content chunkers', () => {
  const chunker = new PublicLearningChunker({
    chunkingVersion: 'chunking.v1',
  });

  it('keeps word senses and usage fields in separate deterministic chunks', () => {
    const input = {
      documentId: 'document_test_harbor_001',
      source: 'synthetic-word-source',
      sourceId: 'word:word_test_harbor',
      title: 'harbor',
      wordId: 'word_test_harbor',
      level: 'B1',
      contentVersion: 'content.test.v1',
      fields: [
        {
          key: 'sense:noun:01',
          category: 'WORD_MEANING' as const,
          content: 'Harbor is a sheltered place for boats.',
        },
        {
          key: 'usage:noun:01',
          category: 'WORD_USAGE' as const,
          content: 'Harbor is commonly used as a countable noun.',
        },
      ],
    };

    const first = chunker.chunkWord(input);
    const second = chunker.chunkWord(input);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first.map((chunk) => chunk.chunkKey)).toEqual([
      'sense:noun:01',
      'usage:noun:01',
    ]);
    expect(first[0]?.content).not.toContain(first[1]!.content);
    expect(first.every((chunk) => chunk.wordId === input.wordId)).toBe(true);
  });

  it('does not invent grammar, examples, or collocations when fields are absent', () => {
    const chunks = chunker.chunkGrammar({
      documentId: 'document_test_grammar_001',
      source: 'synthetic-grammar-source',
      sourceId: 'grammar:present-perfect',
      title: 'Present perfect',
      level: 'B1',
      contentVersion: 'content.test.v1',
      sections: [],
    });

    expect(chunks).toEqual([]);
    expect(JSON.stringify(chunks)).not.toMatch(/example|collocation|exception/i);
  });

  it('rejects source fields without a real semantic key or content', () => {
    expect(() =>
      chunker.chunkWord({
        documentId: 'document_test_harbor_001',
        source: 'synthetic-word-source',
        sourceId: 'word:word_test_harbor',
        title: 'harbor',
        wordId: 'word_test_harbor',
        level: null,
        contentVersion: 'content.test.v1',
        fields: [
          {
            key: '',
            category: 'EXAMPLE_SENTENCE',
            content: '',
          },
        ],
      }),
    ).toThrow();
  });
});
