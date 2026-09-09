import {
  createExerciseOutputSchema,
  type CreateExerciseOutput,
} from '@en/common/coach';
import {
  ExerciseService,
  type ExerciseDefinition,
  type ExerciseRepository,
} from '@libs/learning';

const citation = {
  sourceId: 'word:word-1',
  materialType: 'word' as const,
  title: 'went',
  locator: 'dictionary/went',
  supports: 'past tense of go',
  accessScope: 'PUBLIC' as const,
};

function definition(type: ExerciseDefinition['type']): ExerciseDefinition {
  return {
    type,
    difficulty: 'A2',
    instructions: `Complete the ${type} exercise.`,
    personalizationReason: 'Targets your recent tense errors.',
    items: [
      {
        prompt: 'Use went in context.',
        choices:
          type === 'MULTIPLE_CHOICE'
            ? [
                { id: 'a', text: 'go' },
                { id: 'b', text: 'went' },
              ]
            : null,
        answerKey: { accepted: ['went'] },
        gradingRubric: { exact: true },
        maxScore: 100,
        citations: [citation],
        targets: [
          { targetType: 'WORD', targetKey: 'word-1', wordId: 'word-1', weight: 1 },
        ],
      },
    ],
  };
}

class MemoryExerciseRepository implements ExerciseRepository {
  stored: Awaited<ReturnType<ExerciseRepository['createReady']>> | null = null;

  async findReadyByRequest(requestId: string) {
    return this.stored?.requestId === requestId ? this.stored : null;
  }

  async createReady(input: Parameters<ExerciseRepository['createReady']>[0]) {
    this.stored = input;
    return input;
  }
}

describe('Coach exercise contract', () => {
  it.each([
    'MULTIPLE_CHOICE',
    'FILL_BLANK',
    'TRANSLATION',
    'SITUATIONAL_DIALOGUE',
  ] as const)('creates a valid learner-safe %s projection', async (type) => {
    const repository = new MemoryExerciseRepository();
    const service = new ExerciseService(
      repository,
      () => 'exercise_00001',
      () => 'exercise_item_00001',
      () => new Date('2026-09-02T00:00:00.000Z'),
    );
    const output = await service.createReady({
      subjectId: 'user-a',
      conversationId: 'conversation-a',
      requestId: `request_${type}`,
      definition: definition(type),
      allowedTargetRefs: [{ targetType: 'WORD', targetKey: 'word-1' }],
      allowedMaterialSourceIds: ['word:word-1'],
    });

    expect(createExerciseOutputSchema.safeParse(output).success).toBe(true);
    expect(JSON.stringify(output)).not.toMatch(/answerKey|gradingRubric|accepted|exact/);
    expect(repository.stored?.items[0]).toMatchObject({
      answerKey: { accepted: ['went'] },
      gradingRubric: { exact: true },
    });
  });

  it('rejects targets or citations outside the authorized subsets without persistence', async () => {
    const repository = new MemoryExerciseRepository();
    const service = new ExerciseService(repository);
    const forged = definition('TRANSLATION');
    forged.items[0]!.citations = [{ ...citation, sourceId: 'course:foreign' }];

    await expect(
      service.createReady({
        subjectId: 'user-a',
        conversationId: 'conversation-a',
        requestId: 'request_forged_01',
        definition: forged,
        allowedTargetRefs: [{ targetType: 'WORD', targetKey: 'word-1' }],
        allowedMaterialSourceIds: ['word:word-1'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repository.stored).toBeNull();
  });

  it('rejects invalid count and cannot represent a ready exercise without evidence', () => {
    expect(
      createExerciseOutputSchema.safeParse({
        schemaVersion: 'coach.tool.v1',
        ok: true,
        exerciseId: 'exercise_00001',
        type: 'FILL_BLANK',
        difficulty: 'A2',
        instructions: 'Fill the blank.',
        personalizationReason: 'Practice a weak word.',
        items: [],
        citations: [],
        expiresAt: '2026-09-03T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
