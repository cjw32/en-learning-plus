import { createHash } from 'node:crypto';
import { KnowledgeDomainError } from '../domain/knowledge.types';

export type WrongAnswerProjectionInput = Readonly<{
  subjectId: string;
  attemptId: string;
  submissionStatus: string;
  gradingValidated: boolean;
  targetType: 'WORD' | 'ERROR_TYPE';
  targetKey: string;
  prompt: string;
  learnerAnswer: string;
  correction: string;
  explanation: string;
  errorTypes: readonly string[];
  savedAt: Date;
  answerKey?: unknown;
  gradingRubric?: unknown;
  conversation?: unknown;
  traceId?: unknown;
}>;

const piiPattern =
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|(?:\+?\d[\d\s()-]{8,}\d)/;

function normalized(value: string): string {
  return value.normalize('NFKC').trim();
}

export class WrongAnswerProjector {
  project(input: WrongAnswerProjectionInput) {
    if (input.submissionStatus !== 'SAVED' || !input.gradingValidated) {
      throw new KnowledgeDomainError(
        'CONTENT_STRUCTURE_INVALID',
        'Only saved attempts with validated grading may be projected',
      );
    }
    const fields = {
      targetKey: normalized(input.targetKey),
      learnerAnswer: normalized(input.learnerAnswer),
      correction: normalized(input.correction),
      explanation: normalized(input.explanation),
      errorTypes: [...input.errorTypes].map(normalized).filter(Boolean).sort(),
    };
    const serializedFacts = JSON.stringify(fields);
    if (piiPattern.test(serializedFacts)) {
      throw new KnowledgeDomainError(
        'CONTENT_PII_REJECTED',
        'Wrong-answer projection contains contact information',
      );
    }
    if (!fields.targetKey || !fields.correction || !fields.explanation) {
      throw new KnowledgeDomainError(
        'CONTENT_EMPTY',
        'Wrong-answer projection is missing required saved facts',
      );
    }
    const factHash = createHash('sha256').update(serializedFacts).digest('hex');
    return Object.freeze({
      source: 'verified-wrong-answer',
      sourceId: `attempt:${input.attemptId}:wrong-answer`,
      sourceRecordType: 'LearningAttempt' as const,
      sourceRecordId: input.attemptId,
      title: `${input.targetType}: ${fields.targetKey}`,
      category: 'USER_ERROR' as const,
      accessScope: 'PRIVATE_OWNER' as const,
      visibility: 'private' as const,
      ownerUserId: input.subjectId,
      sourceUpdatedAt: input.savedAt,
      contentVersion: `wrong-answer.sha256.${factHash}`,
      facts: Object.freeze(fields),
      content: [
        `Target: ${fields.targetKey}`,
        `Learner answer: ${fields.learnerAnswer}`,
        `Correction: ${fields.correction}`,
        `Explanation: ${fields.explanation}`,
        `Error types: ${fields.errorTypes.join(', ') || 'none'}`,
      ].join('\n'),
    });
  }
}
