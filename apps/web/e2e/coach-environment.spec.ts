import { expect, test } from '@playwright/test'
import { assertSyntheticCoachEnvironment, syntheticCoachUsers } from './fixtures/coach'

test('Coach E2E fixtures use isolated synthetic learners', () => {
  assertSyntheticCoachEnvironment()
  expect(syntheticCoachUsers.learnerA.id).not.toBe(syntheticCoachUsers.learnerB.id)
  expect(syntheticCoachUsers.learnerA.email).toMatch(/example\.test$/)
})
