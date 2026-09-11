# T004 dependency installation evidence

**Executed**: 2026-09-11 (Asia/Shanghai)
**Authorization**: user replied “授权” to the explicit T004 request for the three exact packages.
**Scope**: `server/package.json` and root `pnpm-lock.yaml` only.

## Installed packages

| Placement | Package | Exact version |
|---|---|---:|
| runtime dependency | `@modelcontextprotocol/server` | `2.0.0` |
| runtime dependency | `@modelcontextprotocol/node` | `2.0.0` |
| development dependency | `@modelcontextprotocol/client` | `2.0.0` |

Local package manifests report MIT license, Node `>=20`, and the official `https://github.com/modelcontextprotocol/typescript-sdk.git` repository. CommonJS resolution was exercised successfully for `McpServer`, `createMcpHandler`, `isLegacyRequest`, `NodeStreamableHTTPServerTransport`, `toNodeHandler`, and `Client` under Node 24.

## Verification

| Check | Result |
|---|---|
| `pnpm install --lockfile-only` | PASS, exit 0 |
| `pnpm --filter @en/server build` | PASS, exit 0 |
| exact manifest versions | PASS: all three are `2.0.0` |
| dependency/lockfile diff scope | PASS: only the three approved direct entries and their resolved transitive packages/edges were added |
| unrelated production configuration | unchanged |

pnpm reported pre-existing Web/Vite peer warnings and the workspace's existing ignored-build-script warning. No package upgrade, build-script approval, or unrelated remediation was performed.

## Advisory review

`pnpm audit --prod --json` does not report an advisory directly against the three `@modelcontextprotocol/*` 2.0.0 packages. It does report existing vulnerable `hono@4.12.10` and `@hono/node-server@1.19.11` versions through the newly visible `@modelcontextprotocol/node` dependency path, including one high-severity Hono advisory and multiple moderate/low advisories. Both versions already existed in the lock graph through Prisma; T004 did not change their locked versions.

This does not authorize remediation or production enablement. The MCP module remains absent/default-off, the planned implementation must avoid the optional Hono adapter and cookie/JWT helpers, and final readiness remains `NOT_READY` until the dependency path is updated or a documented security review accepts the exact reachable surface. Any direct pin/override/upgrade requires a separately scoped dependency change.
