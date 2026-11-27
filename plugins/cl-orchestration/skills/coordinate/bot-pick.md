# Project bot pick and start

The rules of the Pick and Start steps of [bot-project.md](bot-project.md), with its names.

## Pick

- Before the run's first start, run the visibility check of [Where it goes](approvals.md#where-it-goes) on the repository and give its warning when it is public.
- The pickable issues are the numbers the precheck prints (its head says what counts), never a listing of your own. An issue it prints in a `several projects:` line starts nowhere: report it for the owner.
- With a free slot, take up to `issuesPerWorker` of its numbers with no start or outcome yet in this run, in [pick order](policy.md#pick-order). Take one only where any of them is a research issue whose map `research` task is on `fable` ([Rules](SOUL.md#rules)), or the project runs automatic. They are one run's batch ([spec-variants.md](spec-variants.md#batches)).
- Read the issue's thread file (`Thread:` in [spec-template.md](spec-template.md)) and milestone before its spec, never its raw comments: one that defers, supersedes, rejects or delivers the work is an outcome, so report the issue for the owner and start nothing.
- An issue whose result you cannot state as a check from its text is an outcome too: report it for the owner and start nothing. One that is clear without naming a test starts.
- Estimate each issue's depth and decide its risk class ([Risk class](decisions.md#risk-class)). One that is deep or high is held there, takes no slot, and is skipped while its `design` approval is open ([approvals.md](approvals.md)).
- An issue is built once: a plan run does not count, a failed build retries once ([Outcomes](outcomes.md)), and a verified no-change issue that stays open without `closeIssue` is not picked again.

## Start

- **Branch.** Use an issue's branch in a command only when it is a plain name, as the `BRANCH` pattern of [merge-checks.mjs](merge-checks.mjs) requires: letters, digits, `.`, `_`, `/` and `-`, no `-` at the start, no `..`, not `HEAD`. Any other name starts nothing: report the issue for the owner.
- **Branch check.** Before each start, check the branch of each issue: `git -C <clone> ls-remote --heads origin <branch>`, `git -C <clone> worktree list` and `gh pr list -R <owner/repo> --head <branch> --state open --json number,isCrossRepository`. A row with `isCrossRepository` true does not count: anyone can open a pull request from a fork under that branch name. Where the branch or an open pull request for it exists, the spec's Branch line takes its existing-branch form ([spec-template.md](spec-template.md)).
- **`cl:in-progress`.** Right before a start, put `cl:in-progress` on each issue of its batch (`gh issue edit <number> -R <owner/repo> --add-label cl:in-progress`): an issue is never started twice. Where that edit fails, start nothing for the issue and report it for the owner. When the run's result is in, or the run stalled, take the label off each issue of its batch that has no PR, also where another issue of the batch has one ([Batches](spec-variants.md#batches)); an issue with a PR loses it once that PR is merged or closed unmerged. A BLOCKED issue, with a PR or without, gets `cl:needs-human` (`--add-label cl:needs-human`, in the edit that takes its label off where there is one), so the precheck holds it until the owner clears the block; where that edit fails, keep `cl:in-progress` on it and report it for the owner.
- **A fresh worker on a branch that exists** is a new start with `--spec-file`, its spec's Branch line chosen by the worktree:
  - In the worktree that holds the work, the gate form: a retry after a stop, an exit or a loss of a worker that took its task, a Failed retry, a Needs replan spec, the successor of a worker on `fable`. The earlier worker's last output or handoff goes under `Shared context:`. A worktree that does not have the branch checked out yet keeps the original line.
  - In a new worktree, the existing-branch form: no worktree left (`worker_workspace_gone`, or Workspace Cleanup removed it), a branch no run of this bot started.
