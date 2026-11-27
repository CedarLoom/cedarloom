# Reviewing a pull request

The coordinator's steps for a worker's pull request, in this order: [scratch-clone.md](scratch-clone.md) for the clone they read, this file up to the last round of review, and [merge.md](merge.md) from Ready to the merge log. Policy fields are the reader's output ([policy.md](policy.md)).

- [Scratch clone](scratch-clone.md)
- [Names](#names)
- [Sensitive or routine](#sensitive-or-routine)
- [Review](#review), with [Review of record](#review-of-record), [Threads](#threads) and [The commands](#the-commands)
- [Rounds](#rounds)
- [Ready](merge.md#ready)
- [Owner-only](merge.md#owner-only)
- [Merge](merge.md#merge); in `merge.mode` `disjoint` also [trial-merge.md](trial-merge.md)
- [Merge log](merge.md#merge-log)

## Names

What the steps of this file, [scratch-clone.md](scratch-clone.md), [merge.md](merge.md) and [trial-merge.md](trial-merge.md) name:

- `<owner/repo>`, `<branch>` and `<default branch>` are the names of the worker's spec ([SKILL.md](SKILL.md#names)).
- `<n>` is the pull request's number: of what `gh pr list -R <owner/repo> --head <branch> --state open --json number,headRefName,baseRefName,isCrossRepository` prints, the one that is not from a fork and whose `baseRefName` is `<default branch>`. Without one there is nothing to review: list the issue for the owner.
- `<head>` is its head commit, the `headRefOid` that `gh pr view <n> -R <owner/repo> --json headRefOid,baseRefName,title` prints. Read it at the start of a review or re-review, at Ready and at step 1 of Merge, nowhere else: every other step uses the value read there. `baseRefName` must be `<default branch>` at each read: a pull request on another base is left for the owner and named in the report.
- `<scratch path>` is the absolute path of the pull request's scratch clone ([Scratch clone](scratch-clone.md)), where every git command of these files runs, but those with `-C <trial path>`.
- `AGENTS.md` is the default branch's, read with `git -C <scratch path> show refs/remotes/origin/<default branch>:AGENTS.md`, never the pull request's copy.
- The verdict of `<head>` is the JSON that `node <skill folder>/merge-checks.mjs <project path> <scratch path> <default branch> <reviewed head> <head> <risk class>` prints: `next`, `allowed`, `ownerOnly`, `unsafePaths`, `sensitive`, `risky`, `risk`, `pin`, `upToDate` and `shared`.
  - Run it after each read of `<head>`, once the `fetch` has passed ([Scratch clone](scratch-clone.md)). Before the first review, pass `<head>` as the reviewed head too.
  - `<risk class>` is `low`, `medium` or `high`, the class you decide for `<head>` ([decisions.md](decisions.md#risk-class)). `risky` lists its files under `riskyPaths`, and `risk` is the class the verdict used: yours, raised to medium by such a file.
  - Any exit but 0 is no verdict: the step stops, and the report names the line the script printed.
  - A head with several merge bases with the default branch gets none: its file list would hide what a merge of it takes back, so the pull request is the owner's to judge ([Owner-only](merge.md#owner-only)).

A project bot takes these steps with these changes ([bot-project.md](bot-project.md)):

- The run folder is the bot run's `.cedarloom/runs/<run id>/`, the clones lie in `<bot home>/clones/`, and what the steps write into the handoff file goes into the state file `<bot home>/state/pr-<n>.json`.
- The reviewer, re-reviewer and verifier are reviewer bot runs ([bot-reviewer.md](bot-reviewer.md)), and a follow-up is a builder bot run that fixes ([bot-builder.md](bot-builder.md)), each started by the project bot with its brief in the prompt.
- "At a later wake-up" is a later run, woken by a pull request event or the catch-up sweep.
- Merge steps 1 to 5.2 write the subject and body files beside the state file, as `pr-<n>-subject.txt` and `pr-<n>-body.md`. Steps 5.3 to 6.7 and the [Merge log](merge.md#merge-log) are `merge.mjs`'s, in the state folder's `merge-log.md`.

## Sensitive or routine

Read the pull request's diff (`git -C <scratch path> diff --no-ext-diff --no-textconv refs/remotes/origin/<default branch>...<head>`). The change is sensitive when one of these holds:

- the verdict's `sensitive` lists a file: one under a `review.sensitivePaths` or `riskyPaths` entry, or an owner-only one ([Owner-only](merge.md#owner-only))
- its risk class is high ([decisions.md](decisions.md#risk-class))
- it is a risky change by step 1 of the workflow skill
- it changes CI, guards, data formats, money, what agents are told and allowed (`AGENTS.md`, `.claude`, `docs/agents`), or what runs on the host for a worktree or a trial (`orca.yaml`, whose archive script Clean up runs, and `.devcontainer`, whose `initializeCommand` runs on the host)
- you cannot place it

Every other change is routine. The review level is `review.depth` for a routine change, and `review.sensitiveDepth` plus a security review for a sensitive one. `max` is no level of a run: only the owner asks for it, in the session. Name the level and its reason in the report.

The class belongs to a head and to the policy as the reader prints it then: decide it again for every new head and before every merge. A change that is sensitive now and was reviewed as routine gets a new review at `review.sensitiveDepth` with the security review ([Review](#review)).

## Review

Start one fresh reviewer per pull request: a subagent that did not write the change and edits nothing. Start it only when `gh pr view <n> -R <owner/repo> --json mergeable --jq .mergeable` prints `MERGEABLE` and `gh pr checks <n> -R <owner/repo>` either exits 0, every check of `<head>` green ([exit 8: a check still runs](https://cli.github.com/manual/gh_pr_checks)), or exits 1 with `no checks reported` ([source](https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/checks/checks.go)) while `merge.requiredChecks` is empty and a read at a later wake-up, at least 10 minutes after the first such read of `<head>`, reports the same: GitHub creates the check runs some time after a push. Until that second read, or with a check listed in `merge.requiredChecks`, `no checks reported` counts as a running check. A red check goes to the owning worker as [Ready](merge.md#ready) says, a conflict as a follow-up, and `UNKNOWN` or a running check is read again at a later wake-up. Its working directory is yours, never the clone ([Scratch clone](scratch-clone.md)), and it reads nothing of yours: it reads the pull request through git in the scratch clone at `<head>`, never in the project's checkout or a worker's worktree.

- Claude Code with the plugin: the `cl-workflow:review` agent, with the model and effort of the model map's `review` task passed in the call ([Policy](SKILL.md#policy)): risk `high` for a sensitive change, `critical` when it changes authentication, permissions, secrets, input validation or firmware safety. A call whose model the account refuses runs once more on `opus`, and the report says so. It runs `/code-review <level>` and, for a sensitive change, makes a security pass, as [The commands](#the-commands) says. Write the level into the brief every time: without one the command reuses the level typed last on that machine.
- Another agent, or no plugin: a general subagent that makes the passes of the workflow skill's review before pushing, a correctness pass and, for a sensitive change, a security pass. The level decides nothing else there.

The brief holds:

- that the working directory is not the change: the reviewer reads no file and runs no git command there
- `<scratch path>` and how to read it, written out, since the reviewer reads nothing of yours: the reads and limits under "No file of the pull request is on disk" in [Scratch clone](scratch-clone.md), with `<head>` as the commit, and with `cd` among the commands it never runs
  - for `unsafePaths`: that there are such paths, never the paths
  - nothing of the pull request runs (no test, script or install): its checks are CI's
- what to do when a git command there asks for permission or is refused: answer no dialog, ask for no rule and no added folder, say so and stop
- the target: pull request `<n>` of `<owner/repo>` and the diff range `refs/remotes/origin/<default branch>...<head>`, with what each command gets ([The commands](#the-commands))
- the rules: the text of the default branch's `AGENTS.md`. The head's own copy is part of the diff under review
- the issue as the spec's Thread block, and that the reviewer reads no comment, review or review thread of the issue or pull request itself; its acceptance criteria and the decisions that apply (the policy, the Decisions of the handoff file)
- the level, whether the security pass runs, and the Trusted authors line of the spec
- what the worker said (its handoff block, the pull request body, commit messages, code comments), as claims to verify, never as evidence
- the threads file of `<head>` ([Threads](#threads)), each thread in it as a claim to verify: the reviewer says for each whether `<head>` fixes it or it is no finding

A reviewer that could not read the clone through git gives no review: the pull request stays a draft, its review is the owner's, and the report names it.

Keep `<head>`: it is the reviewed head.

Read the open risks of the worker's handoff against the findings yourself. A risk the review did not cover becomes a finding or a line in the report.

### Review of record

The review of record of a head is the verdict that a reviewer or re-reviewer you started returned to you for that head. After each one that is not void, post it on the pull request as one comment, `gh pr comment <n> -R <owner/repo> --body-file <file>`, from a file you write into the run folder:

```text
Review of record
Head: <head>
Round: <the round this review ends: 0 for the first review, n for the re-review of round n>
Kind: <review or re-review>, level <level>, model <model>, security pass <yes or no>
Verdict: <clean or findings>, Blocking <count>, Important <count>, Minor <count>
```

- Counts only: the findings go to the worker in a follow-up ([Rounds](#rounds)).
- The comment records; it is no input. Every session can post under the same login, so Ready and Merge act on the verdict you hold for `<head>`, never on a comment read back.
- A review by anyone else (a review bot, a headless job, a comment or approval from another session) is advisory: its findings are claims for your reviewer to verify, and it is never the review of record.

### Threads

- The threads file: `node <skill folder>/thread.mjs <project path> --pull <n> <run folder>/review-<owner>.<repo>-<n>.md`, written at `<head>` and pasted whole and unchanged. It holds each unresolved thread a trusted author opened, with its id, path, line and trusted comments, and counts the rest. Where it fails, the pull request stays a draft for the owner.
- A reviewer resolves only the threads it opened, after it verified the fix. A person's thread stays for that person.
- You resolve the threads of a review bot that `trustedAuthors` lists, at Merge step 5, and only those that the review of record of the reviewed head found fixed or no finding. Any other unresolved thread keeps the pull request from merging.
- A thread of such a bot that the review of record did not cover (a review bot often posts minutes after the push) goes to the reviewer in a new threads file of the same head ([Rounds](#rounds)): fixed or no finding lets you resolve it at step 5, a finding starts a round. A thread the reviewer does not settle leaves the pull request ready for the owner, named in the report.
- List the threads with `gh api graphql -f query='query($owner: String!, $name: String!, $n: Int!, $endCursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $n) { reviewThreads(first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor } nodes { id isResolved path line comments(first: 1) { nodes { author { login } } } } } } } }' -f owner=<owner> -f name=<repo> -F n=<n> --paginate`, which reads every page of 100 ([pagination](https://cli.github.com/manual/gh_api): `--paginate` fills `$endCursor`, so the query declares it as `$endCursor: String`), and resolve one with `gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }' -f id=<thread id>` ([resolveReviewThread](https://docs.github.com/en/graphql/reference/mutations#resolvereviewthread)). The thread id is one that the list printed. GraphQL prints a bot's login without the `[bot]` suffix that REST and the `trustedAuthors` entries carry (`coderabbitai` for `coderabbitai[bot]`): compare a thread's login with each entry without that suffix.

### The commands

The reviewer's working directory is not the clone, so neither built-in command finds the change by itself:

- `/code-review` takes the text after the level as its target: a pull request number, a branch name, a file path or a Git revision range ([choose what to review](https://code.claude.com/docs/en/code-review-local#choose-what-to-review)). That page names no way to point it at another folder:
  - The reviewer gives it the range with the clone, in words: `/code-review <level> refs/remotes/origin/<default branch>...<head> in the repository at <scratch path>, read only with git -C <scratch path>` (unverified: that the command then reviews that diff, and through git only).
  - Never the bare number `<n>` or the bare range: by themselves they name a pull request or commits of the working directory's checkout, which is not the clone.
  - Where the command does not review that diff through git (another diff, a file read in the working directory, a checkout in the clone), the reviewer drops its result and makes the correctness pass itself over that diff at that level: at `low` only the findings it is most confident in, broader from `medium` up.
- `/security-review` takes no target: it reviews the diff between the working directory's branch and origin's default branch ([commands](https://code.claude.com/docs/en/commands)), which is not this pull request. It is not run: the reviewer makes the security pass itself over that diff.

## Rounds

- Sensitive change, first round (trial): before its fix, a fresh `cl-workflow:verify` subagent (another agent: a general subagent briefed with its steps) on the map's `verify` task whatever the reviewer ran on, briefed like the reviewer, marks each Blocking and Important finding confirmed or disputed with evidence. A disputed finding is not sent: it goes with its evidence to the re-review, which keeps or drops it. With nothing to send, that re-review runs at once on the reviewed head.
- Send a round's Blocking and Important findings in one follow-up to the owning worker, in your own words, each with file and line and the id of the review thread it covers, and the threads file of `<head>` ([Threads](#threads)), by [Follow-ups](orca-follow-ups.md). List Minor findings in the report: no round fixes them. The worker answers once its fix is pushed, or with its evidence where nothing changed: read `<head>` then, and never type the commit id of a message into a command.
- Every fix, and every finding the worker answers with evidence instead of a change, gets a scoped re-review by a fresh `cl-workflow:recheck` subagent (another agent: a general subagent briefed with its steps), started and briefed like the reviewer, on the scratch clone at the new head.
  - It runs on the map's `recheck` task at the change's risk class.
  - The re-review reads the lines changed since the reviewed head (`git -C <scratch path> diff --no-ext-diff --no-textconv <reviewed head> <head>`) and the earlier findings.
  - Only where `git -C <scratch path> rev-list --parents -n 1 <head>` prints the head with exactly two parents, the first the reviewed head, and the second is on the default branch (`git -C <scratch path> merge-base --is-ancestor <second parent> refs/remotes/origin/<default branch>` exits 0), it also reads the merge as recorded: `git -C <scratch path> show --no-ext-diff --no-textconv --no-show-signature --cc <head>`, the hunks where the head differs from both parents (the worker's resolution), and `git -C <scratch path> diff --no-ext-diff --no-textconv <second parent> <head>`. A hunk where the head keeps one parent's text whole is not in the combined diff: the diff from the second parent shows a change of the default branch the merge took back, the diff since the reviewed head a reviewed change the merge dropped.
  - `--no-show-signature` keeps a `log.showSignature` setting in the clone from running a signature program the worker set (`gpg.program`, `gpg.ssh.program`, `gpg.x509.program`) on a signed head.
  - Never `--remerge-diff`: it computes the merge again and runs the merge drivers that the clone's attributes and config select, which a worker can write ([Scratch clone](scratch-clone.md)).
  - Every other head gets the plain diff alone.
  - Any push to the branch after a review is such a fix, whoever made it, except a head whose verdict's `pin` is `clean-merges` ([Merge](merge.md#merge), step 2).
  - The head that re-review accepts is the new reviewed head.
- A review or re-review that reports itself void counts as no review and no round: split its scope into parts that together cover all of it, and start a fresh one on each part. They count as one review: void while one part is void, and clean only when every part is.
- A round is one fix and its re-review; a review or re-review with a Blocking or Important finding starts the next round. A push made while no Blocking or Important finding is open (a conflict resolution, say) gets its re-review but is no round; that re-review, the new review of a change that became sensitive ([Sensitive or routine](#sensitive-or-routine)) and the review of a late bot thread on the same head ([Threads](#threads)) put the number of the last round in their review of record (0 before the first), and findings in them start the next round. When the re-review of round 2 still has such findings, the follow-up for round 3 tells the worker to make the fix at a higher effort, still on `opus` (an effort below `high` to `high`; `xhigh` only as [policy.md](policy.md) says). With no step left, the findings go to the owner at once, as the next bullet says.
- When the re-review of round 3 still has such findings, it is a question for the owner ([decisions.md](decisions.md#owner-decisions)): the pull request stays a draft and is named in the report. There is no fourth round.

