# Project Context

## Canonical Locations

- Target remote repository: `https://github.com/cjw32/en-learning-plus.git`
- Recommended local checkout: `/Users/woofeel/Downloads/en-learning-plus`
- Original project, read-only reference: `/Users/woofeel/Downloads/en-learning`
- Repository-level skill location in the recommended checkout: `/Users/woofeel/Downloads/en-learning-plus/.agents/skills/develop-ai-learning-feature`

Work only in a verified checkout of the target repository. Never modify the original project, use it as the implementation target, or migrate it implicitly.

## Repository Discovery

At the start of a future implementation task:

1. Check the recommended target path, then locate any other existing checkout if needed.
2. Verify the checkout's Git remote matches the canonical target repository.
3. Read applicable repository instructions, Git status, and relevant diffs. Consult manifests, architecture, `.specify/`, and `specs/` only as needed for the affected behavior; reuse context already verified in this task.
4. If the target is unavailable, obtain the canonical repository only within the active task's authorization. Do not fall back to editing the original reference project.

This skill is repository-scoped and should be used from a verified checkout of the target repository. Reconfirm the target at task start; recheck other repository facts when the task or observed changes make them relevant.

## Observed Reference Stack

The following stack was observed in the original project and is context, not a contract for `en-learning-plus`:

- pnpm workspace with application, server, and shared-package areas
- Vue, Vite, TypeScript, Pinia, Element Plus, and Tailwind CSS on the web side
- NestJS and TypeScript services, including a separate AI application
- Prisma with PostgreSQL
- LangChain, DeepSeek integration, and PostgreSQL-backed LangGraph checkpoint support
- Redis and BullMQ for queues, MinIO for object storage, and Socket.IO for real-time communication

Inspect the target repository before choosing integration points, versions, packages, schemas, commands, or deployment assumptions. Prefer its current architecture and conventions over patterns from the reference project.
