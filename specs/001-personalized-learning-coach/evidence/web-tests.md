# Web test evidence

Date: 2026-09-03  
Vitest: 4.1.11  
Playwright: 1.62.1

| Command | Exit | Result |
|---|---:|---|
| `pnpm --filter @en/web test:unit` | 0 | 8 files, 30 tests passed |
| `pnpm exec playwright test apps/web/e2e/coach-environment.spec.ts apps/web/e2e/coach-streaming.spec.ts apps/web/e2e/existing-flows-regression.spec.ts` | 0 | 10 Chromium tests passed |
| Same Playwright selection with `--trace on` | 0 | 10 tests passed and 10 `test-results/playwright/**/trace.zip` artifacts generated, including screenshot snapshots |

Browser scenarios cover isolated synthetic fixtures, safe tool progress, authoritative final results, 410 durable reconciliation, timeout, budget exhaustion, explicit network retry, saved grading state, cancellation, and legacy home/dictionary/course/settings/generic-AI routes. The DOM assertions reject sensitive canaries and do not render Prompt/tool arguments; legacy navigation emits no Coach API request.
