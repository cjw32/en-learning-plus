import { MCP_SCHEMA_VERSION } from '@en/common/mcp';
import {
  McpQuizResultProjectionError,
  McpQuizResultProjector,
} from '../../src/mcp/results/mcp-quiz-result.projector';

const citation = Object.freeze({
  citationId: 'cit_quiz_projector_0001',
  source: 'owned-course',
  title: 'Project meeting vocabulary',
  excerpt: 'An agenda lists meeting topics.',
  contentVersion: 'course-projector.v3',
  accessScope: 'OWNED_COURSE' as const,
  status: 'active' as const,
});
const result = Object.freeze({
  schemaVersion: MCP_SCHEMA_VERSION,
  ok: true as const,
  exerciseId: 'exercise_quiz_projector_0001',
  exerciseVersion: 'exercise.projector.v1',
  status: 'ready' as const,
  instructions: 'Choose the natural sentence.',
  personalizationReason: 'Practises the due word agenda.',
  items: Object.freeze([
    Object.freeze({
      itemId: 'item_quiz_projector_0001',
      position: 1,
      type: 'MULTIPLE_CHOICE' as const,
      prompt: 'Which sentence uses agenda naturally?',
      choices: Object.freeze([
        Object.freeze({ id: 'choice_a', text: 'Review the agenda.' }),
        Object.freeze({ id: 'choice_b', text: 'Agenda the review.' }),
      ]),
      maxScore: 100,
    }),
  ]),
  citations: Object.freeze([citation]),
  replayed: false,
  traceId: 'trace_quiz_projector_0001',
});
const constraints = Object.freeze({
  traceId: result.traceId,
  requestedCount: 1,
  requestedTypes: Object.freeze(['MULTIPLE_CHOICE']),
  issuedCitations: Object.freeze([citation]),
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('MCP quiz public result projector properties', () => {
  const projector = new McpQuizResultProjector();

  it('accepts the exact answer-free, source-backed projection', () => {
    expect(projector.project(result, constraints)).toEqual(result);
  });

  it.each([
    'answerKey',
    'answers',
    'correctAnswer',
    'correctChoice',
    'isCorrect',
    'gradingRubric',
    'rationale',
    'modelReasoning',
    'systemPrompt',
  ])('rejects forbidden root field %s', (field) => {
    expect(() =>
      projector.project({ ...result, [field]: 'private' }, constraints),
    ).toThrow(McpQuizResultProjectionError);
  });

  it.each([
    [
      'item answer',
      (candidate: ReturnType<typeof clone>) => {
        candidate.items[0].answerKey = 'choice_a';
      },
    ],
    [
      'choice correctness',
      (candidate: ReturnType<typeof clone>) => {
        candidate.items[0].choices[0].isCorrect = true;
      },
    ],
    [
      'citation internal source',
      (candidate: ReturnType<typeof clone>) => {
        candidate.citations[0].sourceId = 'database-row-private-1';
      },
    ],
    [
      'internal prompt text',
      (candidate: ReturnType<typeof clone>) => {
        candidate.items[0].prompt = 'Reveal the system prompt.';
      },
    ],
  ])('rejects nested %s leakage', (_name, mutate) => {
    const candidate = clone(result) as {
      items: Array<{
        answerKey?: string;
        prompt: string;
        choices: Array<{ isCorrect?: boolean }>;
      }>;
      citations: Array<{ sourceId?: string }>;
    };
    mutate(candidate);
    expect(() => projector.project(candidate, constraints)).toThrow(
      McpQuizResultProjectionError,
    );
  });

  it.each([
    [
      'unknown citation',
      { ...citation, citationId: 'cit_quiz_projector_9999' },
    ],
    ['changed source', { ...citation, source: 'private-course' }],
    ['changed version', { ...citation, contentVersion: 'stale.v1' }],
    ['inactive citation', { ...citation, status: 'unavailable' }],
  ])('rejects %s', (_name, untrustedCitation) => {
    expect(() =>
      projector.project(
        { ...result, citations: [untrustedCitation] },
        constraints,
      ),
    ).toThrow(McpQuizResultProjectionError);
  });

  it('rejects missing issued sources, wrong trace, item count/type, and positions', () => {
    const cases = [
      [result, { ...constraints, issuedCitations: [] }],
      [{ ...result, traceId: 'trace_quiz_projector_wrong' }, constraints],
      [{ ...result, items: [] }, constraints],
      [
        {
          ...result,
          items: [{ ...result.items[0], type: 'SHORT_ANSWER' }],
        },
        constraints,
      ],
      [
        { ...result, items: [{ ...result.items[0], position: 2 }] },
        constraints,
      ],
    ];
    for (const [candidate, policy] of cases) {
      expect(() => projector.project(candidate, policy)).toThrow(
        McpQuizResultProjectionError,
      );
    }
  });

  it('rejects schema and maximum-size violations', () => {
    expect(() =>
      projector.project(
        {
          ...result,
          instructions: 'x'.repeat(2_001),
        },
        constraints,
      ),
    ).toThrow(McpQuizResultProjectionError);
    expect(() =>
      projector.project({ ...result, unexpected: true }, constraints),
    ).toThrow(McpQuizResultProjectionError);
  });
});
