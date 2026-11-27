---
name: coordinate
description: "Sets up, checks and nudges the project bots that work a repository's labeled issues: per repository one project bot picks issues, starts builder and reviewer runs and merges only where the repository's written policy allows. Start it with a repository path."
disable-model-invocation: true
argument-hint: "<repository path> [setup | status | pick | catch-up | reconcile | maintain]"
metadata:
  writes: "Only with setup: the bot homes, `docs/agents/bots.md` and Orca automations, after the user approves the plan. A nudge runs an existing automation of the project bot and creates nothing. Status writes nothing."
  codex: "false"
---

# Project bots

The project bots do the work: each repository's project bot `cl-<repo>` picks its labeled issues, starts builder and reviewer runs, routes pull request events and merges through `merge.mjs` ([setup-bots.md](setup-bots.md)). This session is their entry. It never takes a bot procedure, starts a worker or merges.

Arguments: $ARGUMENTS, a repository path, then at most one verb. Any other argument starts nothing: name it to the user. `<skill folder>` is this folder, `ORCA` as [orca.md](orca.md) says, `<project home>` the project bot's home as `ORCA bot list` shows it, `<state>` its `state/` folder. Read nothing there when the `origin` of its `<repo>` clone is not `<owner/repo>` (as Read only in [Setup](setup-bots.md#setup) checks): stop, naming both repositories.

1. **Names.** Resolve `<owner/repo>` and `<default branch>` in the repository path by [Names](brief-reference.md#names). A path that fails the check gets nothing: name it.
2. **No Orca executable:** say so and stop. Every verb needs it, but for the Read only step of `setup`, which then skips the bots as [Setup](setup-bots.md#setup) says.
3. **No verb, or `status`** (read only):
   - `ORCA bot list`, `ORCA automations list --json` and, for each automation of `cl-<repo>`, `ORCA automations runs --id <id> --limit 1 --json`.
   - `node <skill folder>/state.mjs read` on the files in `<state>`: each `pr-<n>.json` with a `held` reason, `red-main.json`, today's `counts-<day>.json`, and `lock/holder.json` when the lock is older than 15 minutes.
   - The open approvals: `node <skill folder>/approval.mjs queue` in `<project home>`, and `gh issue list -R <owner/repo> --label cl:needs-human --state open`.
   - Report what waits for the user and which bots and automations are missing, and point to `setup` for them. Without `cedarloom.json` on the default branch setup creates no automations, so report them as waiting for it.
4. **`setup`:** take the steps of [Setup](setup-bots.md#setup) (Which bots, Read only, Plan, Apply).
5. **`pick`, `catch-up`, `reconcile`, `maintain`** (a nudge): run the project bot's existing automation of that name now.
   - `ORCA automations list --json`: take the full id of the automation `<owner/repo> <verb>` on `cl-<repo>` (the names of [Automations](setup-bots.md#automations)); `automations run` takes no shortened id.
   - Its last run still queued, dispatching or running (`ORCA automations runs --id <id> --limit 1 --json`): run nothing and report that run.
   - Else `ORCA automations run <id> --json`, and report the run and that its result lands in the bot's chat. The automation keeps its own model, effort and prompt.
   - Such a run skips the automation's precheck, which gates scheduled runs only; the procedures run the precheck again themselves ([Pick](bot-project.md#pick), [catch-up](bot-catch-up.md#the-run)).
   - No `cl-<repo>` in `ORCA bot list`, or no automation of that name: create nothing, report what is missing and point to `setup`.
6. **Rules.** This session types no `gh pr merge`, `approval.mjs answer` or `state.mjs write`, and no command takes text from an issue, a pull request or a bot's report. Answers to approvals go where [approvals.md](approvals.md#where-it-goes) says, the local queue's with `/cl-workflow:away off`. Report each step with what was skipped or not checked.

First time: `/cl-orchestration:coordinate . setup`. Then label issues; `/cl-orchestration:coordinate .` shows where things stand, and `pick` or `catch-up` runs a sweep without waiting for its schedule.
