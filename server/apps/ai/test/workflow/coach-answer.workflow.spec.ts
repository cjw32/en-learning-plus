import { coachResultSchema } from '@en/common/coach';
import { createCoachExecutionContext } from '@libs/shared';
import {
  CoachAnswerWorkflow,
  CoachAnswerWorkflowDependencies,
} from '../../src/coach/workflow/coach.graph';

const executionContext = createCoachExecutionContext(
  { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
  1_788_307_200,
);

function dependencies(
  overrides: Partial<CoachAnswerWorkflowDependencies> = {},
) {
  const order: string[] = [];
  const defaults: CoachAnswerWorkflowDependencies = {
    async classifyIntent() {
      order.push('classify_intent');
      return 'ANSWER';
    },
    async getLearnerProfile() {
      order.push('get_learner_profile');
      return {
        level: { cefr: 'A2', source: 'USER_DECLARED' },
        goal: { type: 'TRAVEL', text: null },
        signals: [{ dimension: 'LEVEL', status: 'AVAILABLE' }],
      };
    },
    async searchLearningMaterials() {
      order.push('search_learning_materials');
      return {
        materials: [
          {
            citation: {
              sourceId: 'word:went',
              materialType: 'word',
              title: 'went',
              locator: 'dictionary/went',
              supports: 'past tense of go',
              accessScope: 'PUBLIC',
            },
            summary: 'went is the past tense of go',
          },
        ],
        unavailableTypes: [],
      };
    },
    async generateAnswer() {
      order.push('generate_answer');
      return {
        correction: '',
        explanation: 'Went is the past tense of go.',
        examples: ['I went home yesterday.'],
        errorTypes: [],
        citations: [
          {
            sourceId: 'word:went',
            materialType: 'word',
            title: 'went',
            locator: 'dictionary/went',
            supports: 'past tense of go',
          },
        ],
      };
    },
    async recommend() {
      order.push('recommend');
      return {
        nextAction: 'continue',
        nextActionReason: 'Try another example.',
      };
    },
    async gradeAnswer() {
      order.push('grade_answer');
      throw new Error('grade must not run');
    },
    async saveAttempt() {
      order.push('save_attempt');
      throw new Error('save must not run');
    },
    onValidate() {
      order.push('validate');
    },
    ...overrides,
  };
  return { order, values: defaults };
}

describe('Coach ANSWER/CORRECTION workflow', () => {
  it('runs the explicit ANSWER path without grade or save', async () => {
    const fixture = dependencies();
    const result = await new CoachAnswerWorkflow(fixture.values).run(
      {
        requestId: 'request_00001',
        conversationId: 'conversation-a',
        message: 'What is the difference between go and went?',
        traceId: 'trace_answer_001',
      },
      executionContext,
    );
    expect(coachResultSchema.safeParse(result).success).toBe(true);
    expect(result.responseType).toBe('answer');
    expect(fixture.order).toEqual([
      'classify_intent',
      'get_learner_profile',
      'search_learning_materials',
      'generate_answer',
      'recommend',
      'validate',
    ]);
  });

  it('uses the CORRECTION path and returns structured correction fields', async () => {
    const fixture = dependencies({
      async classifyIntent() {
        fixture.order.push('classify_intent');
        return 'CORRECTION';
      },
      async generateAnswer() {
        fixture.order.push('generate_answer');
        return {
          correction: 'I went home yesterday.',
          explanation: 'Use the past tense went with yesterday.',
          examples: ['She went to school.'],
          errorTypes: ['TENSE'],
          citations: [],
        };
      },
    });
    const result = await new CoachAnswerWorkflow(fixture.values).run(
      {
        requestId: 'request_00002',
        conversationId: 'conversation-a',
        message: 'Correct: I go home yesterday.',
        traceId: 'trace_correct_01',
      },
      executionContext,
    );
    expect(result).toMatchObject({
      responseType: 'correction',
      correction: 'I went home yesterday.',
      errorTypes: ['TENSE'],
      score: null,
    });
    expect(fixture.order).not.toContain('grade_answer');
    expect(fixture.order).not.toContain('save_attempt');
  });

  it('retries invalid structured model output exactly once', async () => {
    const generateAnswer = jest
      .fn()
      .mockResolvedValueOnce({ correction: '', explanation: '' })
      .mockResolvedValueOnce({
        correction: '',
        explanation: 'Valid on retry.',
        examples: [],
        errorTypes: [],
        citations: [],
        unknownDebug: 'removed',
      });
    const fixture = dependencies({ generateAnswer });
    const result = await new CoachAnswerWorkflow(fixture.values).run(
      {
        requestId: 'request_00003',
        conversationId: 'conversation-a',
        message: 'Explain went.',
        traceId: 'trace_retry_0001',
      },
      executionContext,
    );
    expect(generateAnswer).toHaveBeenCalledTimes(2);
    expect(result.explanation).toBe('Valid on retry.');
    expect(result).not.toHaveProperty('unknownDebug');
  });

  it('rejects unsupported citations and returns a valid degraded result', async () => {
    const fixture = dependencies({
      async generateAnswer() {
        return {
          correction: '',
          explanation: 'Unsupported claim.',
          examples: [],
          errorTypes: [],
          citations: [
            {
              sourceId: 'course:foreign',
              materialType: 'course',
              title: 'Foreign',
              locator: null,
              supports: 'forged',
            },
          ],
        };
      },
    });
    const result = await new CoachAnswerWorkflow(fixture.values).run(
      {
        requestId: 'request_00004',
        conversationId: 'conversation-a',
        message: 'Explain this.',
        traceId: 'trace_cite_0001',
      },
      executionContext,
    );
    expect(result.responseType).toBe('degraded');
    expect(result.citations).toEqual([]);
    expect(coachResultSchema.safeParse(result).success).toBe(true);
  });

  it('uses a deterministic valid fallback after model failure', async () => {
    const fixture = dependencies({
      async generateAnswer() {
        throw new Error('provider secret must not escape');
      },
    });
    const result = await new CoachAnswerWorkflow(fixture.values).run(
      {
        requestId: 'request_00005',
        conversationId: 'conversation-a',
        message: 'Explain this.',
        traceId: 'trace_fallback01',
      },
      executionContext,
    );
    expect(result.responseType).toBe('degraded');
    expect(JSON.stringify(result)).not.toContain('provider secret');
    expect(coachResultSchema.safeParse(result).success).toBe(true);
  });
});
