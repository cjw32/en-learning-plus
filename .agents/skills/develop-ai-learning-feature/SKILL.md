---
name: develop-ai-learning-feature
description: Implement or materially modify AI English-learning behavior in en-learning-plus. Excludes ordinary pages, CRUD, and discussion-only requests.
---

# Develop AI Learning Feature

Use this skill only for substantive implementation or modification of AI-powered English-learning behavior in `en-learning-plus`. Do not impose this workflow on excluded ordinary application work or requests that only ask for ideas, explanations, or architectural discussion.

## Establish the Repository Boundary

Read [references/project-context.md](references/project-context.md) before touching a repository.

- Work in the target repository identified there. Treat the original project as read-only reference material; never substitute it for the target or modify it.
- Locate an existing target checkout first. If none exists, obtain the exact target repository only when the active task authorizes that setup.
- Before editing, read applicable repository instructions and inspect Git status and relevant diffs. Preserve all user changes and avoid unrelated cleanup.

## Enforce Spec-Driven Development

For every substantive AI feature change, read and follow [references/sdd-development-rules.md](references/sdd-development-rules.md).

- Check for `.specify/` and `specs/` before planning implementation.
- Follow the current official GitHub Spec Kit workflow and existing project conventions. Do not code directly from an unrefined request.
- Reuse existing phase outcomes and update only affected parts; fixes already covered by the current specification may proceed to implementation and focused verification.
- Use exactly four required phases: **Specify → Plan → Tasks → Implement**. Keep requirement clarification, consistency checks, testing, evaluation, and gap closure inside these phases rather than adding workflow stages.
- Keep requirements, plans, tasks, code, tests, and AI evaluations traceable to each other. When requirements change, update Specify first, then Plan and Tasks before changing implementation.
- During Implement, verify the result against the specification and close remaining gaps. Without test or evaluation evidence, do not claim the feature is complete.

## Apply AI Engineering Guardrails

Apply these guardrails to affected capabilities; reuse current decisions and evidence for unchanged behavior.

- Design tool access with least privilege, explicit input validation, bounded retries and timeouts, and confirmation for consequential actions.
- Enforce user and tenant data isolation across retrieval, memory, checkpoints, traces, caches, and generated artifacts.
- Define and validate schemas for structured model outputs; handle invalid output and fallback behavior explicitly.
- Plan measurable evaluation, cost controls, latency budgets, model and prompt versioning, and privacy-aware observability before implementation.
- Treat vector RAG as ingestion, chunking, embedding, vector retrieval, grounding, and citation behavior. Do not label ordinary network search as vector RAG.
- Treat the English Learning MCP Server as a project capability with its own authenticated resource and tool contracts. Do not confuse it with Chrome DevTools MCP or other local development-tool configuration.

## Respect Authorization Limits

Installing dependencies already declared by the project is part of authorized local setup. Introducing new dependencies, pushing commits, or deploying services requires user authorization; reuse authorization already given in this session without asking again. Never expose or commit secrets or sensitive learner data.
