---
name: lite
description: "Runs a one-sentence software change with its checks, without the workflow skill, a plan, subagents or review."
disable-model-invocation: true
argument-hint: "<task>"
when: "On request, for a change whose diff fits in one sentence."
writes: "The depth and risk lines, the change's commit, and a pull request only where the project requires one."
---

# Lite

Typed as `/cl-workflow:lite <task>`. No task: ask for it, or without terminal questions stop and say so.

1. **Gate.** On any of these, say which, load the skill `cl-workflow:workflow` (missing or refused: stop) and run it from its step 1:
   - more than a one-sentence diff, or unsure;
   - a bug, a review-thread follow-up, a log line that logs user data, any dependency change (a dependency major or security advisory too);
   - any migration (a schema migration too), infrastructure as code, CI, a performance change, a refactor across modules or with a changed interface, any changed interface;
   - authentication, permissions, secrets, input validation, production data, deploy or production configuration, an irreversible action;
   - a file under `riskyPaths` in `cedarloom.json` as the default branch has it;
   - a depth or `Depth minimum:` line above quick, or a risk above low.
2. **Lines.** Before the first edit: `Depth: quick (lite: <change type>)`, `Risk: low (<reason>)` and the done check (typo: docs build; config value: tests, schema or lint; UI tweak: browser check, screenshot baselines updated only for intended changes).
3. **Edit**, with fast checks (types, lint, the touched code's tests) after each edit.
4. **Verify**: build, types, lint and tests as `AGENTS.md` says, and the done check.
5. **Commit** in the project's convention, else Conventional Commits; a pull request only where required.
6. **Report** each check's command and result, "steps skipped: plan, subagents, review" and what was not checked.

Stop and report when the same check fails twice with the same error, or a fix needs wider scope, a weakened test or a new dependency. Work that grows into the gate: stop and leave lite as step 1 says.

Keep validation at trust boundaries, error handling that prevents data loss, and security checks.
