# Run files, clean up and reconciliation

## Run files

Filled specs, prompts, approvals, collected follow-ups and scratch clones go in `.cedarloom/runs/<run id>/` of the coordinator's working directory, the run folder. Where a command takes it, such as a settings file's path, write it as an absolute path. Confirm it is ignored (`git check-ignore -q .cedarloom/runs`) before the first write; when it is not, add it to `.git/info/exclude`. A working directory outside git has neither: say so in the report and go on. Delete the folder when the run closes, but for what [Clean up](orca-clean-up.md) keeps there, and list in the report any file that could not be deleted. The merge log and the config listings of the Reconciliation lie in the state folder, not in this one.

## Clean up

A worker whose terminal a person typed in gets none of these steps ([Clean up](orca-clean-up.md)).

Each step is separate; do the ones the outcome allows, in this order:

1. Stop the worker if it has not settled (an idle worker that sent no report is stopped first), then release it once Orca reports it releasable.
2. Remove its worktree and the containers started for it, the way that project's `AGENTS.md` says. Only when the worktree has no uncommitted changes and every commit is pushed. Use a removal that leaves the branch alone unless step 3 applies. Remove the dev containers right before the worktree: `<engine> rm -f <id>` for each id that `<engine> ps -aq --filter label=devcontainer.local_folder=<worktree path>` prints, with `podman` or `docker` as `<engine>`. Volumes stay. A worktree that Orca's Workspace Cleanup already removed, and its local branch, count as removed ([Clean up](orca-clean-up.md)); its containers still go.
3. Delete the branch, under its name in the spec: `node <skill folder>/delete-branch.mjs --repo <owner/repo> --pr <n> --branch <branch> --project <absolute project path>`. It deletes a ref only when the policy's `deleteMergedBranch` is true, `gh pr view` reads `<n>` as `MERGED` with `<branch>` of `<owner/repo>` as its head, and the ref still points at its `headRefOid`: the remote one, and the local one when no worktree, rebase or bisect uses it (a batch's other branches once its worktree is gone). A commit made between the read and the delete goes with the branch (GraphQL `updateRefs` with `beforeOid` might prevent that). A ref already gone needs nothing (GitHub deletes head branches itself where the repository says so). Exit 0: each deleted or gone; 1: one kept (any mismatch or failed read keeps it) or the local delete removed another commit, the report naming the branch and its `reasons`; 2: a bad argument. Never `git push --force-with-lease`: the guard hook denies it as a force push, and it runs the `pre-push` hook of the git directory workers share.

## Reconciliation

Once a day while a run is open, and when it closes, compare GitHub against the merge log ([merge.md](merge.md#merge-log)) for each project. Steps 1 to 5 find a breach after the fact and change nothing. Reconcile each project once before its first worker starts in the run. Its first reconciliation ever takes the baseline: steps 2 to 5 with nothing to compare against. Every later one, also the first of a later run, compares against the last recorded value, so a change made between runs is a finding too. A change made after the baseline is a finding.

1. Merges: each pull request that `gh pr list -R <owner/repo> --state merged --base <default branch> --search "merged:>=<date of the last reconciliation>" --limit 100 --json number,mergeCommit,mergedAt,mergedBy` prints needs a merge log line with its merge commit. A result of exactly 100 may be cut off: report it to the owner as a finding and reconcile the interval again in smaller date ranges.
2. Tags: `gh api repos/<owner/repo>/tags --paginate --jq '.[].name'` against the list of the last reconciliation.
3. Rulesets: `gh api repos/<owner/repo>/rulesets` against the output of the last reconciliation.
4. Local state: `git -C <project path> config --local --list | grep -v '^branch\.'` against `<state>/git-config-<owner>-<repo>.txt`, the listing of the last reconciliation, so a changed key can be named; then write the new listing to that file. The `branch.` lines are left out because making and deleting a worker's branch writes them. And `shasum -a 256 ~/.claude/settings.json` against the last hash.
5. Append one line to the merge log: `reconciled`, the time in UTC, `<owner/repo>`, the tag list, the hash of the ruleset output and the hash of the settings, so the next reconciliation of that project has its base: the last `reconciled` line with its `<owner/repo>`.
6. Follow-ups: sort that project's unmarked follow-ups in `follow-ups.md` once, as [Outcomes](outcomes.md) says.

A merge without a log line, a new tag, a changed ruleset, a changed config key and a changed hash that no step of the run explains go into the digest and the report as findings for the owner.

