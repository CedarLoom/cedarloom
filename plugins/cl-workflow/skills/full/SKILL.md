---
name: full
description: "Plans, builds, tests, reviews and security-checks one software change at deep depth, then opens its pull request and watches its checks."
disable-model-invocation: true
argument-hint: "<task>"
when: "On request, for a software change you want run at deep depth with its round limits held by a workflow script."
writes: "The depth and risk lines, a plan file outside the repository, the change's commits on a branch and its pull request in the project's convention."
---
<!-- Generated from definitions/full.json by generator/generate.mjs: edit the definition, not this file. -->

# Full

Typed as `/cl-workflow:full <task>`. No task given and none open in the conversation: ask for it, or without terminal questions stop and say it is missing.

1. Where the skill `cl-workflow:workflow` is not installed or its load is refused, say so and stop.
2. Load the skill `cl-workflow:workflow` and run its step 1 with the kind fixed: software change. The depth is at least deep; its rules may raise it. Write the `Depth:` and `Risk:` lines before the first edit or command.
3. Resolve the run's `args` by that skill's software change and deep playbooks: `task`, the task in one paragraph with the issue or spec reference when one exists; `overrides`, phase id to `{ model, effort, recheckModel }`, only where the rules for risky changes, a spec's Flow line, the user or the recheck rule differ from the table below (a phase run beside another and a plan check take the override of the phase they follow unless they have their own); `trial`, true for a risky change.
4. Run the stages below in order: each session phase here, and the agent phases of each stage as one start of the workflow `cl-workflow:full-run` through the Workflow tool, with those `args` and `stage` set to the stage's id.
   - A plan the task brought: pass its path as `planPath`; the stage that plans then only checks it, and its findings go to the plan's author as the plan check step of the playbook says. Where it carries `Plan check: passed` or names another independent check, skip that stage. After that stage, save its `plan` outside the repository, add `Plan check: passed (cl-workflow:verify)` when it is done, settle its questions, and pass the plan's path as `planPath` from then on.
   - A stage that stops for failed tests: fix them by the playbook, then start the stage again with `from` set to the phase its reason names. Any other stop: run the rest of that stage as prose by the playbooks, counting the rounds the run returned; findings left after the last round are a question for the user.
   - Where the Workflow tool is missing, turned off, or denied in a run without a user: run the same phases as prose by the playbooks and say so. Where the user answers No when asked to approve the run: stop.

| Stage | Phase | Runs | Model | Effort | Rule |
|---|---|---|---|---|---|
| plan | settle | session: step 2 (Settle) of `cl-workflow:workflow` |  |  |  |
| plan | plan | `cl-workflow:plan` | opus | the agent file's | fixes the findings of `plan-check` |
| plan | plan-check | `cl-workflow:verify` | opus | the agent file's | fixed by `plan`, 1 round, re-checked by `cl-workflow:verify` |
| build | settle-plan | session: step 2 (Settle) of `cl-workflow:workflow` |  |  |  |
| build | implement | `cl-workflow:implement` | opus | the agent file's | fixes the findings of `review` |
| build | test | `cl-workflow:test` | sonnet | the agent file's |  |
| build | review | `cl-workflow:review` | opus | the agent file's | fixed by `implement`, 2 rounds and one more on the stronger step, re-checked by `cl-workflow:recheck` |
| build | audit | `cl-workflow:review` | opus | the agent file's | once, beside the first `review`; its Blocking and Important findings join that loop. Brief: Security pass only, read-only: trust boundaries, authentication, permissions, secrets and input handling of the diff. |
| build | pull-request | session: the pull request by step 3 of `cl-workflow:workflow`, with the Minor findings of the runs, then its checks watched as step 5 says |  |  |  |
