export type RagAccessFixture = Readonly<{
  subjectId: string;
  purchasedCourseId: string;
  unownedCourseId: string;
  privateWrongAnswerId: string;
  privateSummaryId: string;
  privateCanary: string;
}>;

export const RAG_ACCESS_FIXTURES = Object.freeze({
  userA: Object.freeze({
    subjectId: 'rag-test-subject-a',
    purchasedCourseId: 'rag-test-course-a',
    unownedCourseId: 'rag-test-course-b',
    privateWrongAnswerId: 'rag-test-wrong-answer-a',
    privateSummaryId: 'rag-test-summary-a',
    privateCanary: 'PRIVATE_CANARY_ALPHA_7JQ2',
  }),
  userB: Object.freeze({
    subjectId: 'rag-test-subject-b',
    purchasedCourseId: 'rag-test-course-b',
    unownedCourseId: 'rag-test-course-a',
    privateWrongAnswerId: 'rag-test-wrong-answer-b',
    privateSummaryId: 'rag-test-summary-b',
    privateCanary: 'PRIVATE_CANARY_BRAVO_9PK4',
  }),
}) satisfies Readonly<Record<'userA' | 'userB', RagAccessFixture>>;

export function assertRagAccessFixtureIsolation(): void {
  const { userA, userB } = RAG_ACCESS_FIXTURES;
  const keys: Array<keyof RagAccessFixture> = [
    'subjectId',
    'purchasedCourseId',
    'privateWrongAnswerId',
    'privateSummaryId',
    'privateCanary',
  ];

  for (const key of keys) {
    if (userA[key] === userB[key]) {
      throw new Error(`RAG access fixtures overlap at ${key}`);
    }
  }

  if (
    userA.unownedCourseId !== userB.purchasedCourseId ||
    userB.unownedCourseId !== userA.purchasedCourseId
  ) {
    throw new Error('RAG course entitlement fixture is inconsistent');
  }
}
