import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(process.cwd(), 'prisma/schema.prisma'),
  'utf8',
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`Missing Prisma model ${name}`);
  return match[1];
}

describe('pronunciation learning schema contract', () => {
  it('uses one discriminated LearningAttempt authority', () => {
    const attempt = model('LearningAttempt');

    expect(schema).toContain('enum LearningAttemptType');
    expect(schema).toMatch(
      /enum LearningAttemptType \{[\s\S]*EXERCISE[\s\S]*PRONUNCIATION/,
    );
    expect(attempt).toMatch(
      /attemptType\s+LearningAttemptType\s+@default\(EXERCISE\)/,
    );
    expect(attempt).toMatch(/pronunciationAssessmentId\s+String\?\s+@unique/);
    expect(attempt).toMatch(/evidenceHash\s+String\?/);
    expect(attempt).toMatch(/policyVersion\s+String\?/);
    expect(schema).not.toMatch(/model PronunciationAttempt\s*\{/);
  });

  it('preserves every legacy exercise relation as the EXERCISE variant', () => {
    const attempt = model('LearningAttempt');

    expect(attempt).toMatch(/exerciseId\s+String\?/);
    expect(attempt).toMatch(/submissionId\s+String\?\s+@unique/);
    expect(attempt).toMatch(/saveRequestId\s+String\?\s+@unique/);
    expect(attempt).toMatch(/gradingHash\s+String\?/);
    expect(attempt).toMatch(/exercise\s+Exercise\?/);
    expect(attempt).toMatch(/submission\s+ExerciseSubmission\?/);
    expect(attempt).toMatch(/saveRequest\s+CoachRequest\?/);
  });

  it('versions review evidence and separates pronunciation mastery', () => {
    const event = model('LearningReviewEvent');

    expect(schema).toMatch(
      /enum LearningTargetType \{[\s\S]*PRONUNCIATION_WORD/,
    );
    expect(event).toMatch(
      /evidenceKind\s+LearningEvidenceKind\s+@default\(EXERCISE_GRADING\)/,
    );
    expect(event).toMatch(/schedulerVersion\s+String\s+@default\("SM2_V1"\)/);
    expect(event).toMatch(
      /policyVersion\s+String\s+@default\("coach-attempt.v1"\)/,
    );
    expect(event).toMatch(/voidedAt\s+DateTime\?/);
  });
});
