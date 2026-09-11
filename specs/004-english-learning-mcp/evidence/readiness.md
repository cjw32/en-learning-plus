# English Learning MCP readiness decision

Recorded: 2026-09-11
Candidate: `3f3ad9f2004fec5a6b255efe70759b57489ab16a+working-tree`
Decision: **NOT_READY**

## Evidence reviewed

- [Requirement/evidence traceability](../traceability.md)
- [Synthetic/fake-provider evaluation](evals/synthetic-summary.md) and [machine-readable decision](evals/release-decision.json)
- [Approved baseline ledger](evals/approved-baselines.md) — explicitly not executed
- [Four-client matrix template](client-matrix-template.md) — four independent rows pending
- [Complete local verification](final-verification.md)
- [Server regression](server-regression.md) and [Web regression](web-regression.md)
- [Query/load baseline](query-load-baseline.md) — completed against a disposable local database and explicitly experimental
- [Scope/dependency/config audit](scope-audit.md)
- [Source-rights and gate decisions](../research.md)

## Passed local gates

Both approved protocol-era E2E suites, public contracts/drift checks, OAuth/identity/capability security, resources/read Tools, quiz generation, answer confirmation/atomic replay, Prompts, cancellation, redaction, retention policy logic, deterministic evaluation, release-gate unit tests, complete server regression, Web regression, and both builds passed. Synthetic zero-tolerance violations, seeded-sensitive-data hits, fabricated-save evidence, and duplicate incremental model cost are all zero.

## Blocking evidence

1. **T146 / GATE-B, GATE-D, GATE-E**: no approved source-display-rights record, retention approval, provider budget/threshold owner, real-provider baseline, or independently executed Codex/Claude Desktop/Visual Studio Code/MCP Inspector transcript exists.
2. **GATE-E production parity**: the disposable query/load run records plans, 8-client P50/P95, cancellation and lease contention, and the MCP persistence suite passed 4/4. It deliberately does not claim Nest/Prisma pool sizing, production-equivalent duration, or approved thresholds.
3. Three pre-existing pronunciation-migration tests remained database-gated in the full regression command; this is unchanged from the baseline and is not converted into a pass for this MCP release.

These blockers are conjunctive release requirements and cannot be averaged against green synthetic results. T149 is complete as experimental evidence; T146 remains unchecked in `tasks.md` and keeps the release closed.

## Disable and rollback posture

All MCP runtime/capability gates default to false. `MCP_ENABLED=false` leaves the raw MCP route unmounted; the read, RAG, quiz, confirmation and submit gates also fail closed and enforce prerequisite ordering. The safest rollback is to keep or return all MCP gates to false and revoke the local MCP authorization version; in-flight work rechecks authorization/cancellation before new steps and before a write. No production configuration was added or changed, so this candidate does not itself enable traffic.

## Authorization boundary

The user authorized only `@modelcontextprotocol/server@2.0.0`, `@modelcontextprotocol/node@2.0.0`, and dev `@modelcontextprotocol/client@2.0.0`; the audit confirms those exact direct additions. No commit, push, deployment, production enablement, real-provider call, OAuth registration, or external client baseline was performed.

Readiness can be reconsidered only after dated GATE-B/D/E authorization, a production-parity application-pool/load rerun against approved thresholds, four independent client artifacts, and a regenerated fail-closed decision with no missing evidence.
