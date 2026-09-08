import type { ErrorType } from '@en/common/coach';

export type DeterministicGrade = {
  isCorrect: boolean;
  score: number;
  correction: string;
  explanation: string;
  errorTypes: ErrorType[];
  examples: string[];
};

function normalized(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[.!?,;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

export function gradeObjectiveAnswer(input: {
  answer: string | string[];
  accepted: string[];
  maxScore: number;
  exerciseType: 'MULTIPLE_CHOICE' | 'FILL_BLANK';
}): DeterministicGrade {
  const submitted = Array.isArray(input.answer)
    ? input.answer.map(normalized).sort().join('\u0000')
    : normalized(input.answer);
  const accepted = input.accepted.map(normalized);
  const isCorrect = accepted.includes(submitted);
  return {
    isCorrect,
    score: isCorrect ? input.maxScore : 0,
    correction: isCorrect ? '' : input.accepted[0],
    explanation: isCorrect
      ? '答案正确。'
      : '答案与该题已验证的可接受形式不一致。',
    errorTypes: isCorrect
      ? []
      : [
          input.exerciseType === 'MULTIPLE_CHOICE'
            ? 'COMPREHENSION'
            : 'VOCABULARY',
        ],
    examples: [],
  };
}

export function qualityFromScore(score: number, maxScore: number): number {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.9) return 5;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.6) return 3;
  if (ratio >= 0.4) return 2;
  if (ratio > 0) return 1;
  return 0;
}
