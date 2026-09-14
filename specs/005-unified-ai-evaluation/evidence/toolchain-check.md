# T002 — Existing toolchain

Date: 2026-09-14. No installation, network evaluation or production imports.

| Probe | Actual outcome | Exit |
|---|---|---|
| `pnpm --filter @en/server exec tsx --version` | tsx 4.21.0; Node 24.18.0 | 0 |
| `pnpm --filter @en/server exec ts-node --version` | 10.9.2 | 0 |
| `pnpm --filter @en/server exec jest --version` | 30.2.0 | 0 |
| ts-node with `-r tsconfig-paths/register`, reflect-metadata, Nest Injectable(Date) and existing `@en/common/coach/zod` strict schema | metadata Date, schema true | 0 |

First tsx probe failed EPERM because the sandbox prevents its IPC pipe. Same read-only version probe succeeded with reviewed execution permission. This is an environment restriction, not a new dependency.

First inline ts-node probe used REPL `require.resolve`, which is unavailable in that REPL; exit 1. Corrected the probe to use the existing shared Zod export and observed metadata Date and successful schema parsing. No source workaround required.

CLI uses existing tsx; Nest workers use existing ts-node/tsconfig-paths or Jest transform for decorator metadata. No new packages, compiler settings or system tools. Native audio and live resources have not been validated; they are separate G-03 prerequisites.
