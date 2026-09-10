import {
  InMemoryKnowledgeSourceRightsRepository,
  SourceRightsService,
} from '../source-rights.service';
import { GrammarKnowledgeSourceAdapter } from './grammar.source';
import { WordBookKnowledgeSourceAdapter } from './word-book.source';

const now = new Date('2026-09-08T00:00:00.000Z');

function rights() {
  return new SourceRightsService(
    new InMemoryKnowledgeSourceRightsRepository([
      {
        sourceKey: 'word-source',
        name: 'Synthetic words',
        sourceType: 'WORD_BOOK',
        rightsVersion: 'rights.test.v1',
        status: 'ACTIVE',
        allowEmbedding: true,
        allowExcerptDisplay: true,
        allowEvaluation: true,
        verifiedAt: now,
        validFrom: null,
        validUntil: null,
        fieldPolicies: [
          {
            recordType: 'WordBook',
            fieldName: 'definition',
            allowEmbedding: true,
            allowExcerptDisplay: true,
            allowEvaluation: true,
            contentCategory: 'WORD_MEANING',
            policyVersion: 'policy.v1',
          },
        ],
      },
      {
        sourceKey: 'grammar-source',
        name: 'Synthetic grammar',
        sourceType: 'GRAMMAR',
        rightsVersion: 'rights.test.v1',
        status: 'ACTIVE',
        allowEmbedding: true,
        allowExcerptDisplay: true,
        allowEvaluation: true,
        verifiedAt: now,
        validFrom: null,
        validUntil: null,
        fieldPolicies: [
          {
            recordType: 'Grammar',
            fieldName: 'rule',
            allowEmbedding: true,
            allowExcerptDisplay: true,
            allowEvaluation: true,
            contentCategory: 'GRAMMAR_RULE',
            policyVersion: 'policy.v1',
          },
        ],
      },
    ]),
  );
}

describe('public knowledge source adapters', () => {
  it('projects approved WordBook fields and ignores brand fields', async () => {
    const result = await new WordBookKnowledgeSourceAdapter(rights()).project({
      sourceKey: 'word-source',
      at: now,
      record: {
        id: 'word_test_harbor',
        word: 'harbor',
        definition: 'Harbor is a sheltered place for boats.',
        oxford: 'Unapproved brand field content.',
        collins: 'Another unapproved brand field.',
        bnc: '99',
        frq: '12',
        updatedAt: now,
      },
    });
    expect(result).toMatchObject({
      available: true,
      rightsVersion: 'rights.test.v1',
    });
    expect(JSON.stringify(result)).toContain('sheltered place');
    expect(JSON.stringify(result)).not.toMatch(
      /brand field|"oxford"|"collins"|"bnc"|"frq"/i,
    );
  });

  it('returns unavailable instead of inventing grammar content', async () => {
    await expect(
      new GrammarKnowledgeSourceAdapter(rights()).project({
        sourceKey: 'grammar-source',
        record: null,
        at: now,
      }),
    ).resolves.toEqual({
      available: false,
      reason: 'SOURCE_RECORD_UNAVAILABLE',
    });
  });
});
