# Worker spec variants

The lines of [spec-template.md](spec-template.md) that change for an automatic worker or a supervised Claude Code worker on Orca, and how the coordinator handles a batch.

## Automatic mode

A worker of an automatic project ([modes.md](modes.md#modes)) must not commit, push or run `gh` (a worker commit makes the item BLOCKED), and has one issue. These lines change:

- Agent: "permission mode auto, with the bounds its settings file sets" in place of "permission mode the agent's default".
- Trusted authors: the `gh api` check is the coordinator's, done for the Thread block.
- Chat name: left out.
- Acknowledge: "You have no message, report or question command, whatever Orca's start message names: run no Orca command." in place of the line. Its report is its final answer, read through Orca ([modes.md](modes.md#automatic-bounds)).
- Branch: without "fetch it" and the merge of origin/<default branch>: the worker fetches and merges nothing (its spec), so the coordinator runs `git -C <project path> fetch origin` right before the start, and a merge is the coordinator's ([Commit and push](commit-and-push.md)).
- You may: "create the branch named above, stage changes to the owned paths with `git add`, resolve the conflicts of a merge the coordinator started, and run checks" in place of the rest of the line: a merge is a commit too.
- You may not: also "commit, merge, push or run `gh`, also where the worker rules say to (a stop request: stage and report)"; "start with a flag that bypasses or skips permission prompts" stays.
- Flow, Quick depth: "stage" in place of "commit". Every depth: "once the work is staged, report: the coordinator commits it, pushes the branch and opens the draft pull request, with your commit message as its body" in place of the push, pull request and checks steps.
- Decisions: "take the recommended default only for a safe, reversible choice and list it in the report. Auto mode decides tool calls, never a question." The owner-only bullet: "stop that issue and report BLOCKED with the question (Blocked, below)" in place of its sentence that starts "With a question command". The owner's answer comes as a new start ([modes.md](modes.md#gates)). The bullet that starts "With a question command from Orca": "You may not decide: the spec against trusted-author text, a recorded decision against the task, a choice that is not safe and reversible (Needs replan, below)." in place of it. The bullet that starts "Ask once" is left out.
- Blocked, Needs replan, No change needed and Follow-up: what they comment on the issue, and the replies to review threads, go into the report or answer instead, which the coordinator posts. A change to a path the settings file denies (`.claude`, `.mcp.json`, `.envrc`, `.npmrc`, `.husky` and the others of [Automatic bounds](modes.md#automatic-bounds)) or that [Worker rules](modes.md#worker-rules) refuse is BLOCKED.
- Follow-up: "A follow-up comes as a new session in the same worktree. Stage the fix and answer, as the final result of that session, with the staged files and a commit message, and with a new title or body where one was asked." in place of the text from "Push, and answer" to the end of the line.
- Report: "once, as your final result, then stop" in place of "once, through Orca's report command, then stop": its first word the outcome, as for a worker without a report command. What changed takes the branch, the staged files and a commit message whose body refers to the issue as `<owner/repo>#<number>`, with no closing keyword.
- A new line after Authority: "Bash calls: pass only `command` and `description`. Avoid a `git -c` option, a leading `VAR=` assignment, `make VAR=...`, `eval`, a Monitor command and a multi-line `printf ... > file` call, which auto mode or the role guard can refuse: write files with the file tools and use other forms. An action the auto mode check blocked stays refused: never retry it in another form. When the task needs it, report BLOCKED with the action and why."

## Supervised Claude Code worker on Orca

Its rule file refuses `git push`, `gh pr create`, `gh pr comment` and the `gh issue` writes ([Worker rules](modes.md#worker-rules)): it commits, and the coordinator pushes and opens the pull request ([Commit and push](commit-and-push.md)). Only these lines change:

- Agent: "permission mode auto" in place of "permission mode the agent's default".
- You may: without "push those branches", "open or update one draft pull request", "and reply to review threads"; "before your next commit" in place of "before your next push".
- You may not: also "push, or create, change or comment on a pull request or an issue, also where the worker rules say to, and in no other form (`git -C`, `gh api`)"; "start with a flag that bypasses or skips permission prompts" stays.
- Flow, Every depth: "once the work is committed, report: the coordinator pushes the branch and opens the draft pull request with your body and a title it sets from the one you propose" in place of the push, pull request and checks steps.
- Batch: "When an issue's change is committed" in place of "When an issue's pull request is up", "commit its branch" in place of "commit and push its branch", and "fix, commit" in place of "fix, push".
- Blocked, Needs replan, No change needed and Follow-up: the line of [Automatic mode](#automatic-mode), its refused paths those of [Worker rules](modes.md#worker-rules).
- Follow-up: commit the fix and answer with its head commit, and with a proposed title or a new body where one was asked.
- Report: What changed takes the branch, its head commit, and a proposed pull request title and a body that refers to the issue as `<owner/repo>#<number>`, <closing>.
- A new line after Authority: "An action the auto mode check blocked stays refused: never retry it in another form. When the task needs it, report BLOCKED with the action and why."

## Batches

A spec with several issues is a batch: the issues one Pick gives one worker.

- It counts as one worker for `workersPerProject` and `hostWorkerLimit`.
- React to each issue's outcome when its message arrives: review and merge do not wait for the batch.
- An issue reported blocked or in need of a replan waits until the batch has ended. Start no replan, retry or other worker for it before the batch's report, and keep the worktree.
- An issue that ended BLOCKED on an earlier issue of its batch is the exception to "an issue starts once" ([Pick](bot-pick.md#pick)): once that issue's pull request is merged, whoever merged it, it counts as an issue with no outcome, and Pick takes it again, once. In a `keepRunning` run that can be long after the batch.
- A batch that ends BLOCKED (a cause that stops every issue) is blocked for each issue it did not finish.
- Clean up the worker after its report and once each of its pull requests is merged or left for the owner, not after each issue. A batch with an issue that ended BLOCKED keeps its worktree, also when the batch reports DONE ([Blocked](outcomes.md)).
