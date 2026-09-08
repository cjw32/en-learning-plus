import { createCoachExecutionContext } from '@libs/shared';
import { CreateExerciseTool } from '../../src/coach/tools/create-exercise.tool';

const context = createCoachExecutionContext(
  { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
  1_788_307_200,
);

const citation = {
  sourceId: 'word:word-1',
  materialType: 'word' as const,
  title: 'went',
  locator: 'dictionary/word-1',
  supports: 'past tense',
  accessScope: 'PUBLIC' as const,
};

const scope = {
  requestId: 'request_exercise_01',
  conversationId: 'conversation-a',
  targets: [
    {
      targetType: 'WORD' as const,
      targetKey: 'word-1',
      label: 'went',
      wordId: 'word-1',
    },
  ],
  materials: [{ citation, summary: 'past tense of go' }],
  personalizationReason: 'Practice a due word.',
};

const input = {
  schemaVersion: 'coach.tool.v1',
  types: ['FILL_BLANK'],
  count: 1,
  difficulty: 'A2',
  targetRefs: [{ targetType: 'WORD', targetKey: 'word-1' }],
  materialSourceIds: ['word:word-1'],
  idempotencyKey: 'exercise-key-0001',
} as const;

describe('CreateExerciseTool', () => {
  it('retries invalid structured generation once before controlled persistence', async () => {
    const generateDefinition = jest
      .fn()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        type: 'FILL_BLANK',
        difficulty: 'A2',
        instructions: 'Fill the blank.',
        personalizationReason: 'Practice a due word.',
        items: [
          {
            prompt: 'Yesterday I ___ home.',
            choices: null,
            answerKey: { accepted: ['went'] },
            gradingRubric: { exact: true },
            maxScore: 100,
            citations: [citation],
            targets: [
              {
                targetType: 'WORD',
                targetKey: 'word-1',
                wordId: 'word-1',
                weight: 1,
              },
            ],
          },
        ],
      });
    const exercises = {
      createReady: jest.fn(async () => ({
        schemaVersion: 'coach.tool.v1',
        ok: true,
        exerciseId: 'exercise_00001',
        type: 'FILL_BLANK',
        difficulty: 'A2',
        instructions: 'Fill the blank.',
        personalizationReason: 'Practice a due word.',
        items: [
          {
            itemId: 'exercise_item_00001',
            position: 1,
            prompt: 'Yesterday I ___ home.',
            choices: null,
            maxScore: 100,
            citations: [citation],
          },
        ],
        citations: [citation],
        expiresAt: '2026-09-03T00:00:00.000Z',
      })),
    };
    const budget = { assertCanGenerate: jest.fn() };
    const tool = new CreateExerciseTool(
      exercises as never,
      { generateDefinition } as never,
      budget,
    );

    const result = await tool.execute(context, scope, input);
    expect(result).toMatchObject({ ok: true, exerciseId: 'exercise_00001' });
    expect(generateDefinition).toHaveBeenCalledTimes(2);
    expect(budget.assertCanGenerate).toHaveBeenCalledTimes(2);
    expect(exercises.createReady).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 'user-a' }),
    );
  });

  it('does not call the model or persist when reliable materials are missing', async () => {
    const generator = { generateDefinition: jest.fn() };
    const exercises = { createReady: jest.fn() };
    const tool = new CreateExerciseTool(
      exercises as never,
      generator as never,
      { assertCanGenerate: jest.fn() },
    );
    const result = await tool.execute(
      context,
      { ...scope, materials: [] },
      input,
    );
    expect(result).toMatchObject({ ok: false, code: 'DATA_NOT_AVAILABLE' });
    expect(generator.generateDefinition).not.toHaveBeenCalled();
    expect(exercises.createReady).not.toHaveBeenCalled();
  });
});
