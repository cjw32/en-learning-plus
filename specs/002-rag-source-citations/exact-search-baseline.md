# Exact Cosine Search Baseline

**Feature**: `002-rag-source-citations`  
**Date**: 2026-09-08  
**Decision state**: exact cosine remains the approved implementation; no HNSW index or dependency was added

## Environment

- Host: Darwin 25.5.0, arm64
- Database: PostgreSQL 17.11, aarch64
- pgvector: 0.8.6
- Container image: `pgvector/pgvector:pg17`
- Storage/network: disposable tmpfs and loopback-only test port
- Database: `en_learning_plus_rag_rehearsal_a`
- Index policy: `exact-cosine.v1`
- Embedding: deterministic 8-dimensional synthetic vectors, `embedding.fake.8d.v1`

No production content, user identity, Provider call, network corpus, or approved latency objective was used.

## Fixed synthetic dataset

| Item | Count |
|---|---:|
| Active public chunks and READY embeddings | 5,000 |
| Relationally eligible (`PUBLIC`, source, `WORD_MEANING`, `B1`, active versions) | 1,000 |
| Relevance-qualified at normalized score ≥ 0.65 | 1,000 |
| Final Top K | 20 |
| Unauthorized/private rows admitted | 0 |

The other 4,000 rows used a different category/level and were removed by relational filters before vector scoring. All returned Top-20 rows belonged to the authorized eligible set, so observed Precision@20 was 1.0 for this filter fixture. This is a performance/plan-shape baseline, not a claim of general retrieval quality.

## Query shape

The measured query used the repository's permission-first structure:

1. materialized eligible CTE joins active Source, Release, Document, Chunk and READY Embedding;
2. access, source, category, CEFR, embedding version/dimension and retrieval/index versions filter before scoring;
3. exact `<=>` cosine distance is normalized to [0,1];
4. minimum relevance filters scored rows;
5. deterministic score/ID ordering returns Top 20.

## `EXPLAIN (ANALYZE, BUFFERS)` observations

- Planning time: 0.466 ms
- Execution time: 3.750 ms
- Eligible CTE actual rows: 1,000
- Final rows: 20
- Shared buffer hits: 3,192 at the final limit
- Chunk filtering used `KnowledgeChunk_category_level_idx` via bitmap index scan
- Embedding lookup used `KnowledgeEmbedding_version_dimensions_status_chunk_idx`
- Final order used a 27 kB Top-N heapsort
- No approximate vector index appeared in the plan

The full plan was observed directly in the disposable database. It showed category/level filtering before 1,000 indexed embedding lookups and exact scoring.

## Repeated latency

Thirty warm/local executions of the same query produced nearest-rank wall-clock measurements:

| Runs | Min | P50 | P95 | Max |
|---:|---:|---:|---:|---:|
| 30 | 2.898 ms | 2.983 ms | 9.877 ms | 19.915 ms |

These values are evidence for this fixed local environment only. They are not a production SLO and are not approved release thresholds.

## Decision

Keep `exact-cosine.v1`. There is no approved scale/latency target and no paired exact-vs-ANN recall/latency experiment showing that approximate search is necessary. Introducing HNSW would be a separate, explicitly reviewed performance change with recall comparison, migration/rollback evidence and no contract drift.
