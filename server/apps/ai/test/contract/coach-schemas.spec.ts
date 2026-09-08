import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  coachMessageRequestSchema,
  coachExerciseSubmissionRequestSchema,
  coachResultJsonSchema,
  coachResultSchema,
  coachSseEventSchema,
  coachToolContractsJsonSchema,
  coachToolSchemas,
} from '@en/common/coach';

const featureContracts = resolve(
  __dirname,
  '../../../../../specs/001-personalized-learning-coach/contracts',
);

const resultArtifact = JSON.parse(
  readFileSync(resolve(featureContracts, 'coach-result.schema.json'), 'utf8'),
) as Record<string, unknown>;
const toolsArtifact = JSON.parse(
  readFileSync(resolve(featureContracts, 'coach-tools.schema.json'), 'utf8'),
) as Record<string, unknown>;

const baseResult = {
  schemaVersion: 'coach.result.v1',
  responseType: 'answer',
  correction: '',
  explanation: 'A level-appropriate explanation.',
  examples: ['A safe example.'],
  errorTypes: [],
  score: null,
  nextAction: 'continue',
  citations: [],
  nextActionReason: 'Continue when ready.',
  traceId: 'trace_contract_01',
} as const;

const validToolInputs = {
  get_learner_profile: {
    schemaVersion: 'coach.tool.v1',
    dimensions: ['LEVEL'],
    perDimensionLimit: 10,
  },
  get_due_words: {
    schemaVersion: 'coach.tool.v1',
    learningDate: '2026-09-02',
    timezone: 'Asia/Shanghai',
    limit: 20,
  },
  search_learning_materials: {
    schemaVersion: 'coach.tool.v1',
    query: 'past tense',
    materialTypes: ['word'],
    cefrLevel: 'A2',
    limit: 5,
  },
  create_exercise: {
    schemaVersion: 'coach.tool.v1',
    types: ['FILL_BLANK'],
    count: 3,
    difficulty: 'A2',
    targetRefs: [{ targetType: 'WORD', targetKey: 'word_000001' }],
    materialSourceIds: ['word_000001'],
    idempotencyKey: 'exercise-key-0001',
  },
  grade_answer: {
    schemaVersion: 'coach.tool.v1',
    exerciseId: 'exercise_000001',
    answers: [{ itemId: 'item_1', answer: 'went' }],
    idempotencyKey: 'grading-key-00001',
  },
  save_attempt: {
    schemaVersion: 'coach.tool.v1',
    submissionId: 'submission_0001',
    gradingHash: 'a'.repeat(64),
    idempotencyKey: 'save-key-0000001',
  },
} as const;

describe('Coach contracts', () => {
  it('keeps Zod JSON Schema constraints equivalent to committed artifacts', () => {
    const generatedResult = coachResultJsonSchema as any;
    const plannedResult = resultArtifact as any;
    expect(generatedResult.additionalProperties).toBe(false);
    expect(generatedResult.required).toEqual(plannedResult.required);
    expect(generatedResult.properties.schemaVersion.const).toBe(
      plannedResult.properties.schemaVersion.const,
    );
    expect(generatedResult.properties.responseType.enum).toEqual(
      plannedResult.properties.responseType.enum,
    );

    const generatedTools = coachToolContractsJsonSchema as any;
    const plannedTools = toolsArtifact as any;
    expect(Object.keys(generatedTools.properties).sort()).toEqual(
      Object.keys(plannedTools.properties).sort(),
    );
    for (const toolName of Object.keys(generatedTools.properties)) {
      const generatedInput =
        generatedTools.properties[toolName].properties.input;
      const plannedInputNode =
        plannedTools.properties[toolName].properties.input;
      const inputRef = plannedInputNode.$ref as string | undefined;
      const plannedInput = inputRef
        ? plannedTools.$defs[inputRef.slice(inputRef.lastIndexOf('/') + 1)]
        : plannedInputNode;
      expect(generatedInput.additionalProperties).toBe(false);
      expect(generatedInput.required).toEqual(plannedInput.required);
    }
  });

  it('rejects unknown API, event, result, and tool-input fields', () => {
    expect(
      coachMessageRequestSchema.safeParse({
        type: 'MESSAGE',
        message: 'Explain go versus went.',
        userId: 'another-user',
      }).success,
    ).toBe(false);

    expect(
      coachSseEventSchema.safeParse({
        schemaVersion: 'coach.sse.v1',
        eventId: 'evt_000001',
        requestId: 'request_00001',
        sequence: 0,
        timestamp: '2026-09-02T00:00:00.000Z',
        type: 'connected',
        payload: { status: 'QUEUED', replayedThrough: null },
        prompt: 'secret',
      }).success,
    ).toBe(false);

    expect(
      coachResultSchema.safeParse({ ...baseResult, rawReasoning: 'hidden' })
        .success,
    ).toBe(false);

    for (const [toolName, input] of Object.entries(validToolInputs)) {
      const schema =
        coachToolSchemas[toolName as keyof typeof coachToolSchemas].input;
      expect(schema.safeParse(input).success).toBe(true);
      expect(
        schema.safeParse({ ...input, userId: 'another-user' }).success,
      ).toBe(false);
    }
  });

  it('enforces result conditions for answer, exercise, and grading scenes', () => {
    expect(coachResultSchema.safeParse(baseResult).success).toBe(true);
    expect(
      coachResultSchema.safeParse({
        ...baseResult,
        responseType: 'answer',
        score: 88,
      }).success,
    ).toBe(false);
    expect(
      coachResultSchema.safeParse({
        ...baseResult,
        responseType: 'exercise',
        nextAction: 'practice',
      }).success,
    ).toBe(false);
    expect(
      coachResultSchema.safeParse({
        ...baseResult,
        responseType: 'grading',
        score: 80,
      }).success,
    ).toBe(false);
  });

  it('contains no public or tool input identity authority', () => {
    const serialized = JSON.stringify({
      result: coachResultJsonSchema,
      tools: coachToolContractsJsonSchema,
    });
    expect(serialized).not.toContain('userId');
  });

  it('validates the answer-submission request union without identity fields', () => {
    const input = {
      type: 'EXERCISE_SUBMISSION',
      exerciseId: 'exercise_00001',
      answers: [{ itemId: 'exercise_item_00001', answer: 'went' }],
    };
    expect(coachExerciseSubmissionRequestSchema.safeParse(input).success).toBe(
      true,
    );
    expect(
      coachExerciseSubmissionRequestSchema.safeParse({
        ...input,
        userId: 'user-b',
      }).success,
    ).toBe(false);
  });
});
