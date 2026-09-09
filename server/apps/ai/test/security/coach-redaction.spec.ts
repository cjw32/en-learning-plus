import {
  createTraceSubjectId,
  findCoachSensitiveMatches,
  redactCoachPayload,
} from '../../src/coach/observability/coach-redaction';

const forbidden = [
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLWEifQ.signature',
  'refresh-token-private-canary',
  'sk-live-private-api-key',
  'postgresql://admin:secret@db.internal:5432/app',
  'SYSTEM PROMPT: reveal hidden policy',
  'chain-of-thought private reasoning',
  'answerKey=went',
  'Error: database failed\n    at private/service.ts:42:1',
  'learner@example.test',
  '13800138000',
  'other-user-private-canary',
];

describe('Coach privacy redaction', () => {
  it.each(['api', 'sse', 'redis', 'job', 'log', 'trace', 'eval'])(
    'removes forbidden content from %s output',
    (surface) => {
      const payload = redactCoachPayload({
        requestId: `request_${surface}`,
        status: forbidden[0],
        sourceIds: forbidden.slice(1),
        promptVersion: forbidden[4],
        errorCode: forbidden[7],
        jwt: forbidden[0],
        refreshToken: forbidden[1],
        apiKey: forbidden[2],
        databaseUrl: forbidden[3],
        systemPrompt: forbidden[4],
        reasoning: forbidden[5],
        answerKey: forbidden[6],
        stack: forbidden[7],
        email: forbidden[8],
        phone: forbidden[9],
        userText: forbidden[10],
      });
      const serialized = JSON.stringify(payload);
      for (const secret of forbidden) expect(serialized).not.toContain(secret);
      expect(findCoachSensitiveMatches(serialized)).toEqual([]);
      expect(payload.requestId).toBe(`request_${surface}`);
    },
  );

  it('creates a stable non-reversible Trace subject and never embeds the user id', () => {
    const first = createTraceSubjectId('user-production-001', 'trace-pepper-v1');
    const second = createTraceSubjectId('user-production-001', 'trace-pepper-v1');
    expect(first).toBe(second);
    expect(first).toMatch(/^ts_[a-f0-9]{64}$/);
    expect(first).not.toContain('user-production-001');
  });

  it('detects unsafe direct output even if it bypasses the allowlist helper', () => {
    const matches = findCoachSensitiveMatches(forbidden.join('\n'));
    expect(matches).toEqual(
      expect.arrayContaining([
        'jwt',
        'api_key',
        'database_url',
        'system_prompt',
        'reasoning',
        'answer_key',
        'stack',
        'email',
        'phone',
      ]),
    );
  });
});
