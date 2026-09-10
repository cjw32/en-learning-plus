import {
  PronunciationTargetResolutionError,
  PronunciationTargetService,
  type PronunciationTargetRepository,
} from './pronunciation-target.service';

const now = new Date('2026-09-10T00:00:00.000Z');

function service(repository: Partial<PronunciationTargetRepository> = {}) {
  return new PronunciationTargetService(
    {
      findWord: jest.fn().mockResolvedValue(null),
      findOwnedCoachExerciseItem: jest.fn().mockResolvedValue(null),
      ...repository,
    },
    () => now,
  );
}

describe('PronunciationTargetService', () => {
  it('resolves manual text without resource ownership claims', async () => {
    const target = await service().resolve({
      subjectId: 'user-1',
      locale: 'en-US',
      target: { sourceType: 'MANUAL', text: 'Hello world.' },
    });
    expect(target).toMatchObject({
      sourceType: 'MANUAL',
      referenceText: 'Hello world.',
      wordId: null,
      courseId: null,
      knowledgeCitationId: null,
      coachRequestId: null,
      sourceRecordType: null,
      sourceRecordId: null,
    });
    await expect(
      service().resolve({
        subjectId: 'user-1',
        locale: 'en-US',
        target: { sourceType: 'MANUAL', text: 'hello', wordId: 'word-1' },
      }),
    ).rejects.toEqual(
      new PronunciationTargetResolutionError('VALIDATION_FAILED'),
    );
  });

  it('uses the authoritative WordBook text and rejects client overrides', async () => {
    const findWord = jest.fn().mockResolvedValue({
      id: 'word-1',
      word: 'Authoritative',
      updatedAt: now,
    });
    const targetService = service({ findWord });
    await expect(
      targetService.resolve({
        subjectId: 'user-1',
        locale: 'en-GB',
        target: { sourceType: 'WORD_BOOK', wordId: 'word-1', text: 'override' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const target = await targetService.resolve({
      subjectId: 'user-1',
      locale: 'en-GB',
      target: { sourceType: 'WORD_BOOK', wordId: 'word-1' },
    });
    expect(target.referenceText).toBe('Authoritative');
    expect(target.wordId).toBe('word-1');
    expect(findWord).toHaveBeenCalledWith('word-1');
  });

  it('requires an owned, live, platform Coach exercise item', async () => {
    const findOwnedCoachExerciseItem = jest
      .fn()
      .mockImplementation(async ({ subjectId }) =>
        subjectId === 'user-1'
          ? {
              prompt: 'Speak clearly.',
              schemaVersion: 'coach-exercise.v1',
              updatedAt: now,
              expiresAt: new Date('2026-09-11T00:00:00Z'),
            }
          : null,
      );
    const targetService = service({ findOwnedCoachExerciseItem });
    const target = await targetService.resolve({
      subjectId: 'user-1',
      locale: 'en-US',
      target: {
        sourceType: 'COACH_EXERCISE',
        coachRequestId: 'request-1',
        exerciseId: 'exercise-1',
        itemId: 'item-1',
      },
    });
    expect(target).toMatchObject({
      referenceText: 'Speak clearly.',
      coachRequestId: 'request-1',
      exerciseId: 'exercise-1',
      itemId: 'item-1',
      sourceRecordType: 'COACH_EXERCISE_ITEM',
    });
    await expect(
      targetService.resolve({
        subjectId: 'other-user',
        locale: 'en-US',
        target: {
          sourceType: 'COACH_EXERCISE',
          coachRequestId: 'request-1',
          exerciseId: 'exercise-1',
          itemId: 'item-1',
        },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('does not silently enable Course or RAG sources', async () => {
    for (const target of [
      { sourceType: 'COURSE_WORD', courseId: 'course-1', wordId: 'word-1' },
      {
        sourceType: 'RAG_CITATION',
        citationId: 'citation-1',
        selection: { start: 0, end: 5 },
      },
    ]) {
      await expect(
        service().resolve({
          subjectId: 'user-1',
          locale: 'en-US',
          target,
        }),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    }
  });
});
