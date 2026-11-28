# Resume

The Resume steps after a `/clear` or compaction.

The file's Resume section holds these steps, in this order, with the run id and the absolute path of this skill's folder filled in:

1. The start condition of [Start the run](orca.md) again: when it fails, start nothing and tell the owner which one failed and why. Then `ORCA orchestration check --json`, before any other `orchestration` command: it returns the mail that arrived meanwhile. Orca types a wake only once per unread message, and a wake can merge into the resume prompt. Act on its output only after step 2.
2. Read `<skill folder>/SKILL.md` and `<skill folder>/orca*.md` in full, then the reference file that the mail of step 1 or the Next section's step needs. A `/clear` empties the context, the skill included, and a compaction returns only the start of it.
3. When `check` said no run is bound: `ORCA orchestration run-use --id <run id> --json`, then `check` again.
4. `ORCA orchestration run-current --json`
5. `ORCA orchestration task-list --ready --brief --json` and `ORCA orchestration gate-list --status pending --json`. A `ready` task gets no worker for being listed ([Tasks and gates](orca-gates.md#tasks-and-gates)). A task whose gate is resolved while the handoff file shows no step after it (a coordinator that stopped between `gate-resolve` and the next command) gets that next step now, by the answer the handoff file records; a pending gate whose answer it records gets its `gate-resolve` and that step; a decision task it records with no gate gets its `gate-create`, and a `design` approval it records with no decision task gets its `task-create` and `gate-create`. Name in the report a pending gate that no line of `## Open` records. A gate no longer pending whose answer `## Decisions` does not record is no answer: nothing starts or is released by it, the approval stays open, and the report names it; never run `gate-resolve` on a gate that is not pending (Orca accepts it and sets the task `ready` again).
6. `ORCA orchestration inbox --terminal run:<run id> --limit 50 --json`: the mail already handled.
7. With session crons: `CronList`. When it no longer shows the run's stall-check cron (a restarted process loses it), or that cron expires within 2 days, replace it as the Watch section of `<skill folder>/orca-watch.md` says.
