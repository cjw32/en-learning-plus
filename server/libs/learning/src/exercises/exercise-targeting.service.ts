import { Injectable } from '@nestjs/common';

const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
type Difficulty = (typeof levels)[number] | 'UNKNOWN';

export type SelectedExerciseTarget = {
  targetType: 'WORD' | 'ERROR_TYPE';
  targetKey: string;
  label: string;
  wordId?: string;
};

@Injectable()
export class ExerciseTargetingService {
  select(input: {
    profile: {
      level: { cefr: (typeof levels)[number]; source?: string } | null;
      weakItems: Array<{
        targetType: 'WORD' | 'ERROR_TYPE';
        targetKey: string;
        label: string;
        reviewState: string;
        lastQuality: number | null;
        dueAt: Date | null;
      }>;
      recentPerformance: {
        attemptCount: number;
        averageScore: number | null;
      };
    };
    dueWords: Array<{ wordId: string; word: string; priority: number }>;
    limit: number;
  }): {
    difficulty: Difficulty;
    targets: SelectedExerciseTarget[];
    challengeNotice: string | null;
    personalizationReason: string;
  } {
    const baseLevel = input.profile.level?.cefr ?? null;
    const shouldChallenge =
      baseLevel !== null &&
      input.profile.recentPerformance.attemptCount >= 3 &&
      (input.profile.recentPerformance.averageScore ?? 0) >= 85;
    const levelIndex = baseLevel ? levels.indexOf(baseLevel) : -1;
    const difficulty: Difficulty =
      shouldChallenge && levelIndex >= 0 && levelIndex < levels.length - 1
        ? levels[levelIndex + 1]
        : (baseLevel ?? 'UNKNOWN');
    const challengeNotice =
      difficulty !== 'UNKNOWN' && difficulty !== baseLevel
        ? `一级挑战：根据最近表现从 ${baseLevel} 提升到 ${difficulty}。`
        : null;

    const due = [...input.dueWords]
      .sort((left, right) =>
        left.priority === right.priority
          ? left.wordId.localeCompare(right.wordId)
          : left.priority - right.priority,
      )
      .map((word) => ({
        targetType: 'WORD' as const,
        targetKey: word.wordId,
        label: word.word,
        wordId: word.wordId,
      }));
    const weak = [...input.profile.weakItems]
      .sort((left, right) => {
        const quality = (left.lastQuality ?? 6) - (right.lastQuality ?? 6);
        if (quality !== 0) return quality;
        const dueAt =
          (left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
        return dueAt || left.targetKey.localeCompare(right.targetKey);
      })
      .map((item) => ({
        targetType: item.targetType,
        targetKey: item.targetKey,
        label: item.label,
        ...(item.targetType === 'WORD' ? { wordId: item.targetKey } : {}),
      }));
    const unique = new Map<string, SelectedExerciseTarget>();
    for (const target of [...due, ...weak]) {
      unique.set(`${target.targetType}:${target.targetKey}`, target);
      if (unique.size >= input.limit) break;
    }
    const targets = [...unique.values()];
    const personalizationReason = !baseLevel
      ? '尚未设置英语水平；本次仅按到期词和薄弱项生成受限难度练习。'
      : (challengeNotice ??
        `按 ${baseLevel} 水平练习 ${targets.map((target) => target.label).join('、') || '当前学习目标'}。`);
    return { difficulty, targets, challengeNotice, personalizationReason };
  }
}
