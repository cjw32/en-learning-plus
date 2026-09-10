import { createCoachExecutionContext } from '@libs/shared';
import { GetPronunciationSummaryTool } from './get-pronunciation-summary.tool';
import { pronunciationSummaryModelContextSchema } from '../workflow/coach-model.gateway';

const context = createCoachExecutionContext(
  { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
  1_788_307_200,
);

const summary = {
  assessmentId: 'assessment_00001',
  assessmentStatus: 'COMPLETED' as const,
  confidenceTier: 'RELIABLE' as const,
  scores: {
    overall: 72,
    accuracy: 68,
    completeness: 80,
    fluency: 75,
    prosody: null,
  },
  weakWords: [
    {
      targetPosition: 1,
      word: 'world',
      status: 'mispronounced' as const,
      score: 52,
    },
  ],
  reviewChanges: [
    {
      targetPosition: 1,
      word: 'world',
      nextReviewState: 'LEARNING' as const,
      nextReviewAt: '2026-09-11T00:00:00.000Z',
    },
  ],
  learningWriteStatus: 'SAVED' as const,
  sourceStatus: 'ACTIVE' as const,
  nextAction: 'review' as const,
  recommendationReason: '本次有 1 个可靠薄弱词，建议先复习再朗读。',
  versions: {
    resultSchema: 'pronunciation-result.v1',
    assessmentRule: 'pronunciation-assessment.v1',
    confidencePolicy: 'pronunciation-confidence.v1',
    learningMapping: 'pronunciation-quality.v1',
    scheduler: 'SM2_V1',
  },
};

describe('GetPronunciationSummaryTool', () => {
  it('binds ownership to the authenticated context and exposes no audio or storage data', async () => {
    const contexts = {
      getOwnedSummary: jest.fn(async () => summary),
    };
    const tool = new GetPronunciationSummaryTool(contexts as never, true);

    const output = await tool.execute(context, {
      schemaVersion: 'coach.tool.v1',
      assessmentId: 'assessment_00001',
    });

    expect(contexts.getOwnedSummary).toHaveBeenCalledWith(
      'user-a',
      'assessment_00001',
    );
    expect(output).toMatchObject({ ok: true, ...summary });
    const serialized = JSON.stringify(output);
    for (const forbidden of [
      'audio',
      'objectKey',
      'bucket',
      'storageUrl',
      'recognizedText',
      'referenceText',
      'user-a',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('uses the same missing shape for another subject and a random id', async () => {
    const contexts = { getOwnedSummary: jest.fn(async () => null) };
    const tool = new GetPronunciationSummaryTool(contexts as never, true);
    const input = {
      schemaVersion: 'coach.tool.v1',
      assessmentId: 'assessment_00002',
    } as const;

    const crossOwner = await tool.execute(context, input);
    const randomMissing = await tool.execute(context, {
      ...input,
      assessmentId: 'assessment_random',
    });

    expect(crossOwner).toEqual(randomMissing);
    expect(crossOwner).toMatchObject({
      ok: false,
      code: 'RESOURCE_NOT_FOUND',
      retryable: false,
    });
  });

  it('rejects subject/audio overrides because the input schema contains only assessmentId', async () => {
    const contexts = { getOwnedSummary: jest.fn(async () => summary) };
    const tool = new GetPronunciationSummaryTool(contexts as never, true);

    const output = await tool.execute(context, {
      schemaVersion: 'coach.tool.v1',
      assessmentId: 'assessment_00001',
      userId: 'user-b',
      includeAudio: true,
    });

    expect(output).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
      retryable: false,
    });
    expect(contexts.getOwnedSummary).not.toHaveBeenCalled();
  });

  it('fails closed when the pronunciation Coach-summary gate is disabled', async () => {
    const contexts = { getOwnedSummary: jest.fn(async () => summary) };
    const tool = new GetPronunciationSummaryTool(contexts as never, false);

    const output = await tool.execute(context, {
      schemaVersion: 'coach.tool.v1',
      assessmentId: 'assessment_00001',
    });

    expect(output).toMatchObject({
      ok: false,
      code: 'DATA_NOT_AVAILABLE',
      retryable: false,
    });
    expect(contexts.getOwnedSummary).not.toHaveBeenCalled();
  });

  it('keeps the model-facing context strict and free of audio/provider payloads', () => {
    expect(pronunciationSummaryModelContextSchema.safeParse(summary).success).toBe(
      true,
    );
    expect(
      pronunciationSummaryModelContextSchema.safeParse({
        ...summary,
        audio: Buffer.from('voice'),
      }).success,
    ).toBe(false);
    expect(
      pronunciationSummaryModelContextSchema.safeParse({
        ...summary,
        providerResponse: { raw: 'not allowed' },
      }).success,
    ).toBe(false);
    const serializedSchema = JSON.stringify(
      pronunciationSummaryModelContextSchema.toJSONSchema(),
    );
    expect(serializedSchema).not.toMatch(
      /audio|objectKey|bucket|providerResponse|recognizedText|referenceText|userId/,
    );
  });
});
