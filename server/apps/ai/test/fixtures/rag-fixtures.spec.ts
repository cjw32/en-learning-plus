import {
  createSyntheticRagCorpus,
  stableRagFixtureId,
} from './rag-synthetic-corpus';

describe('RAG synthetic fixtures', () => {
  it('creates deterministic source and content versions', () => {
    expect(createSyntheticRagCorpus()).toEqual(createSyntheticRagCorpus());
    expect(stableRagFixtureId('chunk', 'same-input')).toBe(
      stableRagFixtureId('chunk', 'same-input'),
    );
    expect(stableRagFixtureId('chunk', 'same-input')).not.toBe(
      stableRagFixtureId('chunk', 'different-input'),
    );
  });

  it('contains only synthetic, identity-free learning content', () => {
    const serialized = JSON.stringify(createSyntheticRagCorpus());

    expect(serialized).toContain('synthetic');
    expect(serialized).not.toMatch(
      /userId|email|phone|bearer|jwt|api[_-]?key|password|production/i,
    );
  });
});
