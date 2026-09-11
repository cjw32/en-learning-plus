# English Learning MCP traceability

**Feature**: `004-english-learning-mcp`
**Purpose**: Final T147 implementation, positive/failure-test, and evidence map.
**Status**: Synthetic/local verification complete; production/client baseline claims remain blocked by T146.
**Rule**: A path is evidence only when its named test passed. Missing approval is recorded as `NOT_READY`, never inferred as a pass.

## Functional requirements

| Requirement | Planned implementation path | Planned verification artifact | Tasks |
|---|---|---|---|
| FR-001 | `server/apps/ai/src/main.ts`; `server/apps/ai/src/mcp/mcp.module.ts` | `server/apps/ai/test/e2e/mcp-connect-discovery.e2e-spec.ts` | T007, T041–T043 |
| FR-002 | `server/apps/ai/src/mcp/transport/mcp-protocol-negotiator.ts` | `server/apps/ai/test/contract/mcp-modern-transport.contract.spec.ts`; `server/apps/ai/test/contract/mcp-legacy-transport.contract.spec.ts` | T028–T029, T036 |
| FR-003 | `server/apps/ai/src/mcp/transport/mcp-modern-transport.factory.ts`; `server/apps/ai/src/mcp/transport/mcp-legacy-session.manager.ts` | `server/apps/ai/test/e2e/mcp-connect-discovery.e2e-spec.ts` | T028–T029, T037–T038, T043 |
| FR-004 | `server/apps/ai/src/mcp/capabilities/mcp-capability-registry.ts` | `server/apps/ai/test/security/mcp-capability-matrix.security.spec.ts` | T031, T039 |
| FR-005 | `packages/common/mcp/schemas.ts` | `server/apps/ai/test/contract/mcp-common-schemas.contract.spec.ts` | T009, T015 |
| FR-006 | `server/apps/ai/src/mcp/transport/mcp-request-pipeline.ts`; `server/libs/learning/src/learning.module.ts` | `server/apps/ai/test/security/mcp-read-tools-boundary.security.spec.ts` | T027, T040, T060, T065 |
| FR-007 | `server/apps/ai/src/coach/mcp/mcp-learning.bridge.ts`; `server/apps/ai/src/mcp/tools/` | `server/apps/ai/test/security/mcp-read-tools-boundary.security.spec.ts` | T065–T070 |
| FR-008 | `server/apps/ai/src/mcp/governance/mcp-deadline.ts` | `server/apps/ai/test/governance/mcp-admission.spec.ts`; `server/apps/ai/test/integration/mcp-http-boundary.integration.spec.ts` | T013, T023, T032 |
| FR-009 | `server/apps/ai/src/mcp/governance/mcp-budget.ts` | `server/apps/ai/test/governance/mcp-admission.spec.ts` | T013, T023 |
| FR-010 | `server/apps/ai/src/mcp/resources/mcp-resource.registry.ts` | `server/apps/ai/test/contract/mcp-resources.contract.spec.ts` | T045, T057–T059 |
| FR-011 | `server/libs/learning/src/resources/learning-resource-read.service.ts` | `server/apps/ai/test/contract/mcp-resources.contract.spec.ts` | T045, T053, T057 |
| FR-012 | `server/apps/ai/src/mcp/resources/reviews-today.resource.ts`; `server/apps/ai/src/mcp/resources/report-summary.resource.ts`; `server/apps/ai/src/mcp/resources/weaknesses.resource.ts` | `server/apps/ai/test/security/mcp-resource-isolation.security.spec.ts` | T046, T058 |
| FR-013 | `server/apps/ai/src/mcp/pagination/mcp-cursor.service.ts` | `server/apps/ai/test/integration/mcp-resource-pagination.integration.spec.ts` | T047, T056 |
| FR-014 | `server/libs/learning/src/resources/learning-resource-read.service.ts`; `server/libs/learning/src/reporting/learning-report.service.ts` | `server/apps/ai/test/integration/mcp-resource-pagination.integration.spec.ts` | T047, T053–T055 |
| FR-015 | `server/apps/ai/src/mcp/resources/mcp-resource.registry.ts` | `server/apps/ai/test/security/mcp-resource-isolation.security.spec.ts` | T046, T059 |
| FR-016 | `server/apps/ai/src/mcp/results/mcp-result-validator.ts`; `server/apps/ai/src/mcp/observability/mcp-redaction.ts` | `server/apps/ai/test/security/mcp-observability.spec.ts` | T014, T024, T071 |
| FR-017 | `server/apps/ai/src/mcp/tools/mcp-tool.registry.ts` | `server/apps/ai/test/contract/mcp-read-tools.contract.spec.ts` | T062, T066–T072 |
| FR-018 | `packages/common/mcp/schemas.ts` | `server/apps/ai/test/contract/mcp-read-tools.contract.spec.ts` | T009, T015, T062 |
| FR-019 | `packages/common/mcp/schemas.ts`; `server/apps/ai/src/mcp/governance/mcp-budget.ts` | `server/apps/ai/test/security/mcp-read-tools-boundary.security.spec.ts` | T015, T023, T065 |
| FR-020 | `server/apps/ai/src/mcp/results/mcp-result-validator.ts` | `server/apps/ai/test/contract/mcp-read-tools.contract.spec.ts` | T062, T071 |
| FR-021 | `server/apps/ai/src/coach/mcp/mcp-learning.bridge.ts`; `server/libs/learning/src/` | `server/apps/ai/test/e2e/mcp-read-tools.e2e-spec.ts`; `server/apps/ai/test/e2e/mcp-create-quiz.e2e-spec.ts` | T050–T055, T069, T074, T084, T089 |
| FR-022 | `server/apps/ai/src/mcp/tools/create-quiz.tool.ts` | `server/apps/ai/test/security/mcp-create-quiz.security.spec.ts` | T076–T078, T084–T086 |
| FR-023 | `server/apps/ai/src/mcp/idempotency/mcp-idempotency.service.ts` | `server/apps/ai/test/integration/mcp-submit-idempotency.integration.spec.ts` | T025, T079, T083, T094 |
| FR-024 | `server/apps/ai/src/mcp/confirmation/write-confirmation.service.ts`; `apps/web/src/views/McpConfirmation/index.vue` | `server/apps/ai/test/contract/mcp-submit-elicitation.contract.spec.ts`; `server/apps/ai/test/security/mcp-confirmation-web.security.spec.ts` | T092–T093, T101–T107 |
| FR-025 | `server/libs/learning/src/submission/mcp-submit-answer.service.ts` | `server/apps/ai/test/integration/mcp-submit-atomicity.integration.spec.ts` | T094–T097, T109–T112 |
| FR-026 | `server/apps/ai/src/mcp/tools/mcp-tool.registry.ts` | `server/apps/ai/test/security/mcp-capability-matrix.security.spec.ts` | T031, T072, T088, T112 |
| FR-027 | `server/apps/ai/src/mcp/prompts/mcp-prompt.registry.ts` | `server/apps/ai/test/contract/mcp-prompts.contract.spec.ts` | T114, T118–T122 |
| FR-028 | `packages/common/mcp/schemas.ts`; `server/apps/ai/src/mcp/prompts/` | `server/apps/ai/test/contract/mcp-prompts.contract.spec.ts` | T114, T118–T120 |
| FR-029 | `server/apps/ai/src/mcp/prompts/mcp-prompt-composer.ts` | `server/apps/ai/test/security/mcp-prompts.security.spec.ts` | T115, T121 |
| FR-030 | `server/apps/ai/src/mcp/prompts/mcp-prompt.registry.ts` | `server/apps/ai/test/integration/mcp-prompts.integration.spec.ts` | T116, T122–T124 |
| FR-031 | `server/apps/ai/src/mcp/auth/mcp-protected-resource.controller.ts` | `server/apps/ai/test/security/mcp-oauth.security.spec.ts` | T030, T033 |
| FR-032 | `server/apps/ai/src/mcp/auth/oidc-mcp-access-token-verifier.ts` | `server/apps/ai/test/security/mcp-oauth.security.spec.ts` | T030, T034 |
| FR-033 | `server/apps/ai/src/mcp/auth/oidc-mcp-access-token-verifier.ts` | `server/apps/ai/test/security/mcp-oauth.security.spec.ts` | T030, T034 |
| FR-034 | `server/apps/ai/src/mcp/auth/mcp-authorization.service.ts` | `server/apps/ai/test/security/mcp-auth-context.spec.ts` | T012, T035 |
| FR-035 | `server/apps/ai/src/mcp/auth/mcp-authorization.service.ts`; `server/apps/ai/src/mcp/capabilities/mcp-capability-registry.ts` | `server/apps/ai/test/security/mcp-capability-matrix.security.spec.ts` | T031, T035, T039 |
| FR-036 | `server/apps/ai/src/mcp/auth/mcp-principal.ts` | `server/apps/ai/test/security/mcp-auth-context.spec.ts` | T012, T022 |
| FR-037 | `apps/web/src/views/McpConfirmation/index.vue`; `server/apps/ai/src/mcp/auth/mcp-protected-resource.controller.ts` | `apps/web/src/views/McpConfirmation/__tests__/McpConfirmation.spec.ts` | T033, T098, T105 |
| FR-038 | `server/apps/ai/src/mcp/auth/mcp-authorization.service.ts`; `server/apps/ai/src/mcp/retention/mcp-learning-data-cleanup.service.ts` | `server/apps/ai/test/integration/mcp-retention-deletion.integration.spec.ts` | T035, T127, T134 |
| FR-039 | `packages/common/mcp/schemas.ts` | `server/apps/ai/test/contract/mcp-common-schemas.contract.spec.ts` | T009, T015–T016 |
| FR-040 | `server/apps/ai/src/mcp/prompts/mcp-prompt-composer.ts`; `server/apps/ai/src/mcp/results/mcp-result-validator.ts` | `server/apps/ai/test/security/mcp-prompts.security.spec.ts`; `server/apps/ai/test/security/mcp-material-search.security.spec.ts` | T064, T071, T115, T121 |
| FR-041 | `packages/common/mcp/schemas.ts` | `server/apps/ai/test/security/mcp-public-boundary-fuzz.security.spec.ts` | T009, T015, T148 |
| FR-042 | `server/apps/ai/src/mcp/errors/mcp-error-mapper.ts`; `server/apps/ai/src/mcp/observability/mcp-redaction.ts` | `server/apps/ai/test/security/mcp-observability.spec.ts` | T014, T024 |
| FR-043 | `server/apps/ai/src/mcp/results/mcp-result-validator.ts`; `server/apps/ai/src/mcp/governance/mcp-budget.ts` | `server/apps/ai/test/security/mcp-public-boundary-fuzz.security.spec.ts` | T023, T071, T148 |
| FR-044 | `server/apps/ai/src/mcp/governance/mcp-admission.service.ts` | `server/apps/ai/test/governance/mcp-admission.spec.ts` | T013, T023 |
| FR-045 | `server/apps/ai/src/mcp/governance/mcp-deadline.ts` | `server/apps/ai/test/governance/mcp-admission.spec.ts` | T013, T023 |
| FR-046 | `server/apps/ai/src/mcp/idempotency/mcp-idempotency.service.ts` | `server/apps/ai/test/integration/mcp-submit-idempotency.integration.spec.ts` | T025, T079, T094 |
| FR-047 | `server/apps/ai/src/mcp/errors/mcp-error-mapper.ts` | `server/apps/ai/test/governance/mcp-create-quiz-governance.spec.ts` | T024, T080 |
| FR-048 | `server/apps/ai/src/mcp/observability/mcp-trace.service.ts` | `server/apps/ai/test/integration/mcp-trace-query.integration.spec.ts` | T024, T125, T132 |
| FR-049 | `server/apps/ai/src/mcp/observability/mcp-trace.service.ts`; `server/apps/ai/src/mcp/governance/mcp-cost-meter.ts` | `server/apps/ai/test/security/mcp-sensitive-data-scan.security.spec.ts` | T073, T087, T125–T126 |
| FR-050 | `server/apps/ai/src/mcp/retention/mcp-retention.service.ts`; `server/apps/ai/src/mcp/retention/mcp-learning-data-cleanup.service.ts` | `server/apps/ai/test/integration/mcp-retention-deletion.integration.spec.ts` | T127, T133–T134 |
| FR-051 | `server/apps/ai/src/mcp/retention/mcp-retention.processor.ts` | `server/apps/ai/test/integration/mcp-retention-deletion.integration.spec.ts` | T127, T133 |
| FR-052 | `server/apps/ai/test/evals/mcp/fixtures/mcp-eval-cases.v1.json` | `server/apps/ai/test/evals/mcp/eval-case-schema.spec.ts` | T128, T135–T136 |
| FR-053 | `server/apps/ai/test/evals/mcp/mcp-eval.types.ts` | `server/apps/ai/test/evals/mcp/eval-case-schema.spec.ts` | T128, T135 |
| FR-054 | `server/apps/ai/test/evals/mcp/mcp-deterministic-evaluator.ts`; `server/apps/ai/test/evals/mcp/mcp-ai-evaluator.ts` | `specs/004-english-learning-mcp/evidence/evals/synthetic-summary.md` | T138–T140, T145 |
| FR-055 | `server/apps/ai/test/evals/mcp/mcp-eval-report.ts` | `server/apps/ai/test/evals/mcp/mcp-metrics.spec.ts` | T129, T140–T142 |
| FR-056 | `server/apps/ai/test/evals/mcp/mcp-release-gate.ts` | `server/apps/ai/test/evals/mcp/mcp-release-gate.spec.ts` | T130, T143 |
| FR-057 | `server/apps/ai/test/evals/mcp/mcp-release-gate.ts` | `specs/004-english-learning-mcp/evidence/evals/approved-baselines.md` | T130, T143, T146 |
| FR-058 | `server/apps/ai/test/evals/mcp/mcp-release-gate.ts` | `server/apps/ai/test/evals/mcp/mcp-release-gate.spec.ts` | T130, T143 |
| FR-059 | `server/apps/ai/test/compatibility/mcp-client-matrix.ts` | `specs/004-english-learning-mcp/evidence/client-matrix-template.md` | T131, T144, T146 |
| FR-060 | `server/apps/ai/src/mcp/mcp.module.ts` | `specs/004-english-learning-mcp/evidence/server-regression.md`; `specs/004-english-learning-mcp/evidence/web-regression.md` | T027, T150–T152 |

## Success criteria

| Criterion | Planned implementation/evidence path | Planned verification artifact | Tasks |
|---|---|---|---|
| SC-001 | `server/apps/ai/src/mcp/capabilities/mcp-capability-registry.ts` | `server/apps/ai/test/security/mcp-capability-matrix.security.spec.ts`; `specs/004-english-learning-mcp/evidence/us1-connect-discovery.md` | T031, T039, T044 |
| SC-002 | `server/apps/ai/src/mcp/auth/oidc-mcp-access-token-verifier.ts` | `server/apps/ai/test/security/mcp-oauth.security.spec.ts`; `server/apps/ai/test/security/mcp-sensitive-data-scan.security.spec.ts` | T030, T034, T126 |
| SC-003 | `server/apps/ai/src/mcp/auth/mcp-authorization.service.ts` | `server/apps/ai/test/security/mcp-resource-isolation.security.spec.ts` | T035, T046 |
| SC-004 | `packages/common/mcp/schemas.ts`; `server/apps/ai/src/mcp/tools/mcp-tool.registry.ts` | `server/apps/ai/test/contract/mcp-common-schemas.contract.spec.ts`; `server/apps/ai/test/contract/mcp-read-tools.contract.spec.ts` | T009, T062 |
| SC-005 | `server/apps/ai/src/mcp/tools/`; `server/libs/learning/src/reporting/learning-report.service.ts` | `server/apps/ai/test/integration/mcp-read-tools-state.integration.spec.ts` | T055, T063, T066–T070 |
| SC-006 | `server/apps/ai/src/coach/mcp/mcp-learning.bridge.ts`; `server/apps/ai/src/mcp/results/mcp-result-validator.ts` | `server/apps/ai/test/security/mcp-material-search.security.spec.ts` | T064, T069–T071 |
| SC-007 | `server/apps/ai/src/mcp/tools/create-quiz.tool.ts`; `server/apps/ai/src/mcp/results/mcp-quiz-result.projector.ts` | `server/apps/ai/test/evals/mcp/create-quiz.eval.spec.ts`; `server/apps/ai/test/security/mcp-create-quiz.security.spec.ts` | T077–T078, T085–T086 |
| SC-008 | `server/apps/ai/src/mcp/confirmation/write-confirmation.service.ts`; `server/libs/learning/src/submission/mcp-submit-answer.service.ts` | `server/apps/ai/test/integration/mcp-write-confirmation.integration.spec.ts`; `server/apps/ai/test/integration/mcp-submit-atomicity.integration.spec.ts` | T091, T095, T101, T110 |
| SC-009 | `server/apps/ai/src/mcp/idempotency/mcp-idempotency.service.ts` | `server/apps/ai/test/integration/mcp-submit-idempotency.integration.spec.ts`; `server/apps/ai/test/governance/mcp-submit-cost.spec.ts` | T025, T094, T097 |
| SC-010 | `server/apps/ai/src/mcp/prompts/` | `server/apps/ai/test/security/mcp-prompts.security.spec.ts`; `server/apps/ai/test/evals/mcp/prompts.eval.spec.ts` | T115, T117–T122 |
| SC-011 | `server/apps/ai/src/mcp/observability/mcp-trace.service.ts` | `server/apps/ai/test/security/mcp-observability.spec.ts`; `server/apps/ai/test/security/mcp-sensitive-data-scan.security.spec.ts` | T014, T024, T126 |
| SC-012 | `server/apps/ai/src/mcp/governance/mcp-deadline.ts` | `server/apps/ai/test/integration/mcp-http-boundary.integration.spec.ts`; `server/apps/ai/test/integration/mcp-submit-reconciliation.integration.spec.ts` | T023, T032, T096 |
| SC-013 | `server/apps/ai/test/evals/mcp/mcp-release-gate.ts` | `server/apps/ai/test/evals/mcp/mcp-release-gate.spec.ts`; `specs/004-english-learning-mcp/evidence/evals/synthetic-summary.md` | T130, T143, T145 |
| SC-014 | `server/apps/ai/test/evals/mcp/mcp-eval-report.ts`; `server/apps/ai/test/compatibility/mcp-client-matrix.ts` | `specs/004-english-learning-mcp/evidence/evals/approved-baselines.md` | T140, T144, T146 |
| SC-015 | `server/apps/ai/src/mcp/mcp.module.ts` | `specs/004-english-learning-mcp/evidence/baseline.md`; `specs/004-english-learning-mcp/evidence/server-regression.md`; `specs/004-english-learning-mcp/evidence/web-regression.md` | T001, T027, T150–T152 |
| SC-016 | `apps/web/src/views/McpConfirmation/index.vue` | `apps/web/src/views/McpConfirmation/__tests__/McpConfirmation.spec.ts`; `specs/004-english-learning-mcp/evidence/us5-submit-answer.md` | T098, T105, T113 |

## Final evidence and failure coverage

| Requirement range | Positive and failure evidence | Final evidence |
|---|---|---|
| FR-001–FR-009 | Both-era contract/E2E, version mismatch, session identity/capability, cancellation and governance suites named above | `evidence/us1-connect-discovery.md`; `evidence/final-verification.md` |
| FR-010–FR-016 | Resource contract, pagination, rights-revocation, cross-user and observability suites named above | `evidence/us2-resources.md`; `evidence/final-verification.md` |
| FR-017–FR-026 | Tool contracts, strict-boundary, RAG failure, idempotency, confirmation, atomicity and reconciliation suites named above | `evidence/us3-read-tools.md`; `evidence/us4-create-quiz.md`; `evidence/us5-submit-answer.md` |
| FR-027–FR-030 | Prompt contract, missing-data, revocation, injection and internal-prompt-leak suites named above | `evidence/us6-prompts.md` |
| FR-031–FR-043 | OAuth/auth-context/capability matrix, schema drift, Web ownership/CSRF and public-boundary suites named above | `evidence/us1-connect-discovery.md`; `evidence/us5-submit-answer.md`; `evidence/final-verification.md` |
| FR-044–FR-051 | Admission/deadline, cost, trace query, sensitive scan, retention/deletion and reconciliation suites named above | `evidence/evals/observability-report.json`; `evidence/evals/cost-report.json`; `evidence/query-load-baseline.md` |
| FR-052–FR-060 | Eval schema/metrics/release-gate/client-harness suites, synthetic report and regressions named above | `evidence/evals/synthetic-summary.md`; `evidence/evals/approved-baselines.md`; `evidence/server-regression.md`; `evidence/web-regression.md`; `evidence/readiness.md` |
| SC-001–SC-016 | Each SC row above names its positive suite; paired malformed/revoked/cross-user/cancellation/missing-evidence cases are included in the linked phase suites | `evidence/final-verification.md`; `evidence/readiness.md` |

T001–T145 and T147–T156 are represented by their phase evidence or final evidence files. T146 is intentionally not claimed complete: it is the only approval-gated execution task and remains a release blocker. There are no orphan requirements; FR-001 through FR-060 and SC-001 through SC-016 each have an implementation/task row and final evidence mapping.

## T002/T147 verification

- FR rows: 60 (`FR-001` through `FR-060`), each with at least one exact implementation path, verification artifact, and task link.
- SC rows: 16 (`SC-001` through `SC-016`), each with at least one exact implementation/evidence path, verification artifact, and task link.
- Positive and failure-path coverage is linked above. Synthetic/local evidence is complete; real-provider and four-client proof remains explicitly pending under T146.
