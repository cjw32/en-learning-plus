import {
  createPronunciationTraceSubjectId,
  redactPronunciationPayload,
} from './pronunciation-redaction';

describe('pronunciation redaction', () => {
  it('creates deterministic, feature-scoped pseudonymous subject identifiers', () => {
    const first = createPronunciationTraceSubjectId('real-user-42', 'pepper');
    expect(first).toMatch(/^pts_[a-f0-9]{64}$/);
    expect(first).toBe(
      createPronunciationTraceSubjectId('real-user-42', 'pepper'),
    );
    expect(first).not.toContain('real-user-42');
  });

  it('keeps only bounded technical trace fields', () => {
    expect(
      redactPronunciationPayload({
        assessmentId: 'assessment_1',
        status: 'COMPLETED',
        audioMediaType: 'audio/webm;codecs=opus',
        audioByteSize: 4096,
        confidence: 0.91,
        cancelled: false,
      }),
    ).toEqual({
      assessmentId: 'assessment_1',
      status: 'COMPLETED',
      audioMediaType: 'audio/webm;codecs=opus',
      audioByteSize: 4096,
      confidence: 0.91,
      cancelled: false,
    });
  });

  it('drops secrets, raw text, storage addresses, real subjects and audio bytes', () => {
    const realSubject = 'real-user-42';
    const unsafe = redactPronunciationPayload({
      userId: realSubject,
      subjectId: realSubject,
      targetText: 'The quick brown fox',
      recognizedText: 'raw provider transcript',
      rawProviderResponse: { transcript: 'private' },
      audioBytes: Buffer.from('voice recording'),
      objectKey: 'subjects/real-user-42/audio.webm',
      bucket: 'private-audio',
      storageUrl: 'https://storage.internal/private-audio/object',
      token: 'Bearer secret-token',
      stack: 'Error\n at internal.ts:42:1',
      metadata: { arbitrary: 'object is forbidden' },
      provider: 'https://internal.example/provider',
    });
    const serialized = JSON.stringify(unsafe);

    expect(unsafe).toEqual({});
    for (const forbidden of [
      realSubject,
      'quick brown fox',
      'transcript',
      'voice recording',
      'private-audio',
      'storage.internal',
      'secret-token',
      'internal.ts',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('rejects unpseudonymized trace subjects and malformed scalar values', () => {
    expect(
      redactPronunciationPayload({
        traceSubjectId: 'real-user-42',
        durationMs: -1,
        confidence: Number.NaN,
        status: 'contains raw text',
        assessmentId: '../../object-key',
      }),
    ).toEqual({});
  });
});
