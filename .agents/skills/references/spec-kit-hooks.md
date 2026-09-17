# Spec Kit Hook Rules

Use only when the calling skill's stage has configured hooks in `.specify/extensions.yml`. Preserve the stage and `hooks.before_*` / `hooks.after_*` key specified by the caller. Read the configuration once per invocation unless it changes.

- If the file or stage has no hooks, skip silently. If YAML is invalid, report the configuration problem briefly and continue work that does not depend on hooks.
- Ignore hooks with `enabled: false`; otherwise treat them as enabled. Execute hooks only when `condition` is absent, null, or empty. Leave non-empty conditions to the HookExecutor; do not interpret them yourself.
- Hooks inherit the user's authorized scope and the calling skill's write restrictions. A mandatory flag does not authorize new external actions or override read-only / append-only constraints. Skip incompatible hooks and report the reason. Reuse existing authorization for compatible actions; ask only for genuinely missing authorization.
- Optional hooks (`optional: true`) are suggestions unless already requested by the user. Mention the command and purpose without creating an approval wait.
- For mandatory hooks (`optional: false`) within scope, invoke the available skill or tool and wait for its result before dependent work. Emitting `EXECUTE_COMMAND` text alone is not execution. Translate dotted skill command IDs to hyphens where needed (for example `speckit.git.commit` to `speckit-git-commit`). Do not invent an unavailable command.
- On failure, diagnose and repair within the authorized scope, then retry only when something relevant has changed. Continue independent work; report a blocker if a required dependency is unavailable or no further progress is possible. Do not start unbounded hook cycles.
- Report the main outcome before offering post-hook suggestions. Distinguish completed core work from failed, skipped, or blocked hooks; a failed required hook must not be reported as successful completion.
