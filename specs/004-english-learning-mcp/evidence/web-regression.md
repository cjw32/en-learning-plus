# Web regression evidence

Recorded: 2026-09-11
Candidate: `3f3ad9f2004fec5a6b255efe70759b57489ab16a+working-tree`

| Command | Result |
|---|---|
| `pnpm --filter @en/web type-check` | PASS |
| `pnpm --filter @en/web test:unit` | PASS — 24 files / 135 tests |
| `pnpm --filter @en/web build` | PASS — 1,957 modules transformed |

T001 passed 21 files / 119 tests. The increase is the MCP confirmation API/route/component coverage. Existing routing, authentication and UI tests remained green. The confirmation suite covers pending/confirmed/rejected/expired/consumed/unauthorized/offline states, keyboard/focus/error recovery, visible save/mastery/review effects, and the scripted ≥90% comprehension criterion.

The build emitted the existing package-module-type performance warning and a large `vendor-three` chunk warning; neither is an error or an MCP behavior delta. No dependency, production configuration, external redirect, push, or deployment was performed.
