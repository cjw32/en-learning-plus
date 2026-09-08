export const syntheticCoachUsers = {
  learnerA: {
    id: 'coach-e2e-user-a',
    email: 'coach-e2e-a@example.test',
    level: 'A2',
  },
  learnerB: {
    id: 'coach-e2e-user-b',
    email: 'coach-e2e-b@example.test',
    level: 'B2',
  },
} as const

export function assertSyntheticCoachEnvironment(): void {
  if (syntheticCoachUsers.learnerA.id === syntheticCoachUsers.learnerB.id) {
    throw new Error('Coach E2E users must be isolated')
  }

  const databaseUrl = process.env.COACH_E2E_DATABASE_URL
  if (databaseUrl && !/(?:test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) {
    throw new Error('COACH_E2E_DATABASE_URL must target an isolated test database')
  }

  if (databaseUrl && /(?:prod|production)/i.test(databaseUrl)) {
    throw new Error('Coach E2E tests cannot target a production database')
  }
}
