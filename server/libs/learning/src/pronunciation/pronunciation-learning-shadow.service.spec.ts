import {
  PronunciationLearningShadowService,
  type PronunciationLearningStateReader,
  type PronunciationLearningTraceSink,
} from './pronunciation-learning-shadow.service';

describe('PronunciationLearningShadowService', () => {
  it('projects SM2 changes without mutating persisted item state', async () => {
    const persisted = {
      'word-1': {
        subjectId: 'user-a',
        targetType: 'PRONUNCIATION_WORD' as const,
        targetKey: 'word-1',
        wordId: 'word-1',
        reviewState: 'NEW' as const,
        repetitionCount: 0,
        easeFactor: 2.5,
        intervalDays: 0,
        dueAt: undefined,
      },
    };
    const before = JSON.stringify(persisted);
    const reader: PronunciationLearningStateReader = {
      findItemState: jest.fn(async (_subjectId, targetKey) =>
        structuredClone(persisted[targetKey as keyof typeof persisted] ?? null),
      ),
    };
    const trace: jest.Mocked<PronunciationLearningTraceSink> = {
      recordProjection: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PronunciationLearningShadowService(reader, trace);
    await expect(
      service.project({
        subjectId: 'user-a',
        timezone: 'Asia/Shanghai',
        reviewedAt: new Date('2026-09-10T08:00:00.000Z'),
        evidence: [
          {
            targetType: 'PRONUNCIATION_WORD',
            targetKey: 'word-1',
            wordId: 'word-1',
            targetPosition: 0,
            word: 'hello',
            quality: 5,
            policyVersion: 'pronunciation-quality.v1',
          },
        ],
      }),
    ).resolves.toEqual({
      status: 'PROPOSED',
      changedItems: [
        {
          targetPosition: 0,
          word: 'hello',
          previousReviewState: 'NEW',
          nextReviewState: 'REVIEW',
          nextReviewAt: '2026-09-10T16:00:00.000Z',
        },
      ],
      message: '学习进度尚未写入，这是按当前规则计算的预览。',
    });
    expect(JSON.stringify(persisted)).toBe(before);
    expect(trace.recordProjection).toHaveBeenCalledWith({
      evidenceCount: 1,
      changedItemCount: 1,
      learningMappingVersion: 'pronunciation-quality.v1',
      schedulerVersion: 'SM2_V1',
    });
    expect(JSON.stringify(trace.recordProjection.mock.calls)).not.toContain(
      'user-a',
    );
    expect(JSON.stringify(trace.recordProjection.mock.calls)).not.toContain(
      'hello',
    );
  });
});
