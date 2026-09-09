import {
  LegacyLearningStateBackfillRepository,
  runLegacyLearningStateBackfill,
} from './legacy-learning-state.backfill';

const rolloutAt = new Date('2026-09-02T00:00:00.000Z');

function createRepository(): LegacyLearningStateBackfillRepository & {
  states: Map<string, Record<string, unknown>>;
  writeCount: number;
} {
  const states = new Map<string, Record<string, unknown>>();
  return {
    states,
    writeCount: 0,
    async listLegacyUsers() {
      return [
        { id: 'user-a', wordNumber: 1 },
        { id: 'user-b', wordNumber: 0 },
      ];
    },
    async listLegacyWordRecords() {
      return [
        {
          userId: 'user-a',
          wordId: 'word-a',
          isMaster: true,
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
        {
          userId: 'user-a',
          wordId: 'word-b',
          isMaster: false,
          updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        },
      ];
    },
    async listWordStates() {
      return [...states.values()] as never[];
    },
    async upsertMasteredWordState(state) {
      this.writeCount += 1;
      states.set(`${state.userId}:${state.wordId}`, { ...state });
    },
  };
}

describe('legacy learning-state backfill', () => {
  it('is repeatable and preserves legacy mastery and user counts', async () => {
    const repository = createRepository();
    const legacySnapshot = {
      records: await repository.listLegacyWordRecords(),
      users: await repository.listLegacyUsers(),
    };

    const first = await runLegacyLearningStateBackfill(repository, { rolloutAt });
    const stateSnapshot = [...repository.states.values()];
    const second = await runLegacyLearningStateBackfill(repository, { rolloutAt });

    expect(first).toEqual(second);
    expect([...repository.states.values()]).toEqual(stateSnapshot);
    expect(repository.states.size).toBe(1);
    expect(stateSnapshot[0]).toMatchObject({
      userId: 'user-a',
      wordId: 'word-a',
      reviewState: 'REVIEW',
      dueAt: rolloutAt,
      lastReviewedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(await repository.listLegacyWordRecords()).toEqual(
      legacySnapshot.records,
    );
    expect(await repository.listLegacyUsers()).toEqual(legacySnapshot.users);
  });

  it('performs no writes in audit-only mode', async () => {
    const repository = createRepository();
    await runLegacyLearningStateBackfill(repository, {
      rolloutAt,
      auditOnly: true,
    });
    expect(repository.writeCount).toBe(0);
    expect(repository.states.size).toBe(0);
  });
});
