import { resolveCoachRuntimeConfig } from '../../src/coach/governance/coach-config.schema';
import {
  CoachModelPolicyRegistry,
  modelPoliciesFromConfig,
} from '../../src/coach/governance/model-policy';
import { CoachPromptRegistry } from '../../src/coach/prompts/coach-prompt.registry';
import { assertCoachNodeCanStart } from '../../src/coach/workflow/coach-guards';
import { coachStateSchema } from '../../src/coach/workflow/coach-state';

const validState = {
  requestId: 'request_00001',
  conversationId: 'conversation-a',
  inputType: 'EXERCISE_SUBMISSION',
  currentNode: 'grade_answer',
  intent: 'GRADE_ANSWER',
  profileLoaded: true,
  dueWordsLoaded: false,
  materialSourceIds: [],
  exerciseId: 'exercise-1',
  submissionId: 'submission-1',
  gradingValidated: false,
  attemptSaved: false,
  schemaRetryCount: 0,
  toolCallCount: 1,
  cancelled: false,
} as const;

describe('Coach controlled execution foundation', () => {
  it('rejects identity, token, and unknown fields from graph state', () => {
    expect(coachStateSchema.safeParse(validState).success).toBe(true);
    for (const field of ['userId', 'subjectId', 'jwt', 'authorization']) {
      expect(
        coachStateSchema.safeParse({ ...validState, [field]: 'injected' })
          .success,
      ).toBe(false);
    }
  });

  it('blocks save before valid grading and blocks all nodes after cancellation', () => {
    expect(() => assertCoachNodeCanStart(validState, 'save_attempt')).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' }),
    );
    expect(() =>
      assertCoachNodeCanStart(
        { ...validState, gradingValidated: true, cancelled: true },
        'save_attempt',
      ),
    ).toThrow(expect.objectContaining({ code: 'STATE_CONFLICT' }));
  });

  it('resolves only known versioned Prompts with deterministic hashes', () => {
    const registry = new CoachPromptRegistry([
      {
        name: 'classify_intent',
        version: 'coach.classify.v1',
        template: 'Classify: {{message}}',
        allowedVariables: ['message'],
      },
    ]);
    expect(registry.resolve('classify_intent', 'coach.classify.v1').hash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(() => registry.resolve('classify_intent', 'unknown')).toThrow();
    expect(() =>
      registry.render('classify_intent', 'coach.classify.v1', {
        message: 'hello',
        userId: 'user-b',
      }),
    ).toThrow();
  });

  it('keeps reasoner disabled and rejects unknown model policy versions', () => {
    const config = resolveCoachRuntimeConfig({
      COACH_ENABLED: 'true',
      COACH_LIVE_MODEL_ENABLED: 'true',
      COACH_WRITE_ENABLED: 'false',
      COACH_MODEL_NAME: 'approved-model',
      COACH_MODEL_VERSION: '2026-09-01',
      COACH_MODEL_PRICE_VERSION: 'price-v1',
      COACH_BUDGET_POLICY_VERSION: 'budget-v1',
      COACH_EVAL_DATASET_VERSION: 'eval-v1',
    });
    const registry = new CoachModelPolicyRegistry(
      modelPoliciesFromConfig(config),
    );
    expect(registry.resolve('price-v1', 'writer').modelVersion).toBe(
      '2026-09-01',
    );
    expect(() => registry.resolve('price-v1', 'reasoner')).toThrow();
    expect(() => registry.resolve('unknown', 'writer')).toThrow();
  });
});
