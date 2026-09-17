---
name: "speckit-plan"
description: "Execute the implementation planning workflow using the plan template to generate design artifacts."
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/plan.md"
---

When reading the constitution, apply only established project principles. Unfilled placeholders and example comments are not policy; if none are established, report that briefly and skip constitution gates.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before planning)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_plan` key
- If hooks are configured for this stage, read and follow [shared hook rules](../references/spec-kit-hooks.md).

## Outline

1. **Setup**: Run `.specify/scripts/bash/setup-plan.sh --json` from repo root and parse JSON for FEATURE_SPEC, IMPL_PLAN, SPECS_DIR, BRANCH. For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. **Load context**: Read FEATURE_SPEC and `.specify/memory/constitution.md`. Load IMPL_PLAN template (already copied).

3. **Execute plan workflow**: Follow the structure in IMPL_PLAN template to:
   - Fill Technical Context (mark unknowns as "NEEDS CLARIFICATION")
   - Fill Constitution Check section from constitution
   - Evaluate gates (ERROR if violations unjustified)
   - Phase 0: Resolve material unknowns; reuse existing decisions and update research.md only when new research is needed
   - Phase 1: Create or update data-model.md, contracts/, and quickstart.md only where this change needs new or revised content; reference unchanged documents
   - Re-evaluate Constitution Check post-design

## Mandatory Post-Execution Hooks

**You MUST complete this section before reporting completion to the user.**

Check if `.specify/extensions.yml` exists in the project root.
- If it does not exist, or no hooks are registered under `hooks.after_plan`, skip to the Completion Report.
- If it exists, read it and look for entries under the `hooks.after_plan` key.
- If hooks are configured for this stage, read and follow [shared hook rules](../references/spec-kit-hooks.md).

## Completion Report

Command ends after Phase 1 design. Report branch, IMPL_PLAN path, and generated artifacts.

## Phases

### Phase 0: Outline & Research

1. Identify unresolved questions that materially affect this plan. Reuse repository decisions for unchanged dependencies and integrations; do not create a research task for every technology.
2. Research only those questions. Use subagents only for independent research where the expected benefit justifies delegation and delegation is available and authorized.
3. Record new decisions, rationale, and relevant alternatives in `research.md`. Reuse existing research when sufficient; if no research is needed, note this briefly in the plan without creating an empty artifact.

**Output**: Material unknowns resolved, with references to reused or updated research as applicable.

### Phase 1: Design & Contracts

**Prerequisites:** Material design unknowns resolved, using existing decisions or new research as needed.

1. **For new or changed entities**, update `data-model.md` (otherwise reference the existing model):
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Define interface contracts** (only for new or changed external interfaces) → `/contracts/`:
   - Identify what interfaces the project exposes to users or other systems
   - Document the contract format appropriate for the project type
   - Examples: public APIs for libraries, command schemas for CLI tools, endpoints for web services, grammars for parsers, UI contracts for applications
   - Skip if project is purely internal (build scripts, one-off tools, etc.)

3. **Create or update the quickstart validation guide only for new or changed validation scenarios** → `quickstart.md`:
   - Document runnable validation scenarios that prove the feature works end-to-end
   - Include prerequisites, setup commands, test/run commands, and expected outcomes
   - Use links or references to contracts and data model details instead of duplicating them
   - Do not include full implementation code, model/service/controller bodies, migrations, or complete test suites
   - Keep this artifact as a validation/run guide; implementation details belong in `tasks.md` and the implementation phase

**Output**: Relevant updated design artifacts and references to reused documents; omit inapplicable artifacts.

## Key rules

- Use absolute paths for filesystem operations; use project-relative paths for references in documentation
- ERROR on gate failures or unresolved clarifications

## Done When

- [ ] Plan workflow executed and relevant design artifacts updated or reused
- [ ] Extension hooks dispatched or skipped according to the rules in Mandatory Post-Execution Hooks above
- [ ] Completion reported to user with branch, plan path, and generated artifacts
