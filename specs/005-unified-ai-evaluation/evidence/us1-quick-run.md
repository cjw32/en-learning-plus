# US1 implementation checkpoint — offline evidence

Date: 2026-09-14. Completed tasks: T001–T029 (29/105). US1 as a whole remains in progress. T030–T040 are not marked complete merely because the provisional quick entry point runs.

## Validated results

- Unified tests: 10 suites, 94 tests passed; no skipped unified tests.
- Server build: passed using the existing Nest/TypeScript configuration.
- Actual CLI all-module quick/check: 141 planned items, 141 completed, 141 passed, 0 failed/error/skipped/not-run. This consists of 133 legacy fixture-contract checks, 7 registered business suites, and 1 positive assurance case.
- Registered suites contain 52 actual existing Jest tests. These execute existing business code with the declared controlled dependencies; they are not 52 real-model quality samples.
- The same complete bundle passed the CLI verify operation without repeating business calls.
- Four separately filtered module runs passed; their explicit business-regression filters are retained below. These do not claim the complete per-module default dataset was independently rerun.
- End-to-end tests establish: valid Coach result PASS; invalid Coach schema FAIL; fabricated RAG citation FAIL; invalid MCP tool FAIL; invalid filter and missing qualification prerequisites INCOMPLETE; changed result/attempt evidence fails verification; repeat evidence remains distinct.
- Explicit restricted-resource database test inventory: 3 pre-existing RAG database tests skipped for missing isolated database configuration; excluded from the offline quick scope, not counted as passed.
- External Provider calls: 0. Actual Provider token/price observations are unavailable; no production cost, latency or quality baseline is inferred.

## Reproducible run evidence

Runtime artifacts below are local temporary files; the IDs, hashes and counts are retained here for auditing.

### quick/check:coach,rag,pronunciation,mcp

- Run: `run-d0efa64a-21b9-4fca-bd78-1641999be77f`
- Path: `/private/tmp/run-d0efa64a-21b9-4fca-bd78-1641999be77f`
- Gate: PASS; planned/completed/passed: 141/141/141; existing Jest assertions: 52.
- Report SHA-256: `3fc9d5c57a8a78e34cf7301029b2df2182a042b409cbbe5b47123923c605133a`
- Bundle SHA-256: `5ffba5639c706290b53f5a7172ab87331bef84e239a03f733c7239b721cdac3e`
- Candidate tree: `e852a4e7702ebbeec64d62c9c6a1a8d7af5dbd58ae99b871766bde653c8320ef`
- Control hash: `3ea0511657396c8262591a8c6564e0e43f5d09fe4b534cda69f440243d88ff5d`
- Arguments: `["run", "--modules", "all", "--output", "/private/tmp"]`

### quick/check:coach

- Run: `run-d6f21c96-673e-4fe4-b5fb-e164e96517e6`
- Path: `/private/tmp/run-d6f21c96-673e-4fe4-b5fb-e164e96517e6`
- Gate: PASS; planned/completed/passed: 2/2/2; existing Jest assertions: 7.
- Report SHA-256: `716aff92b8fd5c8e137f056bcb01b57c18a1eea952eadb7a9851b171c80c8d12`
- Bundle SHA-256: `0c135e70d28d3557789c0c7edff21387242f3cfcece7da76c0c18cfb4ffc6a95`
- Candidate tree: `e852a4e7702ebbeec64d62c9c6a1a8d7af5dbd58ae99b871766bde653c8320ef`
- Control hash: `3ea0511657396c8262591a8c6564e0e43f5d09fe4b534cda69f440243d88ff5d`
- Arguments: `["run", "--modules", "coach", "--tag", "business-regression", "--output", "/private/tmp"]`

### quick/check:rag

- Run: `run-a560f0a3-8429-4fd8-bd02-2b16134fa881`
- Path: `/private/tmp/run-a560f0a3-8429-4fd8-bd02-2b16134fa881`
- Gate: PASS; planned/completed/passed: 1/1/1; existing Jest assertions: 3.
- Report SHA-256: `63efea222a09ff873a611f41a2074d31326ce02076b883e6e9a2da5861bcd8b2`
- Bundle SHA-256: `c9e2f903fb8f72cdd11971d654be1d83ed9f4a50fd12b86c433299b5ed7bf1a7`
- Candidate tree: `e852a4e7702ebbeec64d62c9c6a1a8d7af5dbd58ae99b871766bde653c8320ef`
- Control hash: `3ea0511657396c8262591a8c6564e0e43f5d09fe4b534cda69f440243d88ff5d`
- Arguments: `["run", "--modules", "rag", "--tag", "business-regression", "--output", "/private/tmp"]`

### quick/check:pronunciation

- Run: `run-41fb85ad-bd0c-4f15-9188-8763b7ddc71f`
- Path: `/private/tmp/run-41fb85ad-bd0c-4f15-9188-8763b7ddc71f`
- Gate: PASS; planned/completed/passed: 2/2/2; existing Jest assertions: 18.
- Report SHA-256: `191dee9b68d3b40c67fc17afb0ed24bb8c4cde44185f146bdc1625ae0d863bd0`
- Bundle SHA-256: `34d65efc9202c0b2ac4461d6be2710c8cb16748629282ac5962b6fcb1ff5b5dc`
- Candidate tree: `e852a4e7702ebbeec64d62c9c6a1a8d7af5dbd58ae99b871766bde653c8320ef`
- Control hash: `3ea0511657396c8262591a8c6564e0e43f5d09fe4b534cda69f440243d88ff5d`
- Arguments: `["run", "--modules", "pronunciation", "--tag", "business-regression", "--output", "/private/tmp"]`

### quick/check:mcp

- Run: `run-bb10d50f-3b2d-4a0f-a883-2f791239500c`
- Path: `/private/tmp/run-bb10d50f-3b2d-4a0f-a883-2f791239500c`
- Gate: PASS; planned/completed/passed: 2/2/2; existing Jest assertions: 24.
- Report SHA-256: `6d5039d927f94baaeeec7aa8420ae99b395c4908bfbc6dacee456b09de3ef633`
- Bundle SHA-256: `22b9f5051ae974fa662a29d6132bb188d6aefa0aa97381746eaf3c0180d92dfc`
- Candidate tree: `e852a4e7702ebbeec64d62c9c6a1a8d7af5dbd58ae99b871766bde653c8320ef`
- Control hash: `3ea0511657396c8262591a8c6564e0e43f5d09fe4b534cda69f440243d88ff5d`
- Arguments: `["run", "--modules", "mcp", "--tag", "business-regression", "--output", "/private/tmp"]`

## Corrections verified in this checkpoint

- Detailed catalog mapping: four expected RED assertions, then GREEN.
- Parameterized equal Jest titles: a failing regression test, then occurrence-preserving mapping; new unregistered failures remain visible.
- Contradictory passed state with failure/incomplete/review reasons: three RED assertions, then non-PASS decisions.
- Hash digit strings were wrongly detected as phone numbers by the reused redactor. A failing regression test reproduced the report-write failure; complete cryptographic identifiers are now excluded from that text scan, while actual phone text remains rejected.
- Report Markdown is text and results are line-delimited JSON. Attempt files, observations, frozen manifest and control evidence are included in bundle hashes. Pending registries are real empty artifacts, not references to nonexistent files.

## Remaining implementation — not external prerequisites alone

- T030–T033: generic typed business ports and existing-suite execution are present, but the complete dedicated evaluation composition and per-call observation for Coach Executor/tools, RAG ingestion/vector/grounded-answer, pronunciation Azure/audio/storage/finalize, and MCP capabilities remain unfinished.
- T034–T035: synthetic record/replay has three passing tests; approved real-content retention and complete coordinator replay dispatch remain unfinished.
- T036–T039: provisional scope, report, run/inspect/verify work; complete Trace/usage integration, configured profiles, trusted-control separation, replay, full-mode and complete independent verification still need implementation.
- T040: current end-to-end evidence is useful but dependencies above prevent marking the US1 task/checkpoint complete.
- T041–T105: comparison, scoring/calibration, full gates/CI, recovery/client sessions, Skill integration, data lifecycle and full acceptance remain pending. No later phase was marked complete.
- G-01–G-05 remain closed for the relevant real executions. Code still to be written is distinguished from missing external authorization/resources.

## Workspace protection and hooks

- Initial branch: codex/english-learning-mcp; initial HEAD b9bad65167091662a34056626e8c621e466f08d5.
- Of 1,040 pre-existing files, only tasks.md received the requested completion-state edits; no pre-existing files disappeared. All other implementation files/evidence are additions.
- No new dependency, lockfile change, production configuration, commit, push or deployment.
- No .specify/extensions.yml exists; no after_implement hook is registered.
