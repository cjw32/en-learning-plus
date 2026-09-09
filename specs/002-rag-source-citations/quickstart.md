# Implementation Validation Quickstart: 英语学习知识库 RAG 与来源引用

**Feature**: `002-rag-source-citations`  
**Purpose**: 复现已完成实现的本地测试证据。本文中的数据库、迁移、评测和服务命令只能指向一次性测试环境，不得指向生产。

Current implementation status: T001–T117 were executed locally. RAG production enablement, live Provider evaluation, production migration/configuration, push and deployment were not authorized and were not performed.

## 1. Preconditions and release gates

Before implementation or live evaluation, record explicit approval for:

- A disposable PostgreSQL environment that provides pgvector and allows `CREATE EXTENSION vector`.
- Each content source and field: provenance, license/contract, allowed embedding/display/evaluation use, validity window, and rights version.
- Course access policy. Until changed explicitly, all course knowledge is `OWNED_COURSE`.
- Embedding Provider endpoint, model, dimensions, data processing/retention terms, price version, and private-content eligibility.
- Versioned chunking/retrieval/context/evaluation policies and a test-only budget.

Fail-closed defaults remain:

```text
RAG_ENABLED=false
RAG_SHADOW_ENABLED=false
RAG_INGESTION_ENABLED=false
RAG_PRIVATE_CONTENT_ENABLED=false
RAG_EMBEDDING_PROVIDER_APPROVED=false
```

Do not edit production configuration, install packages, run migrations, push, or deploy without a separate explicit authorization.

## 2. Plan artifact validation

From the repository root:

```bash
jq empty specs/002-rag-source-citations/contracts/search-learning-materials.schema.json
jq empty specs/002-rag-source-citations/contracts/coach-result-v2.schema.json

rg -n 'NEEDS CLARIFICA[T]ION|\[FEATUR[E]\]|\[DAT[E]\]|\[##[#]' \
  specs/002-rag-source-citations/plan.md \
  specs/002-rag-source-citations/research.md \
  specs/002-rag-source-citations/data-model.md \
  specs/002-rag-source-citations/quickstart.md

rg -n 'userId' \
  specs/002-rag-source-citations/contracts/search-learning-materials.schema.json \
  specs/002-rag-source-citations/contracts/coach-rag.openapi.yaml
```

Expected:

- Both JSON files parse.
- No unresolved template or technical clarification marker appears.
- Public/tool contracts contain no `userId` field.
- The specification may still list explicit business/data rollout approvals; those are gates, not hidden technical placeholders.

## 3. Dependency and scope guard

After a future implementation, verify that the approved zero-new-package decision held:

```bash
git diff -- package.json server/package.json apps/web/package.json pnpm-lock.yaml
git diff -- .env .env.production ecosystem.config.js
pnpm --filter @en/server why @prisma/adapter-pg
pnpm --filter @en/server why bullmq
pnpm --filter @en/server why @langchain/core
```

Expected:

- No package manifest or lockfile change attributable to RAG.
- No production environment or PM2 configuration change in the implementation branch unless separately approved.
- Vector access uses existing Prisma adapter/raw SQL; queueing and token counting use existing BullMQ/LangChain dependencies.

## 4. Disposable database validation

Set `DATABASE_URL` only to a throwaway test database. Confirm the target before applying anything:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select current_database(), current_user, inet_server_addr(), version();"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select default_version, installed_version from pg_available_extensions where name = 'vector';"
```

Expected:

- Database identity is explicitly test-only.
- `vector` is available. If absent, stop; do not install it on production as a workaround.

Only after confirmation:

```bash
pnpm --filter @en/server exec prisma migrate deploy --schema prisma/schema.prisma
pnpm --filter @en/server exec prisma generate --schema prisma/schema.prisma

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select extversion from pg_extension where extname = 'vector';"
```

Required database assertions:

- Extension, custom `vector` column, dimension checks, foreign keys and partial unique indexes exist.
- Existing tables/data remain compatible and no knowledge release is ACTIVE by migration alone.
- Prisma-generated CRUD never selects the unsupported vector field unintentionally.
- Running the same authorized backfill twice leaves one document/chunk/embedding per idempotency key.
- A failed partial embedding build cannot transition its release to READY/ACTIVE.

## 5. Build and static checks

```bash
pnpm --filter @en/server build
pnpm --filter @en/web type-check
pnpm --filter @en/web build-only
```

Expected:

- Existing server applications compile.
- Shared v1/v2 discriminated unions compile in server and Vue.
- `KnowledgeModule` supplies the concrete, default-off RAG search port to the existing Coach tool without adding a service or dependency.
- No direct import from undeclared/transitive pgvector or tokenizer packages.
- Raw SQL is confined to the knowledge vector repository and uses tagged-template parameters.

## 6. Contract tests

```bash
pnpm --filter @en/server exec jest --runInBand coach-contract
pnpm --filter @en/server exec jest --runInBand rag-search-learning-materials coach-result-v2
pnpm --filter @en/web test:unit -- coach
```

Required assertions:

- `coach.tool.v2` accepts only bounded filters, Top K <= 20 and relevance in [0,1].
- Unknown properties, `userId`, arbitrary access scopes and unsupported schema versions fail safely.
- `success` has at least one answer-eligible result/citation; `insufficient` has no answer-eligible result and may expose only `conflict_context` citations; `failed` exposes none.
- Every result rank is unique and sequential; every Citation maps to one returned result.
- `coach.result.v2` validates active/unavailable Citation unions and grounded claim paths.
- v1 stored/history results remain readable; v2 public responses are produced only through the projection service.
- Enabled answer/correction requests retain request-issued Citation IDs through the strict model schema, final result, storage and Trace; forged or text-mismatched links receive one controlled retry and then a citation-free `insufficient` result.
- When RAG is enabled, exercise/grading/recommendation branches are also stored as v2 with `knowledgeStatus=not_applicable`; flags-off and shadow-only requests preserve v1 compatibility.
- Redis replay payloads retain only opaque Citation IDs in generic unavailable projections; authenticated replay dynamically reauthorizes and resolves the current safe details.

## 7. Rights-gated ingestion tests

Use synthetic records plus a test rights ledger. Do not use production dictionary/course content.

```bash
pnpm --filter @en/server exec jest --runInBand knowledge-ingestion
NODE_OPTIONS='--experimental-vm-modules' \
RAG_TEST_DATABASE_URL="$DATABASE_URL" \
pnpm --filter @en/server exec jest \
  --config ./apps/ai/test/jest-e2e.json --runInBand knowledge-release
```

Test matrix:

| Case | Expected |
|------|----------|
| Missing source | Reject before Chunk/Embedding. |
| DRAFT/expired/revoked source | Reject and keep release non-active. |
| Field absent from allowlist | Exclude field; source name does not imply permission. |
| Duplicate job delivery | One effective document/chunk/embedding set. |
| Empty/title/link/template chunk | Reject. |
| Provider timeout/rate limit | Bounded retry; no active partial data. |
| Wrong count/dimension/non-finite/zero vector | Terminal failure; old active version preserved for ordinary update. |
| New complete version | Atomic cutover; no mixed active version. |
| Source revocation | Immediate search exclusion; no fallback to old version. |
| Private summary | Deterministic saved-fact projection only; no conversation text. |

Inspecting job payloads must show identifiers/versions only, never full private content.

## 8. Retrieval and access integration tests

```bash
NODE_OPTIONS='--experimental-vm-modules' \
RAG_TEST_DATABASE_URL="$DATABASE_URL" \
pnpm --filter @en/server exec jest \
  --config ./apps/ai/test/jest-e2e.json --runInBand rag-retrieval rag-access
```

Fixtures:

- User A and User B with distinct purchased courses, private wrong answers and summaries.
- Public synthetic word/grammar knowledge.
- One shared course Chunk purchased by A only.
- Matching cross-user canary phrases.
- Active, superseded, revoked and dimension-mismatched releases.

Required assertions:

1. Public results are available under valid source terms.
2. A sees A private results and A purchased-course results; B sees neither.
3. Tool/message/filter attempts to name another subject do not alter the server subject.
4. Unauthorized and nonexistent course/citation identifiers have indistinguishable public behavior.
5. Status, rights, version, dimension and access filters execute in the vector SQL before rows leave PostgreSQL.
6. Minimum relevance uses the approved normalized score; low results cannot fill Top K.
7. Duplicate content does not cross access scopes or consume multiple final ranks.
8. Unresolved structured conflicts do not enter factual model context.
9. Cancellation, token expiry or deletion before Prompt assembly discards late results.

Use `EXPLAIN (ANALYZE, BUFFERS)` only on synthetic/test data to record exact-query behavior. No performance target is approved until this baseline is reviewed.

## 9. Prompt, citation and injection tests

```bash
pnpm --filter @en/server exec jest --runInBand \
  rag-context rag-citations coach-prompts rag-injection-citation
```

Required assertions:

- Context includes only qualified results and remains under approved Token budget.
- Retrieved instruction text remains inside escaped untrusted data delimiters and cannot alter tool/identity/schema rules.
- Model output can reference only supplied `citationId` values.
- Fabricated ID, stale version, changed excerpt, inaccessible Citation, non-substring claim or invalid result path causes one controlled repair then safe degradation.
- Model-generated examples without source support are not labeled as retrieved examples.
- Server—not model—hydrates source/title/excerpt/locator.
- `insufficient` explicitly communicates lack of knowledge evidence; `failed` does not run factual exercise generation on failed materials.

## 10. Citation history and deletion tests

```bash
NODE_OPTIONS='--experimental-vm-modules' \
RAG_TEST_DATABASE_URL="$DATABASE_URL" \
pnpm --filter @en/server exec jest \
  --config ./apps/ai/test/jest-e2e.json --runInBand \
  rag-citation-history coach-retention rag-private-deletion
```

Required sequence:

1. Generate a v2 result with public, course and private citations.
2. Reload history as the same user; active cards resolve.
3. Revoke course access; course card becomes generic unavailable and reveals no locator/excerpt.
4. Supersede a public version; old citation remains bound to old version and becomes unavailable.
5. Delete private attempt/summary or Coach data; private release hides immediately.
6. Verify Citation excerpt cleared and affected Redis replay removed.
7. Run the due purge within the simulated 24-hour deadline; private Chunk/vector/summary/citation content is gone.
8. Confirm retained 180-day audit/Trace contains IDs/hashes/status only and no private content.

## 11. Trace and redaction tests

```bash
pnpm --filter @en/server exec jest \
  --config ./apps/ai/test/jest-e2e.json --runInBand \
  coach-observability rag-observability
pnpm --filter @en/server exec jest --runInBand coach-redaction rag-redaction
```

Expected RAG trace metadata:

```text
queryHash
appliedFilters (without identity)
sourceRightsSnapshotVersion
embeddingVersion / chunkingVersion / retrievalConfigVersion / indexVersion
rawCandidateCount / accessEligibleCount / relevanceEligibleCount
deduplicatedCount / contextSelectedCount
rank + normalized score + source category
conflict and dedup decisions
retrievalDurationMs / contextTokens / tokenCountMode
issuedCitationIds / usedCitationIds
retrievalStatus / safe failure code
```

Sensitive scans must find zero JWTs, refresh tokens, API keys, database URLs, original system Prompt, private documents, raw user IDs, other-user canaries, answer keys or stack traces.

## 12. RAG evaluation

Deterministic suite using fake embeddings:

```bash
pnpm --filter @en/server exec jest --runInBand \
  rag-case.schema rag-cases rag-rubric rag-metrics rag-report \
  rag-release-gate rag-run rag-trace-linker

pnpm --filter @en/server exec tsx apps/ai/test/evals/run.ts \
  --dataset rag-eval.synthetic.v1 \
  --mode deterministic \
  --output /private/tmp/en-learning-rag-eval.json
```

Candidate Provider/Coach suite is available through `runRagEvaluation` only when the caller supplies a test-only adapter plus an explicit approval ID, approved Provider state, credential-availability state and a positive request budget. The CLI intentionally refuses `--mode live` until such an adapter/approval is wired; therefore the following command is an expected fail-closed check in the current checkout:

```bash
pnpm --filter @en/server exec tsx apps/ai/test/evals/run.ts \
  --dataset rag-eval.synthetic.v1 \
  --mode live \
  --output /private/tmp/en-learning-rag-live-eval.json
```

Dataset coverage must include every FR-077 class and record allowed/forbidden source IDs, expected chunks, access scope, filters and all versions.

Report:

- Recall@K, Precision@K and MRR.
- Citation accuracy/coverage, answer faithfulness and unsourced-claim rate.
- First/final Schema pass rates.
- Cross-user leakage and Prompt Injection pass rate.
- P50/P95/max retrieval latency.
- Context tokens, total model/embedding tokens and versioned cost.
- Source-rights, Prompt, Embedding, Chunk, retrieval/index, result Schema, dataset and price versions.

Release is blocked by any safety failure or `pending_measurement` baseline. Average quality cannot offset a single privacy, authority or fabricated-citation failure.

## 13. Frontend and browser regression

```bash
pnpm --filter @en/web test:unit -- coach
pnpm exec playwright test coach-streaming
pnpm exec playwright test coach-environment
```

Expected:

- Active Citation cards show source, title, category, safe excerpt and supported claims.
- Duplicate source cards are grouped without deleting distinct claim links.
- Open action uses a code-owned route and a reauthorized resolver; arbitrary external URLs are never followed.
- Unavailable cards show the generic state and no stale content.
- SSE reconnect and durable request reads use the same v2 projection.
- Existing v1 history, cancellation, retry, exercise, grading, learning update and non-Coach pages remain functional.

## 14. Rollback rehearsal

In a disposable environment:

1. Set RAG read mode to off and confirm legacy `search_learning_materials` behavior returns without using knowledge tables.
2. Leave additive tables intact; do not reactivate revoked or deleted releases.
3. Confirm new requests no longer issue v2 citations while existing v1 history remains readable.
4. If an application version is rolled back, verify it ignores unknown v2 stored results safely rather than exposing raw JSON.
5. Record the rollback outcome in the release report.

Database object removal is not the primary rollback and must never be attempted as an emergency destructive step without a separately reviewed migration.

## 15. Final full-regression and known gates

Reproduce the final server and AI checks:

```bash
pnpm --filter @en/server exec jest --runInBand

NODE_OPTIONS='--experimental-vm-modules' \
RAG_TEST_DATABASE_URL="$DATABASE_URL" \
pnpm --filter @en/server exec jest \
  --config ./apps/ai/test/jest-e2e.json --runInBand

pnpm --filter @en/server build
pnpm --filter @en/web type-check
pnpm --filter @en/web test:unit -- coach
pnpm exec playwright test coach-streaming
pnpm exec playwright test coach-environment
```

Current known gates:

- `rag-v1-pending.json` remains `pending_measurement`; no quality, latency or cost target is approved.
- Live Embedding/Coach Provider evaluation remains unapproved and the CLI fails closed before network use.
- Production RAG, shadow, ingestion and private-content flags were not changed and remain an explicit future authorization.
- Production source-rights snapshots and field policies still require business/legal approval; synthetic test rights do not grant production use.
- Exact cosine is retained. No HNSW change is justified until a separately approved exact-vs-ANN recall/latency study exists.
- The implemented runtime fallback counts each UTF-8 byte as at most one token, but fallback mode is test/safety evidence only; production enablement still requires an approved model token-counter adapter and baseline.
- Queue lifecycle components are test-covered, but production scheduling/enablement remains deliberately absent while ingestion is off.
- This checkout began with package/config files untracked, so an empty `git diff` is not a complete provenance proof. During implementation no package manifest, lockfile, `.env`, `.env.production` or `ecosystem.config.js` was edited; `git diff` for those paths is empty and T018 independently recorded the same dependency guard.
- No commit, push or deployment was performed.

## Exit criteria

Implementation is eligible for an enablement decision only when:

- All rights, infrastructure, Provider and policy gates are explicitly approved.
- Migration/idempotency/lifecycle/access/citation tests pass on disposable infrastructure.
- Cross-user leakage, Prompt authority violations, fabricated/stale citations and Schema bypasses are all zero.
- Existing Coach and non-AI regressions are green.
- RAG baseline/report is reproducible and reviewed.
- Production configuration change, deployment and rollout receive separate user authorization.
