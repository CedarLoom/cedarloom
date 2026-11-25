# Orca questions and gates

Contents: [Questions](#questions), [Gates](#gates), [Tasks and gates](#tasks-and-gates).

## Questions

A worker asks with `ORCA orchestration ask --question <text>`, which returns at once: the worker ends its turn and Orca wakes it with the answer. The question arrives as a `question` message. Answer it as [Worker questions](SKILL.md#worker-questions) says, by its message id, with the answer in a file:

```text
ORCA orchestration reply --id <message id> --body "$(cat <answer file>)" --json
```

The answer's sources are the default branch's: the policy as the reader prints it now, and `AGENTS.md` read in a scratch clone as [review-and-merge.md](review-and-merge.md#scratch-clone) reads it. An issue without a pull request has no clone yet: make one for the answer, with the two commands of that section.

## Gates

By ask and reply, in supervised mode ([Gates](modes.md#gates)):

| | Supervised |
| --- | --- |
| Which questions | each question that the written sources do not settle; for an owner-only decision, only the sources of [Owner-only decisions](SKILL.md#owner-only-decisions) |
| The worker | asks ([Questions](#questions)) and waits |
| While it waits | send no reply; once its turn ended while its `ask`, or a `needs-input` question held for the owner ([Stops](orca-messages.md#stops)), waits for the owner, with no other work left open, it does not count as working until the reply ([Host limit](orca.md#host-limit)), and that turn is no stall ([Watch](orca-watch.md)) |
| After the answer | once a slot is free, `reply --id <message id>` with the chosen option in a file, as [Questions](#questions) says |

Automatic: the worker never asks ([Worker reports](orca-messages.md#worker-reports)). An owner-only question is a `BLOCKED` report with the question, and its answer a new start in its worktree, as [Gates](modes.md#gates) says.

Both modes: an item held for the owner before its start gets an Orca gate on a decision task, and one held after its worker settled a gate on its item task ([Tasks and gates](#tasks-and-gates)). A worker that works or waits on its `ask` gets none: Orca refuses a gate while a worker of the task is active (`task_not_startable`, observed with Orca 1.4.259).

## Tasks and gates

Each item has one Orca task, its item task: the task its first `worker-start` returns, for a batch one task for all its issues. Keep its id and status in the handoff file. It records the first start's status and the item's gates for Resume, not the item's end: after a continuation it keeps the status restored after its gate; the outcome still comes from the report ([Worker reports](orca-messages.md#worker-reports)). A follow-up and every later start make a task of their own and leave the item task as it is: a `send` to a worker whose item task was `blocked` made a new task and left that one `blocked` (observed with Orca 1.4.259).

What Orca does (observed with Orca 1.4.259):

- `gate-create` sets the task `blocked`, also a `completed` task whose worker reported; `gate-resolve` sets it `ready`, never `completed`.
- A task turns `completed` at its worker's `worker_done`, before review and merge.
- `worker-stop` of a worker that sent no `worker_done` leaves its task `blocked`, not `failed`.
- `worker-start` refuses `--task` together with `--spec-file`, so a start that brings an answer uses `--spec-file` and makes a task of its own.

Read from Orca 1.4.259's source, not run: `task-update` without `--result` keeps the stored result; `task-update --status failed` is accepted from `ready`; a gate on a `failed` task is accepted.

The coordinator never starts a worker on a task because Orca lists it `ready`, as the loop of Orca's guide does, and never on a task titled `Decision:`. Put each title and question in single quotes, in your own words, as an approval's title ([approvals.md](approvals.md#labels-and-title)), and each answer as its option label. Write the handoff file after each step below and before each `gate-resolve`. A refused command of this section goes into the report with its error; the approval still holds the item, the outcome of a final answer stands, and nothing is stopped, retried or started because of it.

### A hold before the start

An issue held for a `design` answer ([SKILL.md](SKILL.md#risk-class)) gets a decision task with a gate once its approval is filed. Its item task comes at its start, as for any item: its spec needs the worktree, the mode and the batch of that start.

```text
ORCA orchestration task-create --spec-file <file with the approval's What line> --task-title 'Decision: <title>' --json
ORCA orchestration gate-create --task <decision task id> --question '<title>' --json
```

On the answer, in one turn: `ORCA orchestration gate-resolve --id <gate id> --resolution '<option label>' --json`, which makes it `ready`, then `ORCA orchestration task-update --id <decision task id> --status completed --result '<option label>' --json` when the answer starts the work, else the same with `--status failed`. The item goes on as the answer says ([The answer](approvals.md#the-answer)).

### A gate after a report

A report or merge step that needs the owner (a BLOCKED report with an owner question, a merge outside `merge.allowed` or above `merge.autoMergeMax`, an owner-only file or a release) gets a gate, for an approval still open then, once the item's worker settled: its `worker_done` arrived, or an automatic worker's release is confirmed (below). Write the item task's status into the approval's line ([approvals.md](approvals.md#once-per-pull-request-and-gate)) first, then:

```text
ORCA orchestration gate-create --task <item task id> --question '<title>' --json
```

An item task with a pending gate gets no second one: a second approval for it, another issue of its batch, names the same gate and the status the first one recorded, and the gate is resolved once the last of them is answered. A later head that voids an answer ([The answer](approvals.md#the-answer), The head) gets a new gate the same way once that head's worker settled.

On the answer, or once a wake-up check sees the pull request merged: `gate-resolve` as above (the item task turns `ready`), then in the same turn `ORCA orchestration task-update --id <item task id> --status <status from the approval's line> --json`, with no `--result`, so the worker's result stays and no item task stays `ready` without a worker. Then the line changes as [The answer](approvals.md#the-answer), The Orca gate, says, and the item goes on as [Gates](modes.md#gates) says. A pull request closed without a merge leaves its gate pending and its line in `## Open`, and each report names it until the owner answers the approval.

### An automatic worker's task

An automatic worker sends no `worker_done`, so nothing settles its task: the item task for its first start, the start's own task for each later one. Once its release is confirmed ([Clean up](orca-clean-up.md), Release), set that task by its final answer: `ORCA orchestration task-update --id <task id> --status completed --result DONE --json` for DONE, else `--status failed` with the outcome word (`BLOCKED`, `NEEDS_REPLAN`, `failed`) as the result. Unverified: the task's status after that release, and that Orca accepts the update there (read from Orca 1.4.259's source, not run). After a `worker-stop` of a worker that sent no `worker_done`, its task was `blocked` and `task-update --status completed` was accepted (observed with Orca 1.4.259).
