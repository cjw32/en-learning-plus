# Build evidence

Date: 2026-09-08
Runtime: Node.js v24.18.0, pnpm 10.32.1

| Command | Exit | Result |
|---|---:|---|
| `pnpm --filter @en/server build` | 0 | en-server compiled |
| `pnpm --filter @en/server exec nest build ai` | 0 | en-ai compiled |
| `pnpm --filter @en/web type-check` | 0 | Vue/TypeScript contracts compiled |
| `pnpm --filter @en/web build-only` | 0 | Vite production build completed |

The web build reported existing non-fatal package-module and chunk-size warnings. No dependency was added to address those unrelated warnings.

`@en/tracker` was built first because the web workspace consumes its generated
declarations. Its declaration plugin reported existing tracker type diagnostics
but completed successfully; the authoritative web `vue-tsc` check then exited
0.
