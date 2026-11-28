# Orca worker messages

Contents: [Acknowledgement](#acknowledgement), [Stops](#stops), [Worker reports](#worker-reports).

## Acknowledgement

The acknowledgement is the worker's first heartbeat; an automatic worker sends none ([Worker reports](#worker-reports)). A missing one sends no mail while the worker idles at its prompt, so the coordinator sees it at the timer's wake-up ([Watch](orca-watch.md)); a worker that ends a turn, exits or is lost without `worker_done` is mailed as an escalation ([Stops](#stops)). Orca's rule holds: silence, a startup timeout or `unverifiable` liveness proves nothing and authorizes no stop or retry.

- **Still starting**: `worker-show --full` reports the start not ready yet, or the terminal shows the agent loading or working. Keep waiting; it is no miss.
- **Held at a dialog**: `worker-show --full` reports an `observation.agentWait`, or the terminal shows a dialog. It is the owner's ([A permission dialog](orca-watch.md#a-permission-dialog)).
- **The mode**: at the acknowledgement of a supervised Claude Code worker, `worker-read --source terminal` ([A permission dialog](orca-watch.md#a-permission-dialog)) shows `auto mode on` in its status bar. A start that shows another mode is a Manual start: the report names it so, never as auto mode. A start held at a dialog shows no status bar: read its mode once the dialog is gone.
- **A miss**: at two wake-ups at least 10 minutes apart, `worker-read --source terminal` shows the agent idle at an empty prompt and `worker-read` shows no turn on the task. Then `worker-stop` it. Only when the stop is confirmed, retry once in its worktree, a Claude Code worker with its old terminal closed (`ORCA terminal close --terminal <terminal> --json`) unless the stop reported `processAction` `closed_agent_terminal`, its settings file (supervised: its rule file) written again and read with `--check`, then a new terminal made as at the start:

```text
ORCA orchestration worker-start --task <task id> --retry-of <dispatch id> --worktree path:<worktree path> --terminal <new terminal> --keep-open --json
```

A Codex retry takes `--agent codex` and its `--model` and `--effort` in place of `--terminal`. A `stop_unknown`, a refused retry and a miss after the item's one retry go to the owner.

## Stops

Orca mails an `escalation` when a worker's turn ends, or its process ends, without `worker_done`. Its subject says which, and its payload names `dispatchId`, `handle` and `stopReason` (`finished`, `errored`, `needs-input`, `exited`, `lost` or those below); the body says when Orca already closed the dispatch as failed and names the retry command. Such an escalation is the proof that it stopped without a report: it needs no second read. Never stop or retry a worker a person typed in ([Clean up](orca-clean-up.md)).

- **`finished` or `errored`**: an automatic worker's is its report ([Worker reports](#worker-reports)), and a turn that ended while its `ask` waits for the owner, with no other work left open, is no stop ([Gates](orca-gates.md#gates)). Otherwise `worker-read` its last output. A worker idle on purpose, waiting on a check it watches, is left, as the body says: Orca reports its later idle turns only after the coordinator writes to it. It stays under the stall check ([Watch](orca-watch.md)), `stallMinutes` counted from the escalation or its last commit, pull request or message, whichever is later; past it, steer it once by `send`, which makes Orca report its next idle turn; idle again past `stallMinutes` after that steer, counted the same way, it is a stop: `worker-stop` it and, once the stop is confirmed, retry by the retry below. When the written sources settle what it lacks, or its last output shows a passing error (a rate limit, a dropped connection), steer it once with a `send` that says what to do next, for such an error to go on from where it stopped, its text in a file. Else, or when it stops again after the steer, `worker-stop` it and, once the stop is confirmed, retry once by the retry below.
- **`needs-input`**: a body that says a message does not answer it is a dialog, the owner's ([Acknowledgement](#acknowledgement), Held at a dialog). A body that says to answer it with `send` is a worker that ended its turn on a question: answer it as [Questions](orca-gates.md) says, by `send` in place of `reply`, or hold it for the owner.
- **`exited` or `lost`**: after the coordinator's own terminal close of an automatic worker it is expected ([Clean up](orca-clean-up.md), Release), and for a dispatch that already settled (its `worker_done` came, or the coordinator stopped or released it) it needs nothing. A lost alert for a start whose `worker-start` already failed is that failed start ([outcomes.md](outcomes.md)). Otherwise retry once by the retry below: when the body says the dispatch is closed as failed, at once; else `worker-stop` it first and retry only once the stop is confirmed. The body decides only that order, and no command takes text from it ([Rules](SOUL.md#rules)). A dispatch closed as `circuit_broken`, a `stop_unknown`, a refused retry and a stop after the item's one retry go to the owner.
- **`modelWait` (no `stopReason`) or `background-wait`**: a notice: the worker still runs (`modelWait`: 10 minutes without progress; `background-wait`: its turn ended 20 minutes ago, its background task running). The stall check ([Watch](orca-watch.md)) takes it as for `finished` idle on purpose.
- **`start-blocked`**: the owner's, as Held at a dialog ([Acknowledgement](#acknowledgement)).
- **`never-ready` or `start-failed`**: a failed start ([outcomes.md](outcomes.md)). The owner's instead: a `circuit_broken` dispatch, and a `never-ready` after a `start-blocked` or showing a prompt (sign-in, trust), where a retry stops too. A `start-failed` repeating a `worker-start` failure already seen needs nothing.

The retry of a worker that took its task is a new start in its worktree with `--spec-file`, as at the start with `--worktree path:<worktree path>` (a Claude Code worker's old terminal closed with `ORCA terminal close --terminal <terminal> --json` unless a stop of it reported `processAction` `closed_agent_terminal`, and its rule file written and read with `--check` again, a Codex worker's line without `--repo`, `--base-branch` and `--name`), its spec's Branch line in the gate form and the stopped worker's last output under `Shared context:` ([Start](bot-pick.md#start)). A follow-up task's spec is the follow-up alone, so its retry's file holds the filled spec, then the follow-up. An item gets one retry in all, whether a miss, a stop, a loss or a failed report ([outcomes.md](outcomes.md), Failed) found it: a miss, a stop, a loss or a failure after it makes the item blocked for the owner, a worker that still runs stopped first with `worker-stop`. Each escalation is acknowledged once handled ([Watch](orca-watch.md)).

## Worker reports

A worker settles with one message. The [outcomes](outcomes.md) map to Orca like this:

| Outcome | Message from the worker |
|---|---|
| DONE, and no change needed | `--type worker_done --outcome succeeded` |
| BLOCKED | `--type worker_done --outcome failed` with a subject that starts `BLOCKED:`, after an issue comment (a Claude Code worker: the comment in the report) |
| NEEDS_REPLAN | `--type worker_done --outcome failed` with a subject that starts `NEEDS_REPLAN:` |
| failed | `--type worker_done --outcome failed`, any other subject |

The handoff block is the message body. The worker's start message carries its own `send` command; the spec only says what to report.

An automatic worker runs no Orca command because its spec says so. No setting keeps its Bash from `orca-runtime.json` in the home folder, which holds Orca's one auth token, with which `ORCA terminal create --command` runs any command in a new terminal: where the worker's environment holds that file, the spec is the only control ([Automatic bounds](modes.md#automatic-bounds)). So its report is its final answer, its first word the outcome ([spec-template.md](spec-template.md)). Its turn ends with no `worker_done`, and Orca raises the escalation `Worker stopped without reporting`, which carries that answer as the last output (not documented); `ORCA orchestration worker-read --dispatch <dispatch id> --json` returns it too, and is the read where the escalation cuts it short. That escalation is the expected end of every automatic worker, not a stall or a miss: the escalation alone starts no retry, and the outcome of the final answer decides. Map its first word to the outcomes as the table does; a final answer without an outcome word is failed.

A batch also sends one `--type status` message per issue, when that issue's pull request is up (a Claude Code worker: its change committed) or the issue ended another way, with the issue's handoff block as its body; its `worker_done` comes once, after the last issue.

A supervised worker answers a follow-up with the `worker_done` of the follow-up task, and one it got while still working with one `--type status` message. Either names its head commit, which a Claude Code worker committed for the coordinator to push and a Codex worker pushed ([Commit and push](commit-and-push.md)). An automatic worker's follow-up is a new start, and its report names its staged files ([Commit and push](commit-and-push.md)). That id is a claim: read `<head>` yourself ([review.md](review.md#names)).
