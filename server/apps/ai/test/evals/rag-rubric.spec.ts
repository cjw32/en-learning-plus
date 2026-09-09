import { resolve } from 'node:path';
import { loadFixedRagRubric } from './rag-rubric';

describe('fixed RAG quality rubric', () => {
  it('defines all scoring boundaries and reviewer privacy rules before a run', () => {
    const rubric = loadFixedRagRubric(
      resolve(__dirname, 'rubrics/rag-quality.json'),
    );
    expect(rubric.criteria.map((item) => item.id)).toEqual([
      'relevance',
      'citation_support',
      'faithfulness',
      'conflict_handling',
    ]);
    expect(rubric.criteria.every((item) => Object.isFrozen(item.anchors))).toBe(true);
    expect(rubric.reviewerPrivacy).toMatchObject({
      identityFieldsVisible: false,
      privateContentAllowed: false,
    });
    expect(rubric.disputeReview).toMatchObject({
      preserveOriginalScores: true,
      excludeUntilResolved: true,
    });
    expect(Object.isFrozen(rubric)).toBe(true);
    expect(Object.isFrozen(rubric.criteria)).toBe(true);
  });
});
