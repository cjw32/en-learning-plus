const SYNTHETIC_USER_IDS = ['coach-e2e-user-a', 'coach-e2e-user-b'] as const;

describe('Coach E2E test environment', () => {
  it('uses distinct synthetic users and never a production database URL', () => {
    expect(new Set(SYNTHETIC_USER_IDS).size).toBe(SYNTHETIC_USER_IDS.length);

    const databaseUrl = process.env.COACH_E2E_DATABASE_URL;
    if (databaseUrl) {
      expect(databaseUrl).toMatch(/(?:test|localhost|127\.0\.0\.1)/i);
      expect(databaseUrl).not.toMatch(/(?:prod|production)/i);
    }
  });
});
