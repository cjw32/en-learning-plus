import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadEvalCases,
  validateDeterministicEvalSuite,
} from './deterministic-assertions';

const evalRoot = resolve(__dirname);

describe('Coach deterministic evaluation dataset', () => {
  const cases = loadEvalCases(resolve(evalRoot, 'fixtures/cases.jsonl'));
  const toolPaths = JSON.parse(
    readFileSync(resolve(evalRoot, 'expected/tool-paths.json'), 'utf8'),
  );
  const securityGates = JSON.parse(
    readFileSync(resolve(evalRoot, 'expected/security-gates.json'), 'utf8'),
  );

  it('contains 50-100 versioned non-production cases with required coverage', () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
    expect(cases.length).toBeLessThanOrEqual(100);
    const summary = validateDeterministicEvalSuite({ cases, toolPaths, securityGates });
    expect(summary.failures).toEqual([]);
    expect(summary.intents).toEqual(
      expect.arrayContaining([
        'ANSWER',
        'CORRECTION',
        'CREATE_EXERCISE',
        'GRADE_ANSWER',
        'REVIEW_RECOMMENDATION',
      ]),
    );
    expect(summary.levels).toEqual(
      expect.arrayContaining(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'MISSING']),
    );
    expect(summary.exerciseTypes).toEqual(
      expect.arrayContaining([
        'MULTIPLE_CHOICE',
        'FILL_BLANK',
        'TRANSLATION',
        'SITUATIONAL_DIALOGUE',
      ]),
    );
    expect(summary.categories).toEqual(
      expect.arrayContaining([
        'correction',
        'cefr_fit',
        'exercise_targeting',
        'tool_selection',
        'tool_parameters',
        'grading',
        'next_action',
        'schema',
        'citation',
        'security',
        'failure',
        'performance',
      ]),
    );
    expect(summary.personalizationPairCount).toBeGreaterThanOrEqual(3);
  });

  it('defines complete deterministic expectations for every case', () => {
    for (const item of cases) {
      expect(item.expected).toMatchObject({
        schemaVersion: 'coach.result.v1',
        safety: expect.any(String),
        gradeBeforeSave: expect.any(Boolean),
        idempotent: expect.any(Boolean),
      });
      expect(item.expected.allowedTools).toEqual(expect.any(Array));
      expect(item.expected.forbiddenTools).toEqual(expect.any(Array));
      expect(item.expected.toolOrder).toEqual(expect.any(Array));
      expect(item.measurementFields).toEqual(
        expect.arrayContaining([
          'ttftMs',
          'totalDurationMs',
          'inputTokens',
          'outputTokens',
          'estimatedCostMicros',
        ]),
      );
    }
  });

  it.each([
    'correction.json',
    'cefr-fit.json',
    'exercise-targeting.json',
    'grading.json',
    'next-action.json',
    'citation-support.json',
  ])('has a versioned identity-free rubric %s', (name) => {
    const rubric = JSON.parse(
      readFileSync(resolve(evalRoot, 'rubrics', name), 'utf8'),
    );
    expect(rubric).toMatchObject({
      rubricVersion: expect.any(String),
      scorer: expect.stringMatching(/human|independent_model/),
      passState: expect.any(Object),
      disputeReview: expect.any(Object),
      criteria: expect.any(Array),
    });
    expect(rubric.criteria.length).toBeGreaterThan(0);
    expect(JSON.stringify(rubric)).not.toMatch(/userId|email|phone|production conversation/i);
  });
});
