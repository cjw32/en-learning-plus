import {
  GradingService,
  type GradableExercise,
  type SubjectiveGrader,
} from './grading.service';

const objectiveExercise: GradableExercise = {
  id: 'exercise_00001',
  version: 'exercise-v1',
  type: 'FILL_BLANK',
  citations: [],
  items: [
    {
      id: 'exercise_item_00001',
      position: 1,
      prompt: 'Yesterday I ___ home.',
      choices: null,
      answerKey: { accepted: ['went', 'WENT.'] },
      gradingRubric: { mode: 'normalized_exact' },
      maxScore: 40,
      citations: [],
      targets: [{ targetType: 'WORD', targetKey: 'word-1', weight: 1 }],
    },
    {
      id: 'exercise_item_00002',
      position: 2,
      prompt: 'She ___ to school.',
      choices: null,
      answerKey: { accepted: ['went'] },
      gradingRubric: { mode: 'normalized_exact' },
      maxScore: 60,
      citations: [],
      targets: [{ targetType: 'ERROR_TYPE', targetKey: 'TENSE', weight: 1 }],
    },
  ],
};

describe('GradingService', () => {
  it('grades objective answers deterministically with acceptable normalization', async () => {
    const service = new GradingService();
    const result = await service.grade({
      exercise: objectiveExercise,
      answers: [
        { itemId: 'exercise_item_00001', answer: ' Went! ' },
        { itemId: 'exercise_item_00002', answer: 'go' },
      ],
    });
    expect(result.status).toBe('GRADED_VALID');
    expect(result.score).toBe(40);
    expect(result.items.map((item) => item.score)).toEqual([40, 0]);
    expect(result.items[1]).toMatchObject({
      isCorrect: false,
      errorTypes: ['VOCABULARY'],
    });
    expect(result.gradingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.answerVersion).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    { answers: [] },
    { answers: [{ itemId: 'exercise_item_00001', answer: 'went' }] },
    {
      answers: [
        { itemId: 'exercise_item_00001', answer: 'went' },
        { itemId: 'exercise_item_00001', answer: 'went' },
      ],
    },
    {
      answers: [
        { itemId: 'exercise_item_00001', answer: 'x'.repeat(4001) },
        { itemId: 'exercise_item_00002', answer: 'went' },
      ],
    },
  ])('returns an ungradable result for invalid answer sets', async ({ answers }) => {
    const result = await new GradingService().grade({
      exercise: objectiveExercise,
      answers,
    });
    expect(result.status).toBe('GRADING_FAILED');
    expect(result.score).toBeNull();
    expect(result.gradingHash).toBeNull();
  });

  it('uses a bounded subjective evaluator but computes total and hash in business code', async () => {
    const subjective: SubjectiveGrader = {
      evaluate: jest.fn(async () => ({
        scoreRatio: 0.75,
        isCorrect: false,
        correction: 'I went to the station.',
        explanation: 'Use a natural destination phrase.',
        errorTypes: ['EXPRESSION'],
        examples: ['She went to the station.'],
      })),
    };
    const exercise: GradableExercise = {
      ...objectiveExercise,
      id: 'exercise_subjective_01',
      type: 'TRANSLATION',
      items: [
        {
          ...objectiveExercise.items[0]!,
          id: 'exercise_subjective_item_01',
          maxScore: 100,
          answerKey: { reference: 'I went to the station.' },
          gradingRubric: { meaning: 0.6, grammar: 0.4 },
        },
      ],
    };
    const result = await new GradingService(subjective).grade({
      exercise,
      answers: [
        { itemId: 'exercise_subjective_item_01', answer: 'I went station.' },
      ],
    });
    expect(result.score).toBe(75);
    expect(subjective.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: 'I went station.',
        maxScore: 100,
      }),
    );
    expect(subjective.evaluate).not.toHaveBeenCalledWith(
      expect.objectContaining({ totalScore: expect.anything() }),
    );
  });
});
