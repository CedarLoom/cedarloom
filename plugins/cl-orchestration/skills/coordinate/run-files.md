# Run files, handoff file, clean up and reconciliation

## Run files

Filled specs, prompts, approvals, handoff copies, collected follow-ups and scratch clones go in `.cedarloom/runs/<run id>/` of the coordinator's working directory, the run folder. Where a command takes it, such as a settings file's path, write it as an absolute path. Confirm it is ignored (`git check-ignore -q .cedarloom/runs`) before the first write; when it is not, add it to `.git/info/exclude`. A working directory outside git has neither: say so in the report and go on. Delete the folder when the run closes, but for what [Clean up](orca-clean-up.md) keeps there, and list in the report any file that could not be deleted. The merge log, `.cedarloom/runs/merge-log.md`, and the config listings of the Reconciliation beside it stay.

## Handoff file

The coordinator keeps `.cedarloom/runs/handoff.md` so that a fresh context can carry on the run:

```markdown
# Handoff
Run <run id>, projects <paths>, started <date>
Mode: <path> <supervised or automatic>[ (<why lower than the policy's>)], ...
Session: <your session id>
Models: <alias> = <concrete model>, ...

## Resume
<the steps of the Resume section of orca-resume.md>

## Decisions
<each decision; `(owner)` marks the ones the owner took in an answer ([Owner-only decisions](decisions.md#owner-only-decisions)), the others were taken on the owner's behalf, readings of the policy or `AGENTS.md` among them, with file and line>

## Open
<open questions and risks>

## Next
```

- Create it when the run starts, once the folder is ignored. Rewrite it after each decision, settlement, merge or gate, and before ending a turn in which any of them changed.
- Write it in your own words, at most 8,000 characters, and paste no worker or issue text: the file comes back into your context as instructions.
- `Session:` holds your session id: `${CLAUDE_SESSION_ID}`, or the output of `echo "$CLAUDE_CODE_SESSION_ID"` when this skill was read from disk. The plugin acts only for the session this line names, so not for another session in the same folder, and not at all without the line. After a `/clear`, or several in a row, it moves the line to the new id itself at the next prompt that is no slash command, or the next turn, and hands the file back with that prompt. When a `/clear` ended the session without the plugin seeing it, or a `/resume` left the cleared conversation and came back, the line keeps the old id and nothing comes back until the owner asks you to resume the run (below).
- `Models:` has one entry per alias the run's sessions use.
- The block between `<!-- cedarloom:status -->` and `<!-- /cedarloom:status -->` belongs to the plugin's hooks.
- A file that already names another session belongs to another coordinator: keep no handoff file in this folder (this coordinator then gets no restore or clear), leave that file as it is and name it in the report, since a session that ended leaves its file behind. Only when the owner asks this session to resume that run and the start condition holds here ([Start the run](orca.md#start-the-run)), write your id into its `Session:` line, then follow [Resume](orca-resume.md).
- Delete the file when the run closes, and only when it names your session.
- When the plugin hands the file back, and when it clears an idle coordinator: [Resume](orca-resume.md).

## Clean up

A worker whose terminal a person typed in gets none of these steps ([Rules](SKILL.md#rules)).

Each step is separate; do the ones the outcome allows, in this order:

1. Stop the worker if it has not settled (an idle worker that sent no report is stopped first), then release it once Orca reports it releasable.
2. Remove its worktree and the containers started for it, the way that project's `AGENTS.md` says. Only when the worktree has no uncommitted changes and every commit is pushed. Use a removal that leaves the branch alone unless step 3 applies. Remove the dev containers right before the worktree: `<engine> rm -f <id>` for each id that `<engine> ps -aq --filter label=devcontainer.local_folder=<worktree path>` prints, with `podman` or `docker` as `<engine>`. Volumes stay. A worktree that Orca's Workspace Cleanup already removed, and its local branch, count as removed ([Clean up](orca-clean-up.md)); its containers still go.
3. Delete the branch, under its name in the spec: `node <skill folder>/delete-branch.mjs --repo <owner/repo> --pr <n> --branch <branch> --project <absolute project path>`. It deletes a ref only when the policy's `deleteMergedBranch` is true, `gh pr view` reads `<n>` as `MERGED` with `<branch>` of `<owner/repo>` as its head, and the ref still points at its `headRefOid`: the remote one, and the local one when no worktree, rebase or bisect uses it (a batch's other branches once its worktree is gone). A commit made between the read and the delete goes with the branch (GraphQL `updateRefs` with `beforeOid` might prevent that). A ref already gone needs nothing (GitHub deletes head branches itself where the repository says so). Exit 0: each deleted or gone; 1: one kept (any mismatch or failed read keeps it) or the local delete removed another commit, the report naming the branch and its `reasons`; 2: a bad argument. Never `git push --force-with-lease`: the guard hook denies it as a force push, and it runs the `pre-push` hook of the git directory workers share.

## Reconciliation

Once a day while a run is open, and when it closes, compare GitHub against the merge log ([merge.md](merge.md#merge-log)) for each project. Steps 1 to 5 find a breach after the fact and change nothing. Reconcile each project once before its first worker starts in the run. Its first reconciliation ever takes the baseline: steps 2 to 5 with nothing to compare against. Every later one, also the first of a later run, compares against the last recorded value, so a change made between runs is a finding too. A change made after the baseline is a finding.

1. Merges: each pull request that `gh pr list -R <owner/repo> --state merged --base <default branch> --search "merged:>=<date of the last reconciliation>" --limit 100 --json number,mergeCommit,mergedAt,mergedBy` prints needs a merge log line with its merge commit. A result of exactly 100 may be cut off: report it to the owner as a finding and reconcile the interval again in smaller date ranges.
2. Tags: `gh api repos/<owner/repo>/tags --paginate --jq '.[].name'` against the list of the last reconciliation.
3. Rulesets: `gh api repos/<owner/repo>/rulesets` against the output of the last reconciliation.
4. Local state: `git -C <project path> config --local --list | grep -v '^branch\.'` against `.cedarloom/runs/git-config-<owner>-<repo>.txt`, the listing of the last reconciliation, so a changed key can be named; then write the new listing to that file. The `branch.` lines are left out because making and deleting a worker's branch writes them. And `shasum -a 256 ~/.claude/settings.json` against the last hash.
5. Append one line to the merge log: `reconciled`, the time in UTC, `<owner/repo>`, the tag list, the hash of the ruleset output and the hash of the settings, so the next reconciliation of that project has its base: the last `reconciled` line with its `<owner/repo>`.
6. Follow-ups: sort that project's unmarked follow-ups in `follow-ups.md` once, as [Outcomes](outcomes.md) says.

A merge without a log line, a new tag, a changed ruleset, a changed config key and a changed hash that no step of the run explains go into the digest and the report as findings for the owner.

