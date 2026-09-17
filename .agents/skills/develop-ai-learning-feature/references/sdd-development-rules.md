# SDD Development Rules

Spec-Driven Development is a hard gate for substantive AI feature work. Use the current official [GitHub Spec Kit](https://github.com/github/spec-kit) tooling and the target repository's existing conventions to produce the four required phase outcomes below. Do not freeze possibly outdated CLI syntax into the implementation.

## Before the Four Phases

Apply only established constitution principles; placeholders and example comments are not policy. An unfilled constitution does not create an implementation gate.

- Locate or obtain the target repository, read its instructions, and inspect Git status and relevant diffs.
- Check `.specify/` and `specs/`. Reuse an existing setup; if absent, establish Spec Kit in the target repository through the current official process before coding. Installation of already-declared project dependencies is part of authorized local setup. Introducing new tooling or dependencies requires user authorization; reuse existing session authorization. Never initialize it in the read-only reference project.

## Required Development Chain

Use these four phase outcomes for substantive AI changes. Reuse existing outcomes and update only affected parts; do not regenerate unchanged documents:

**Specify → Plan → Tasks → Implement**

- **Specify:** Read applicable project principles; define user outcomes, requirements, non-goals, acceptance criteria, constraints, failure behavior, and measurable success criteria. Resolve material ambiguity about users, data ownership, privacy, model behavior, tool authority, edge cases, evaluation, and operational limits. Confirm that the specification is complete, unambiguous, testable, and safe before planning.
- **Plan:** Describe architecture, interfaces, data flow, schemas, retrieval or memory design, model and prompt strategy, tool permissions, failure handling, cost and latency budgets, observability, migrations, compatibility, and the test and AI evaluation approach. Check the plan against every requirement and resolve feasibility, coverage, or consistency gaps.
- **Tasks:** Produce ordered, actionable tasks with stable identifiers, dependencies, implementation scope, verification steps, and requirement links. Ensure the task set covers the full specification and plan before coding.
- **Implement:** Execute tasks within the user-authorized scope in dependency order, reusing existing session authorization while preserving user changes. Run specification-derived unit, integration, end-to-end, security, and AI evaluation checks appropriate to the change; capture commands, datasets, configurations, and results. Compare implementation and evidence with Specify, Plan, and Tasks, then fix remaining gaps or report them explicitly.

Use only these four named phases. Supporting checks or tool commands must belong to one of them and must not create additional mandatory workflow stages.

For a defect already covered by the current specification, proceed to implementation and focused verification using the existing plan and tasks; update affected tasks only as needed. New or changed requirements still need corresponding Specify, Plan, and Tasks updates. If the request is not substantive AI development, do not implicitly select this skill.

## Traceability and Change Control

- Maintain stable requirement identifiers and traceability for affected requirements; reuse existing links and add only the plan, task, implementation, test, and evaluation evidence relevant to the change.
- Keep acceptance criteria and evaluation thresholds in the specification rather than inventing them during implementation.
- When requirements change, return to Specify, then update Plan and Tasks before modifying implementation.
- Record deviations and unresolved gaps explicitly. Do not retrofit documentation to hide implementation drift.

## AI Quality and Safety Gates

Apply the following checks to capabilities affected by this change; reuse current evidence for unchanged behavior.

- **Tools:** Use least privilege, authenticated authorization, schema-validated inputs, bounded retries and timeouts, auditable calls, and confirmation for consequential actions.
- **Data isolation:** Apply user or tenant scoping to queries, vector retrieval, checkpoints, conversation memory, caches, traces, exports, and deletion behavior. Test for cross-user leakage.
- **Structured output:** Define versioned schemas, validate every model response, and specify retry, repair, rejection, and fallback behavior.
- **RAG and citations:** A vector RAG feature requires a corpus lifecycle, chunking, embeddings, vector storage and retrieval, access filtering, grounding, citations, freshness behavior, and retrieval evaluation. Network search alone is not vector RAG.
- **Evaluation:** Cover task quality, structured-output validity, retrieval and citation correctness, tool behavior, safety, regressions, and relevant learning outcomes with representative, versioned cases.
- **Cost and latency:** Define budgets before implementation and capture model, prompt, token, latency, retry, cache, and cost data needed to verify them.
- **Observability:** Trace model and prompt versions, retrieval, tool calls, failures, latency, tokens, and cost while redacting secrets and sensitive learner content.
- **MCP:** Define the English Learning MCP Server as project-owned tool and resource contracts with authentication, authorization, isolation, errors, and tests. Chrome DevTools MCP is development tooling and is not this server.

## Completion Evidence

A feature is not complete without evidence that its code satisfies the specification. Report exactly what was tested or evaluated, with the actual configuration and results. Never invent or extrapolate accuracy, quality, latency, cost, or business impact. If evidence is missing, stale, too small, or inconclusive, state that limitation and keep the work open or explicitly blocked.
