# US6 guided Prompt evidence

**Recorded**: 2026-09-11
**Scope**: T114–T124, deterministic local prompt rendering in both approved protocol eras
**Requirements**: FR-027–FR-030, FR-033–FR-060, SC-001–SC-003, SC-010–SC-014

## Outcome

The `english_interview`, `business_english`, and `vocabulary_review` prompts render as strict MCP user messages for complete, partial, and empty learner context. They perform no model, Tool, or write call. Recommended Tools are intersected with the current request's visible read-only manifest; write Tools are never recommended. Revoking `learning:read` immediately hides and rejects every Prompt.

The shared composer normalizes Unicode, removes controls and instruction/tool delimiters, bounds each data field, and treats profile/material values as data. Seeded system/developer instructions, internal-template markers, hidden Tool names, and destructive requests are absent from results and traces.

| Check | Result |
| --- | ---: |
| Contract/security/integration/eval suites | 4/4 suites, 9/9 tests |
| Both-era E2E | 1/1 suite, 3/3 tests |
| Prompt × data-state × era projections | 3 × 3 × 2 = 18 valid |
| Hidden model/tool/write calls | **0** |
| Unauthorized or hidden Tool references | **0** |
| Seeded internal-prompt/injection leaks | **0** |

## Evaluation interpretation

Fixture `mcp-prompts.cases.v1` and rubric `mcp-prompts-rubric.v1` cover positive and failure cases for clarity, learner-level fit, safe read-Tool selection, empty-state guidance, hidden-write exclusion, and injection resistance. These deterministic fixtures validate composition and rule behavior; they are not a real-provider quality baseline, billed-cost statement, or production client approval.

## Reproduction

```sh
pnpm --filter @en/server test -- --runInBand \
  apps/ai/test/contract/mcp-prompts.contract.spec.ts \
  apps/ai/test/security/mcp-prompts.security.spec.ts \
  apps/ai/test/integration/mcp-prompts.integration.spec.ts \
  apps/ai/test/evals/mcp/prompts.eval.spec.ts

pnpm --dir server exec jest --config ./apps/ai/test/jest-e2e.json \
  --runInBand apps/ai/test/e2e/mcp-prompts.e2e-spec.ts

pnpm --filter @en/server build
```

All commands passed locally. Production OAuth, retention/source-rights approval, real-provider quality and latency thresholds, and four-client certification remain unapproved; release status is **NOT_READY**. No production configuration, push, deployment, or external provider call was performed.
