---
name: "speckit-implement"
description: "Execute the implementation plan by processing and executing all tasks defined in tasks.md"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/implement.md"
---

When reading the constitution, apply only established project principles. Unfilled placeholders and example comments are not policy; if none are established, report that briefly and skip constitution gates.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before implementation)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_implement` key
- If hooks are configured for this stage, read and follow [shared hook rules](../references/spec-kit-hooks.md).

## Outline

1. Run `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` from repo root and parse FEATURE_DIR and AVAILABLE_DOCS list. All paths must be absolute. For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. **Check relevant checklist status** (if FEATURE_DIR/checklists/ exists):
   - Read relevant checklist markers and report unchecked items; do not change reviewer-owned markers.
   - `checklists/requirements.md` is maintained by `$speckit-specify` and `$speckit-clarify`; custom checklist markers represent requirements review, not implementation completion.
   - Unchecked items alone do not block implementation. Pause dependent work only for a material unresolved issue affecting this change or an explicit human approval gate.
   - Reuse existing authorization to proceed; do not ask again unless the scope or blocking issue materially changes. Continue independent authorized work while a required decision is pending.

3. Load and analyze the implementation context (reuse context already read; load only sections needed for the selected tasks):
   - **REQUIRED**: Read tasks.md for the complete task list and execution plan
   - **REQUIRED**: Read plan.md for tech stack, architecture, and file structure
   - **IF EXISTS**: Read data-model.md for entities and relationships
   - **IF EXISTS**: Read contracts/ for API specifications and test requirements
   - **IF EXISTS**: Read research.md for technical decisions and constraints
   - **IF EXISTS**: Read .specify/memory/constitution.md for governance constraints
   - **IF EXISTS**: Read quickstart.md for integration scenarios

4. **Project Setup Verification**:
   - Update ignore files only when this change introduces tooling, generated artifacts, or a publishing workflow that needs them; otherwise reuse existing configuration.
   - When an ignore-file change is necessary, consult [ignore patterns](references/ignore-patterns.md) for the relevant technology only. Preserve deliberate tracked examples and project conventions.

5. Parse tasks.md structure and extract:
   - **Task phases**: Setup, Tests, Core, Integration, Polish
   - **Task dependencies**: Sequential vs parallel execution rules
   - **Task details**: ID, description, file paths, parallel markers [P]
   - **Execution flow**: Order and dependency requirements

6. Execute implementation following the task plan:
   - **Phase-by-phase execution**: Complete each phase before moving to the next
   - **Respect dependencies**: Run sequential tasks in order, parallel tasks [P] can run together
   - **Follow TDD approach**: Execute test tasks before their corresponding implementation tasks
   - **File-based coordination**: Tasks affecting the same files must run sequentially
   - **Validation checkpoints**: Verify each phase completion before proceeding

7. Implementation execution rules:
   - **Setup first**: Initialize project structure, dependencies, configuration
   - **Tests before code**: If you need to write tests for contracts, entities, and integration scenarios
   - **Core development**: Implement models, services, CLI commands, endpoints
   - **Integration work**: Database connections, middleware, logging, external services
   - **Validation**: Run checks required by the affected behavior and acceptance criteria. Add performance optimization or documentation only when required by this change.

8. Progress tracking and error handling:
   - Report progress after each completed task
   - Diagnose and fix failures caused by this change, then rerun affected checks. Pause tasks dependent on the failure and continue independent authorized work.
   - Report a blocker only when a user decision, missing external prerequisite, or lack of further progress prevents completion; do not repeat an unchanged failing attempt.
   - For parallel tasks [P], continue with successful tasks, report failed ones
   - Provide clear error messages with context for debugging
   - Suggest next steps if implementation cannot proceed
   - **IMPORTANT** For completed tasks, make sure to mark the task off as [X] in the tasks file.

9. Completion validation:
   - Verify all required tasks are completed
   - Check that implemented features match the original specification
   - Validate that tests pass and coverage meets requirements
   - Confirm the implementation follows the technical plan

Note: This command assumes a complete task breakdown exists in tasks.md. If tasks are incomplete or missing, suggest running `$speckit-tasks` first to regenerate the task list.

## Mandatory Post-Execution Hooks

**You MUST complete this section before reporting completion to the user.**

Check if `.specify/extensions.yml` exists in the project root.
- If it does not exist, or no hooks are registered under `hooks.after_implement`, skip to the Completion Report.
- If it exists, read it and look for entries under the `hooks.after_implement` key.
- If hooks are configured for this stage, read and follow [shared hook rules](../references/spec-kit-hooks.md).

## Completion Report

Report final status with summary of completed work.

## Done When

- [ ] All tasks in tasks.md completed and marked `[X]`
- [ ] Implementation validated against specification, plan, and test coverage
- [ ] Extension hooks dispatched or skipped according to the rules in Mandatory Post-Execution Hooks above
- [ ] Completion reported to user with summary of completed work
