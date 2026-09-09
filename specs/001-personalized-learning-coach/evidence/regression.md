# Existing-flow regression evidence

Date: 2026-09-03

## Server regression

Command (connection values redacted):

```text
NODE_OPTIONS=--experimental-vm-modules
COACH_E2E_DATABASE_URL=<localhost-disposable-test-url>
COACH_E2E_REDIS_HOST=127.0.0.1
COACH_E2E_REDIS_PORT=<temporary-port>
pnpm --filter @en/server exec jest \
  --config apps/server/test/jest-e2e.json --runInBand
```

Exit 0: 2 suites and 4 tests passed.

- `existing-flows-regression.e2e-spec.ts` booted the real Nest AppModule against
  temporary PostgreSQL/Redis and exercised register, login, refresh-token,
  unauthenticated and authenticated purchased-course access, dictionary search,
  ten-word retrieval, batch mastery, duplicate replay, and database counts.
- Final counts were exactly 10 `WordBookRecord`, 10 `LearningItemState`, and
  `User.wordNumber=10`; replay did not increase them.
- The generic AI controller retained five modes, the existing history route,
  and the existing SSE response contract. A deterministic fake stream replaced
  the external model; no production model or key was used.
- `learn-coach-regression.e2e-spec.ts` retained its two service-level legacy
  learning compatibility tests.

Full supporting validation also passed:

| Command | Exit | Result |
|---|---:|---|
| `pnpm --filter @en/server exec jest --runInBand` | 0 | 35 suites, 149 tests |
| `pnpm --filter @en/server exec jest --config apps/ai/test/jest-e2e.json --runInBand` | 0 | 10 suites, 44 tests |
| `pnpm --filter @en/server build` | 0 | en-server compiled |
| `pnpm --filter @en/server exec nest build ai` | 0 | en-ai compiled |

The real AppModule regression exposed invalid interface/default-function DI in
`LearningModule`; provider factories were made explicit, after which AppModule
boot and all existing test suites passed.

## Browser regression

`pnpm exec playwright test apps/web/e2e/coach-environment.spec.ts
apps/web/e2e/coach-streaming.spec.ts
apps/web/e2e/existing-flows-regression.spec.ts` exited 0 with 10 Chromium tests.

The two new browser scenarios verified the home, dictionary, course, settings
and generic AI pages, including all five existing AI modes. Backend responses
were deterministic browser fixtures; the test asserted that navigation through
these old pages issued no `/ai/v1/coach` request. The other eight scenarios
revalidated Coach streaming, reconciliation, failure, saved grading, retry and
cancellation behavior.

T104 is complete. This evidence is isolated and deterministic; it is not a
production deployment or a live third-party model smoke test.
