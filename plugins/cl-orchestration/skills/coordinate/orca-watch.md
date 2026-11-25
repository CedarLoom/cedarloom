# Orca watch

Contents: [Watch](#watch), [A permission dialog](#a-permission-dialog).

## Watch

The mail types are `worker_done,escalation,question,status`. Orca wakes the coordinator when mail arrives, a `worker_done`, an `escalation` or a `question`. A `status` message wakes it too: its terminal is told "You have 1 orchestration message" (unverified: observed, not in Orca's documentation).

How the coordinator waits:

- **Always.** The coordinator never polls, but for the foreground wait without session crons (below), and never runs `check --wait` in the background: a background wait keeps a task alive at every turn end, so the plugin never clears an idle coordinator.
- **With session crons.** End the turn after starting or messaging workers. At run start, create one recurring session cron (`CronCreate`) every 10 minutes on minutes off the hour (`3-59/10 * * * *`). Its prompt names the run id and the absolute path of this file, and lists the four wake-up checks below, so a wake runs them without reading a file and a silent worker is seen without mail.
  - The cron fires only while the session is idle and survives `/clear`.
  - It expires after 30 days, and an expired cron cannot wake the session, so name its expiry date in the report of each wake and replace it before then.
  - To replace it: at the first wake within 2 days of that date, or when `CronList` no longer shows it, `CronDelete` it and create it again as at run start, with the same schedule and a new expiry date. A run that only waits for new issues (`keepRunning`) then keeps waking with no owner restart.
  - Delete it (`CronDelete`) when the run closes.
- **Without session crons** (`CronCreate` missing, or `CLAUDE_CODE_DISABLE_CRON` set). It runs `check --wait` for those types with `--timeout-ms 600000` in the foreground, never looped faster than once a minute, and runs the wake-up checks when it returns.

A wait's deadline ([SKILL.md](SKILL.md#waiting)) is checked at a wake: it is a point to report at and ends no run.

At each wake-up, including an empty one, run these in this order; a wake-up that skips them lets a failed or finished worker go unseen:

1. `worker-list --run <run id>` for state, with `--full` because the concise rows carry no `projection`.
2. `gh pr list -R <owner/repo> --head <branch> --state merged --json number,title,mergedAt` for merged PRs.
3. The stall check, and the [acknowledgement](orca-messages.md) of each worker that has none yet.
4. The next step of each pull request that waits for its checks or its default-branch watch ([merge.md](merge.md#merge)).

For a row whose `projection.attention.requiresAction` is true:

- Run `ORCA` with its `projection.nextAction.argv` only when that command is `worker-read` or `worker-show`, or `worker-release` for a worker that the release rule lets go, a Claude Code worker's only after its terminal close ([Clean up](orca-clean-up.md)): a Codex or supervised Claude Code worker whose pull request is in review or merge stays, whatever the row asks.
- Any other next action goes in the report.

Acknowledge a delivery only after its outcome is handled (`check --ack <delivery_id>`).

Liveness, in the guide's terms: `ready` or `unverifiable` is absence, not proof. A worker blocked by a hook or waiting at a prompt stays `ready`, so a state watcher never fires for it. An escalation for a stop, exit or loss is proof enough and goes by [Stops](orca-messages.md#stops); the stall check is for a worker silent past `stallMinutes` with no such escalation still unhandled (a worker [Stops](orca-messages.md#stops) left idle is checked as that section says). For the stall check, compare the time of the last commit on its branch, its PR and its last message with `stallMinutes`; when exceeded, `worker-read` its last output. Proof that it stopped without a report is a final agent turn that ended with no `worker_done` and not while its `ask`, or a `needs-input` question held for the owner, waits for the owner, with no other work left open ([Gates](orca-gates.md#gates)); an automatic worker's final turn is its report ([Worker reports](orca-messages.md#worker-reports)), so it has stopped without one only when no final answer is there. Then `worker-stop` it and handle it as blocked; act on the `nextAction` that `worker-list` gives for the stopped dispatch, by the rule above, before releasing it. Without that proof, keep waiting.

## A permission dialog

An automatic worker runs in auto mode and shows one only after repeated blocks of the auto mode check (below). A dialog in its terminal (a trust question, a login, such a prompt) is the owner's.

A worker that Orca's own launch starts in a structured (chat) session shows none either: it has no terminal, and Orca answers its prompts by its agent permission setting ([Start the run](orca.md)). A supervised Claude Code worker runs in a coordinator-made terminal, in auto mode or in Manual where auto mode is unavailable, and can show one ([Start the run](orca.md)).

In auto mode a single block of the auto mode check refuses one action, and the worker carries on with nothing shown. After 3 blocks in a row or 20 in total auto mode pauses and Claude Code prompts again; approving the prompted action resumes auto mode. A dialog also shows for an ask rule in the user's settings, for the first Read, Grep or Glob call on a path outside the working directories, and for every unlisted action in Manual ([permission modes](https://code.claude.com/docs/en/permission-modes)). With `permissionPrompts` `block`, list the dialog for the owner, and the item waits. Its approval says to answer once ("Yes"), never "Yes, and don't ask again" or another standing answer: that saves an allow rule in `.claude/settings.local.json` at the main checkout's root, which applies to every later worker of the project and to the user's own sessions there ([settings](https://code.claude.com/docs/en/settings#where-claude-code-keeps-the-local-file-in-a-git-repository)), and a narrow allow rule stays in effect in auto mode.

A supervised Claude Code worker on Orca shows no status bar while a permission dialog is open: the dialog takes the prompt area, so its terminal does not show its mode then (observed in a live run).

Orca also shows such a dialog as an approval of its own. One nobody answers closes after about 90 seconds as "closed without an answer" while the dialog stays open in the worker's terminal, and from then on an approve or deny through Orca no longer reaches the worker (observed, not documented). The coordinator answers neither ([SKILL.md](SKILL.md#rules)): the dialog stays listed for the owner as with `block`, and the item waits.
