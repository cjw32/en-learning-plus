import { WrongAnswerProjector } from './wrong-answer.projector';
import { PrivateLearningSummaryService } from './private-learning-summary.service';

describe('private learning projections', () => {
  it('projects only a saved, verified wrong-answer fact', () => {
    const result = new WrongAnswerProjector().project({
      subjectId: 'user-a',
      attemptId: 'attempt_test_001',
      submissionStatus: 'SAVED',
      gradingValidated: true,
      targetType: 'WORD',
      targetKey: 'harbor',
      prompt: 'Choose the correct meaning of harbor.',
      learnerAnswer: 'airport',
      correction: 'harbor',
      explanation: 'A harbor is a sheltered place for boats.',
      errorTypes: ['VOCABULARY'],
      answerKey: 'must-not-be-projected',
      gradingRubric: 'must-not-be-projected',
      conversation: 'must-not-be-projected',
      traceId: 'must-not-be-projected',
      savedAt: new Date('2026-09-08T00:00:00.000Z'),
    });
    expect(result).toMatchObject({
      accessScope: 'PRIVATE_OWNER',
      ownerUserId: 'user-a',
      category: 'USER_ERROR',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /answerKey|gradingRubric|conversation|traceId|must-not-be-projected/i,
    );
  });

  it.each([
    ['draft submission', { submissionStatus: 'GRADED_VALID' }],
    ['unverified grading', { gradingValidated: false }],
    ['third-party PII', { explanation: 'Contact other@example.com.' }],
  ])('rejects %s', (_name, override) => {
    expect(() =>
      new WrongAnswerProjector().project({
        subjectId: 'user-a',
        attemptId: 'attempt_test_001',
        submissionStatus: 'SAVED',
        gradingValidated: true,
        targetType: 'WORD',
        targetKey: 'harbor',
        prompt: 'Choose the correct meaning of harbor.',
        learnerAnswer: 'airport',
        correction: 'harbor',
        explanation: 'A harbor is a sheltered place for boats.',
        errorTypes: ['VOCABULARY'],
        savedAt: new Date('2026-09-08T00:00:00.000Z'),
        ...override,
      } as never),
    ).toThrow();
  });

  it('builds a deterministic minimal summary only from saved facts', () => {
    const service = new PrivateLearningSummaryService();
    const facts = [
      {
        attemptId: 'attempt_test_001',
        savedAt: new Date('2026-09-07T00:00:00.000Z'),
        targetType: 'WORD' as const,
        targetKey: 'harbor',
        quality: 2,
        reviewState: 'LEARNING' as const,
      },
      {
        attemptId: 'attempt_test_002',
        savedAt: new Date('2026-09-08T00:00:00.000Z'),
        targetType: 'WORD' as const,
        targetKey: 'harbor',
        quality: 3,
        reviewState: 'REVIEW' as const,
      },
    ];
    const first = service.summarize({ subjectId: 'user-a', facts });
    const second = service.summarize({ subjectId: 'user-a', facts });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ownerUserId: 'user-a',
      topicType: 'WORD',
      topicKey: 'harbor',
      summaryFacts: { attemptCount: 2, lastQuality: 3, reviewState: 'REVIEW' },
    });
    expect(JSON.stringify(first)).not.toMatch(/prompt|conversation|trace|latency|token/i);
  });

  it('does not infer a weak item when there are no saved facts', () => {
    expect(
      new PrivateLearningSummaryService().summarize({
        subjectId: 'user-a',
        facts: [],
      }),
    ).toEqual([]);
  });
});
