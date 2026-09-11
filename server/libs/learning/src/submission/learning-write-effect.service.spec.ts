import { LearningWriteEffectService } from './learning-write-effect.service';

describe('LearningWriteEffectService', () => {
  const service = new LearningWriteEffectService();

  it('describes every authoritative consequence deterministically', () => {
    const first = service.summarize({ answerCount: 2 });
    const second = service.summarize({ answerCount: 2 });

    expect(first).toEqual({
      answerCount: 2,
      willSaveAttempt: true,
      willUpdateMastery: true,
      willUpdateReviewSchedule: true,
      notice:
        'Your 2 answers will be graded and saved; mastery and the review schedule will be updated.',
    });
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('uses learner-visible singular wording without answer or rubric detail', () => {
    expect(service.summarize({ answerCount: 1 })).toEqual({
      answerCount: 1,
      willSaveAttempt: true,
      willUpdateMastery: true,
      willUpdateReviewSchedule: true,
      notice:
        'Your answer will be graded and saved; mastery and the review schedule will be updated.',
    });
  });

  it.each([0, 51, 1.5, Number.NaN])(
    'rejects the invalid answer count %p',
    (answerCount) => {
      expect(() => service.summarize({ answerCount })).toThrow();
    },
  );

  it('rejects answer keys, answers, scores, and internal rubrics as unknown input', () => {
    for (const privateField of [
      { answer: 'private learner answer' },
      { answerKey: 'hidden answer' },
      { score: 100 },
      { gradingRubric: 'hidden rubric' },
    ]) {
      expect(() =>
        service.summarize({ answerCount: 1, ...privateField }),
      ).toThrow();
    }
  });
});
