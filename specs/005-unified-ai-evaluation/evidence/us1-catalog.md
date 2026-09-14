# US1 catalog and registered test adapter evidence

Tasks T023–T029; requirements FR-002/003/005/006/008/009/011/031/036. These tasks are completed, not the whole US1 checkpoint.

- T023: 60 original Coach IDs, source hashes, tool expectations, all six rubric content hashes, category-specific original requirements and explicit v1 → v1/v2 validation prerequisite.
- T024: 20 retrieval, 6 lifecycle, 9 degradation, 7 personalization records. Expected-derived legacy measurements are explicitly `fixture_self_test_only`; actual retrieval and grounded-answer evidence remains missing.
- T025: 3 synthetic pronunciation descriptions retain audio/provenance/version metadata, with no claim of authorized real audio or independent human gold.
- T026: 18 main MCP records, 6 quiz records and 4 prompt records; 9 main positive/failure pairs. Codex, Claude Desktop, VS Code and Inspector require separate actual evidence.
- T027–T028: 133 unique namespaced case IDs with original IDs retained, source hash review, development split, frozen scope and change expansion. Qualification requirements cannot be reduced by filters.
- T029: registered suites use their original configurations and actual per-test output. Parameterized equal titles retain every occurrence, missing occurrences do not pass, and newly observed failures are included.

Validation:

1. Before detailed mappings were added, four mapping assertions failed because the mapping was absent; 10 existing assertions passed.
2. After implementation, module-adapters + scope-cli: 30 tests passed (2 suites).
3. A new duplicate-title test failed with DUPLICATE_JEST_MAPPING. After the parser correction, module-adapters + report: 21 tests passed (2 suites).
4. Before these final refinements, all 85 unified tests passed; final combined revalidation is recorded in us1-quick-run.md.

No new dependency, production configuration, paid Provider call, commit, push or deployment. Source provenance review authorizes only the pinned existing development fixtures. Missing quality metadata is exported explicitly; these tests do not certify real model or pronunciation quality.
