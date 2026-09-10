import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const databaseUrl = process.env.PRONUNCIATION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function psql(args: string[], input?: string): string {
  return execFileSync(
    'psql',
    [databaseUrl!, '-v', 'ON_ERROR_STOP=1', '-X', '-qAt', ...args],
    {
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}

const preMigrationSchema = String.raw`
CREATE TYPE "LearningTargetType" AS ENUM ('WORD', 'ERROR_TYPE');

CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
CREATE TABLE "WordBook" ("id" TEXT PRIMARY KEY);
CREATE TABLE "Course" ("id" TEXT PRIMARY KEY);
CREATE TABLE "CoachRequest" ("id" TEXT PRIMARY KEY);
CREATE TABLE "KnowledgeCitation" ("id" VARCHAR(64) PRIMARY KEY);

CREATE TABLE "LearningAttempt" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL UNIQUE,
  "saveRequestId" TEXT NOT NULL UNIQUE,
  "score" INTEGER NOT NULL,
  "errorTypes" JSONB NOT NULL,
  "gradingHash" VARCHAR(128) NOT NULL,
  "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "LearningItemState" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "targetType" "LearningTargetType" NOT NULL,
  "targetKey" VARCHAR(128) NOT NULL,
  "wordId" TEXT,
  CONSTRAINT "LearningItemState_target_check" CHECK (
    ("targetType" = 'WORD' AND "wordId" IS NOT NULL AND "targetKey" = "wordId") OR
    ("targetType" = 'ERROR_TYPE' AND "wordId" IS NULL)
  )
);

CREATE TABLE "LearningReviewEvent" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "itemStateId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "targetType" "LearningTargetType" NOT NULL,
  "targetKey" VARCHAR(128) NOT NULL,
  "itemScore" INTEGER NOT NULL,
  "quality" INTEGER NOT NULL,
  "previousState" JSONB NOT NULL,
  "nextState" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "User" ("id") VALUES ('legacy-user');
INSERT INTO "LearningAttempt" (
  "id", "userId", "exerciseId", "submissionId", "saveRequestId",
  "score", "errorTypes", "gradingHash"
) VALUES (
  'legacy-attempt', 'legacy-user', 'exercise-1', 'submission-1', 'request-1',
  88, '[]', 'legacy-grading-hash'
);
`;

describeDatabase('pronunciation schema migration', () => {
  beforeAll(() => {
    psql(['-c', preMigrationSchema]);
    psql([
      '-f',
      resolve(
        process.cwd(),
        'prisma/migrations/20260910000000_add_pronunciation_assessment/migration.sql',
      ),
    ]);
  });

  it('backfills and preserves the legacy exercise attempt', () => {
    expect(
      psql([
        '-c',
        'SELECT "attemptType"::text || \'|\' || "exerciseId" || \'|\' || "submissionId" || \'|\' || "saveRequestId" || \'|\' || "gradingHash" FROM "LearningAttempt" WHERE "id" = \'legacy-attempt\';',
      ]),
    ).toBe('EXERCISE|exercise-1|submission-1|request-1|legacy-grading-hash');
  });

  it('rejects incomplete EXERCISE and mixed PRONUNCIATION shapes', () => {
    expect(() =>
      psql([
        '-c',
        `INSERT INTO "LearningAttempt" ("id", "userId", "attemptType", "score", "errorTypes") VALUES ('bad-exercise', 'legacy-user', 'EXERCISE', 1, '[]');`,
      ]),
    ).toThrow();
    expect(() =>
      psql([
        '-c',
        `INSERT INTO "LearningAttempt" ("id", "userId", "attemptType", "exerciseId", "score", "errorTypes", "evidenceHash", "policyVersion") VALUES ('bad-pronunciation', 'legacy-user', 'PRONUNCIATION', 'fake-exercise', 1, '[]', 'evidence', 'policy');`,
      ]),
    ).toThrow();
  });

  it('enforces ranges and one active assessment per user', () => {
    const insertAssessment = (
      id: string,
      status: string,
      confidence = 'NULL',
    ) =>
      psql([
        '-c',
        `INSERT INTO "PronunciationAssessment" ("id", "userId", "clientIdempotencyKey", "requestBodyHash", "status", "exerciseType", "confidence", "deadlineAt", "updatedAt") VALUES ('${id}', 'legacy-user', '${id}-idempotency', '${id}-hash', '${status}', 'WORD', ${confidence}, NOW() + INTERVAL '30 seconds', NOW());`,
      ]);

    insertAssessment('active-1', 'QUEUED');
    expect(() => insertAssessment('active-2', 'PROCESSING')).toThrow();
    expect(() =>
      insertAssessment('bad-confidence', 'UNRECOGNIZABLE', '1.2'),
    ).toThrow();
  });
});
