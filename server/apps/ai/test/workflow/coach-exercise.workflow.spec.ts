import { coachResultSchema } from '@en/common/coach';
import { createCoachExecutionContext } from '@libs/shared';
import {
  CoachExerciseWorkflow,
  type CoachExerciseWorkflowDependencies,
} from '../../src/coach/workflow/coach.graph';

const context = createCoachExecutionContext(
  { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
  1_788_307_200,
);

function fixture(overrides: Partial<CoachExerciseWorkflowDependencies> = {}) {
  const order: string[] = [];
  const dependencies: CoachExerciseWorkflowDependencies = {
    async classifyIntent() {
      order.push('classify_intent');
      return 'CREATE_EXERCISE';
    },
    async getLearnerProfile() {
      order.push('get_learner_profile');
      return { level: { cefr: 'A2' }, weakItems: [] };
    },
    async getDueWords() {
      order.push('get_due_words');
      return { words: [{ wordId: 'word-1', word: 'went', priority: 1 }] };
    },
    async searchLearningMaterials() {
      order.push('search_learning_materials');
      return {
        ok: true as const,
        materials: [
          {
            citation: {
              sourceId: 'word:word-1',
              materialType: 'word' as const,
              title: 'went',
              locator: 'dictionary/word-1',
              supports: 'past tense',
              accessScope: 'PUBLIC' as const,
            },
            summary: 'past tense',
          },
        ],
      };
    },
    async createExercise() {
      order.push('create_exercise');
      return {
        schemaVersion: 'coach.tool.v1' as const,
        ok: true as const,
        exerciseId: 'exercise_00001',
        type: 'FILL_BLANK' as const,
        difficulty: 'A2' as const,
        instructions: 'Fill the blank.',
        personalizationReason: 'Practice your due word.',
        items: [
          {
            itemId: 'exercise_item_00001',
            position: 1,
            prompt: 'Yesterday I ___ home.',
            choices: null,
            maxScore: 100,
            citations: [],
          },
        ],
        citations: [],
        expiresAt: '2026-09-03T00:00:00.000Z',
      };
    },
    async recommend() {
      order.push('recommend');
      return { nextAction: 'practice' as const, nextActionReason: 'Start now.' };
    },
    authorizeTool(tool) {
      order.push(`budget:${tool}`);
    },
    async gradeAnswer() {
      throw new Error('grade forbidden');
    },
    async saveAttempt() {
      throw new Error('save forbidden');
    },
    ...overrides,
  };
  return { order, dependencies };
}

describe('Coach CREATE_EXERCISE workflow', () => {
  it('runs the explicit personalized path within tool budget and never grades/saves', async () => {
    const test = fixture();
    const result = await new CoachExerciseWorkflow(test.dependencies).run(
      {
        requestId: 'request_exercise_01',
        conversationId: 'conversation-a',
        message: 'Give me a review exercise.',
        traceId: 'trace_exercise_01',
        preferences: { types: ['FILL_BLANK'], count: 1 },
        includeDueWords: true,
      },
      context,
    );
    expect(coachResultSchema.safeParse(result).success).toBe(true);
    expect(result.responseType).toBe('exercise');
    expect(test.order).toEqual([
      'classify_intent',
      'budget:get_learner_profile',
      'get_learner_profile',
      'budget:get_due_words',
      'get_due_words',
      'budget:search_learning_materials',
      'search_learning_materials',
      'budget:create_exercise',
      'create_exercise',
      'recommend',
    ]);
  });

  it('does not create a submittable exercise when materials fail', async () => {
    const createExercise = jest.fn();
    const test = fixture({
      async searchLearningMaterials() {
        test.order.push('search_learning_materials');
        return { ok: false as const, code: 'DATA_NOT_AVAILABLE' };
      },
      createExercise,
    });
    const result = await new CoachExerciseWorkflow(test.dependencies).run(
      {
        requestId: 'request_exercise_02',
        conversationId: 'conversation-a',
        message: 'Give me an exercise.',
        traceId: 'trace_exercise_02',
        preferences: { types: ['TRANSLATION'], count: 2 },
        includeDueWords: false,
      },
      context,
    );
    expect(result.responseType).toBe('degraded');
    expect(result.exercise).toBeUndefined();
    expect(createExercise).not.toHaveBeenCalled();
  });
});

