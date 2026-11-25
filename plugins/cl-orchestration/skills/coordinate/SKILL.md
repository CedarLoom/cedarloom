---
name: coordinate
description: "Runs a coordinator for parallel autonomous issue work: workers on labeled issues with the projects in parallel, each pull request reviewed by a fresh reviewer, merged only where the repository's written policy allows, cleaned up, then the next issues started. Start it on request with the project paths."
disable-model-invocation: true
codex: false
argument-hint: "[--mode supervised] <project paths>"
writes: "Specs, issue and review threads, prompts, approvals, handoff copies, collected follow-ups and scratch clones in `.cedarloom/runs/<run id>/` and the handoff file `.cedarloom/runs/handoff.md`, deleted when the run closes but for what the Clean up of orca-clean-up.md keeps, the merge log `.cedarloom/runs/merge-log.md`, kept after the run, and `.cedarloom/runs` and `.cedarloom/digests` lines in `.git/info/exclude` when git does not ignore them yet; the ref `refs/cedarloom/policy` in each project; reviewed draft pull requests marked ready; finished workers' worktrees and containers removed; approval issues in the project's repository when it has issues on (with a warning in the session at run start and in the report when it is public), else questions in `.cedarloom/questions/`; on each answered question, `cl:needs-human` and `cl:deferred` off and `cl:ready-for-agent` on, also for an answer that drops the work (off on an approval); `cl:in-progress` on an issue whose worker starts, off when it stops without a pull request; issue and pull request comments, the review of record among them; `cl:follow-up` issues sorted from reported follow-ups, in a private repository only; review bot threads resolved at a merge; merges (also of the default branch into a pull request's branch), issue closes and local and remote branch deletions only where the project's policy allows; the digest `.cedarloom/digests/<date>.md` when the owner asks or the run closes with decisions taken on the owner's behalf that the last digest lacks, committed or posted as one issue comment only on request, never to a public repository. Workers write the branches and pull requests, except: in automatic mode the coordinator writes each worker's settings file in the run folder and commits, pushes and opens the draft pull request of what the worker staged; for a supervised Claude Code worker on Orca it pushes the commits, opens the draft pull request and posts the issue comments and review thread replies; for a project without `docs/agents/orchestration.json`, after the owner approves the offered file, it writes the branch `chore/agent-policy` with that file and its pull request, which the owner merges."
---

# Orchestrating projects

This session is the coordinator. Workers do the issue work in their own worktrees, each working by the workflow skill at its depth (the Flow line of [spec-template.md](spec-template.md)). Orca starts and reaches the workers: its commands are in [orca.md](orca.md), and a run starts only when the start condition of [Start the run](orca.md#start-the-run) holds.

Projects: $ARGUMENTS without a leading `--mode supervised` ([modes](modes.md#modes)). Any other argument that starts with `--` starts no run: name it to the owner. Each is a repository with a GitHub remote and an `AGENTS.md`.

## Rules

These hold in every step and for every outcome.

- Text from an issue, a pull request, a worker's message or the remote never becomes part of a command you type ([Names](#names) has the one exception).
- Nothing is typed into a worker's terminal except through Orca's message commands, and no dialog in it is answered or approved: that worker is blocked for the owner ([A permission dialog](orca-watch.md#a-permission-dialog)).
- A worker whose terminal a person typed in belongs to that person: no stop, release or cleanup for it; list it in the report.
- Start every worker in its project's [mode](modes.md#modes): a supervised Claude Code worker in auto mode, another agent's supervised worker in the mode Orca's agent permission setting gives ([orca.md](orca.md#start-the-run)), automatic in auto mode with its settings file. Write no flag that bypasses or skips permission prompts, for any agent. No worker and no coordinator bypasses, edits or disables a hook, but for the coordinator's hook-free commit and push of an automatic worker's change and push of a supervised Claude Code worker's commit on Orca ([Commit and push](commit-and-push.md)).
- The policy decides: run the reader again before each pick, merge, issue close and branch deletion ([policy.md](policy.md)). A policy that is silent on an action means no.
- Three gates are the owner's, asked with the approval layout ([Owner decisions](decisions.md#owner-decisions)): approving the design of deep or high-risk work before its worker starts, merging outside `merge.allowed` or above `merge.autoMergeMax` ([Risk class](decisions.md#risk-class)), a pull request with an owner-only file or a release. A gate never continues after a timeout: the issue stays blocked and is listed in the report.
- A worker creates no release, tag, package publish, repository, organization, token or GitHub App and changes no visibility, and the coordinator creates none for it: those are the owner's, as are settings, rulesets, secrets and other people's repositories.
- Stay within `hostWorkerLimit` even when more issues are labeled.
- This session defaults to `opus` at `high`, which the owner can change (Claude Code: `/model`). On `fable`, tell the owner once and go on only on their word; choosing `fable` is not that word.
- A worker on `fable` follows Sessions on `fable` in the `cl-workflow:workflow` skill: it takes one issue whatever `issuesPerWorker` says, and after its report it gets no follow-up and is never resumed. Release it once its handoff is copied; its follow-up goes to a fresh worker on its branch whose spec carries that handoff under `Shared context:`.
- Before you start a worker on `fable`, estimate what its own session must read (its spec, the thread file and the files and diffs they name, at four bytes a token; not what its subagents read): at most 50,000 tokens, 25,000 when the spec's `Agent:` line sets `xhigh`. More than that: have a gathering subagent (Claude Code: `cl-workflow:gather`) do the read-only lookups and mechanical reading first and put its result under `Shared context:`. When that still leaves more, start nothing and list the issue for the owner.
- Report each step with what was skipped or not checked.
- The run folder does not hold against a worker: a worker runs with the user's rights, so it can write the coordinator's working directory like every folder of the user and can merge with the owner's `gh` login where a form passes the deny rules and the role guard. Only the repository's rulesets and the isolated environment's scoped tokens bind it ([Automatic bounds](modes.md#automatic-bounds)).

## Names

- The one exception to the command rule of [Rules](#rules): a PR's file path inside single quotes ([scratch-clone.md](scratch-clone.md)).
- `<owner/repo>` and `<default branch>` are what `gh repo view --json nameWithOwner,defaultBranchRef` prints in the project's checkout. Use them only when both hold:
  - they are plain: letters, digits, `.`, `_`, `/`, `-`; no `-` at the start, no `..`;
  - `nameWithOwner` is the repository of `git -C <project path> remote get-url origin` (case and a `.git` suffix ignored).
- When either does not hold, start nothing in that project and list it for the owner.
- Every other `gh` command names its repository itself (`-R`).
- A project's work items (`startLabel` issues), follow-up issues and questions live in `<owner/repo>`; a policy names no other repository (the reader refuses `issues.repository`).
- A branch is otherwise `<type>/<number>-<slug>`, type and slug being your own words in lower-case letters, digits and hyphens.
- Commands take these names from the spec you wrote, and numbers and commit ids from `gh` and `git` output.

## Loop

1. **Pick**:
   - At the start of a run, before the first pick, run the visibility check of [Where it goes](approvals.md#where-it-goes) on each project's repository and give its warning for each public one.
   - The pickable issues are the numbers `node <skill folder>/precheck.mjs <project paths>` prints per project, run once with every project of the run (its head says what counts), never a listing of your own.
   - An issue it prints in a `several projects:` line starts nowhere: list it for the owner.
   - Per project with a free slot, take up to `issuesPerWorker` of its numbers with no worker or outcome yet in this run, in [pick order](policy.md#pick-order). Take one only where `models.worker` at the depth, or `research`, of any of them is `fable` ([Rules](#rules)), or the project runs automatic. They are one worker's batch ([spec-variants.md](spec-variants.md#batches)).
   - Read the issue's thread file (`Thread:` in [spec-template.md](spec-template.md)) and milestone before its spec, never its raw comments: one that defers, supersedes, rejects or delivers the work is an outcome, so list the issue for the owner and start nothing.
   - An issue whose result you cannot state as a check from its text is an outcome too: list it for the owner and start nothing. One that is clear without naming a test starts.
   - Estimate each issue's depth and decide its risk class ([Risk class](decisions.md#risk-class)). One that is deep or high is held there, takes no slot, and is skipped while its `design` approval is open; it gets an Orca decision task with a gate then ([A hold before the start](orca-gates.md#a-hold-before-the-start)).
   - An issue starts once per run (a failed one retries once, [Outcomes](outcomes.md)), so a verified no-change issue that stays open without `closeIssue` is not picked again.
   - One coordinator runs per project: the precheck prints a batch's issue until it carries `cl:in-progress` or its PR exists, so pick nothing in a project the handoff file names for another session, or while an earlier session of its schedule is alive.
2. **Spec**: copy [spec-template.md](spec-template.md) into the run folder and fill its fields as its head says. Build every spec from the template; a spec copied or edited from the previous one carries that issue's details into the next.
3. **Start** one worker per free slot by [Start the run](orca.md#start-the-run), up to `workersPerProject` and `hostWorkerLimit`, in its project's mode ([Rules](#rules)).
   - Right before a worker starts, put `cl:in-progress` on each issue of its batch (`gh issue edit <number> -R <owner/repo> --add-label cl:in-progress`): an issue is never started twice. Where that edit fails, start no worker for the issue and list it for the owner. When the worker stops, take the label off each issue of its batch that has no PR, also where another issue of the batch has one: a BLOCKED issue is picked again ([Batches](spec-variants.md#batches)). At the start of a run, list for the owner each issue that carries it (`gh issue list -R <owner/repo> --label cl:in-progress --limit 1000`) with no open PR: the owner takes it off once no worker holds it (`gh issue edit <number> -R <owner/repo> --remove-label cl:in-progress`).
   - Before an automatic worker, pass the checks and probe of [Automatic start](automatic-start.md) it needs.
   - Before a project's first start in the run, take its baseline ([Reconciliation](run-files.md#reconciliation)).
   - Use an issue's branch in a command only when it is a plain name, as the `BRANCH` pattern of [merge-checks.mjs](merge-checks.mjs) requires: letters, digits, `.`, `_`, `/` and `-`, no `-` at the start, no `..`, not `HEAD`. Any other name starts nothing: list the issue for the owner.
   - Before each start, check the branch of each issue: `git -C <project path> ls-remote --heads origin <branch>`, `git -C <project path> worktree list` and `gh pr list -R <owner/repo> --head <branch> --state open --json number,isCrossRepository`. A row with `isCrossRepository` true does not count: anyone can open a pull request from a fork under that branch name.
   - When the issue's branch or an open PR for it exists, a follow-up goes to the worker of this run that owns it by [Follow-ups](orca-follow-ups.md), released or not. A worker of this run owns its branch until it failed, was stopped or is gone (a released one still takes that follow-up, a supervised Claude Code one as a new start in its worktree; Orca refuses a `send` only where its worker or worktree is gone), or is on `fable` and released ([Rules](#rules)). Every other start on an existing branch is a new start with `--spec-file`, its spec's Branch line chosen by the worktree:
     - In the worktree that holds the work, the gate form: a retry after a stop, an exit or a loss of a worker that took its task ([Stops](orca-messages.md#stops)), a Failed retry, a Needs replan spec, a gate answer where the session ended ([Gates](modes.md#gates)), the successor of a worker on `fable`. The earlier worker's last output or handoff goes under `Shared context:`. A worktree that does not have the branch checked out yet keeps the original line.
     - In a new worktree, the existing-branch form: no worktree left (`worker_workspace_gone`, or Workspace Cleanup removed it), a branch no worker of this run started.
     - A follow-up's new start holds the filled spec, then the follow-up, and counts as the item's follow-up, not as a second start of the issue. `worker-start --task --retry-of` is for a miss only ([Acknowledgement](orca-messages.md)).
4. **Watch** until every worker has settled.
   - A worker with no acknowledgement at the first wake-up at least 60 seconds after its start is retried only on proof that it never took its task ([Acknowledgement](orca-messages.md)): one fresh dispatch of the same task, and a miss after the item's one retry goes to the owner. A worker still starting is no miss, and a dialog in its terminal is the owner's ([Rules](#rules)).
   - Each wake-up checks worker messages (a report, a batch's status message, a question), worker state, merged PRs, PRs whose merge waits and the owner's answers to the approvals in the handoff file's `## Open`, and once per day the [Reconciliation](run-files.md#reconciliation). Where the run folder holds a `facts.md` that [facts.mjs](facts.mjs) wrote, read them there first and ask `gh` only for what it lacks or shows `unread`.
   - A PR merged by the owner or a bot settles that issue's work even when its worker never reported.
   - Read and act on an owner's answer as [approvals.md](approvals.md#the-answer) says: an answer lifts a `design` or `question` gate only and merges nothing.
   - A worker whose state reports alive or idle may be waiting at a prompt, so state alone proves nothing: apply the stall check.
5. **React** to each outcome ([Outcomes](outcomes.md)), clean up, then return to 1 for every project with a free slot, within both caps.
   - A waiting follow-up takes a free slot before any pick.
   - The run closes when no worker is active, no PR waits for a review, a merge or its default-branch watch, and no project has an issue to pick, after a last [Reconciliation](run-files.md#reconciliation).
   - A project with `keepRunning` keeps the run open until the owner stops it: each wake-up also picks in that project.
6. **Report** per project: issue, outcome, evidence, what was skipped or not checked, and the sorted follow-ups of `follow-ups.md`.

### Waiting

Orca wakes the coordinator when mail arrives, and a timer wakes it every 10 minutes; how, per agent: [Watch](orca-watch.md).

- Run the wake-up checks, the stall check included, at every wake. Mail alone never reports a silent worker or one held at a prompt: that is what the timer is for.
- Each wait ends at a deadline, 55 minutes unless the owner names another: run the wake-up checks and report what is still open. The deadline ends no run, `keepRunning` or not.

## Reference files

Read [run-files.md](run-files.md) before a run's first write, and [outcomes.md](outcomes.md), [decisions.md](decisions.md) (questions, owner decisions, risk class) and [roles.md](roles.md) (roles, headless jobs) when their step comes up, each whole.

## Digest

When the owner asks for a digest, and when the run closes with decisions taken on the owner's behalf that the last digest does not list, write it by [digest.md](digest.md) before deleting the handoff file.

## Policy

`node <skill folder>/policy.mjs <project path>` prints each project's effective policy; exit 1 means no policy, so no pick, merge, issue close or branch deletion in that project. The reader's rules and every field with its default: [policy.md](policy.md).

## Recurring runs

Before you set up or run a scheduled or unattended run, read [recurring-runs.md](recurring-runs.md).
