import {
  assertRagAccessFixtureIsolation,
  RAG_ACCESS_FIXTURES,
} from './rag-access-fixtures';

describe('RAG access fixtures', () => {
  it('keeps subjects, private records and canaries disjoint', () => {
    expect(assertRagAccessFixtureIsolation).not.toThrow();
  });

  it('models mutually exclusive purchased course access', () => {
    const { userA, userB } = RAG_ACCESS_FIXTURES;

    expect(userA.purchasedCourseId).toBe(userB.unownedCourseId);
    expect(userB.purchasedCourseId).toBe(userA.unownedCourseId);
    expect(userA.privateCanary).not.toBe(userB.privateCanary);
  });
});
