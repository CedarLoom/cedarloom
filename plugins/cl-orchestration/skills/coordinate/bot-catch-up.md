# Catch-up run

The procedure of the project bot's catch-up sweep, the backstop that starts a run when an event that should have started one was lost. [SOUL.md](SOUL.md) holds first; the names are those of [bot-project.md](bot-project.md), whose steps this file names.

## The automation

Every 15 minutes, `--runs-in new`, working folder the bot home, with `--precheck "node <skill folder>/precheck.mjs --catch-up <clone> --state <state>" --precheck-timeout 120` (the precheck answers within 90 seconds). Its exit 0 starts the run, which reads the precheck's JSON line `{ start, condition, reason, probe }`; the precheck writes nothing. Schedule it only once `SOUL.md` and the `bot-*.md` procedures are in the skill folder its prompt names: a run without them has no steps to take and still counts toward the daily limits.

## The run

1. Steps 1 and 2 of [Every run](bot-project.md#every-run), counting `{ runs: 1, catchUp: 1 }`, and `pr` for a condition that names a pull request. Then run the precheck once more, as written above: the first line that holds now is the run's task, one per run. A start for nothing (`start: false`) ends the run.
2. **`probe: true`**, the first catch-up run of the UTC day, where the project's `mode` is `automatic`: the daily automatic-start probe is the run's task, and the condition waits for the next sweep. Run checks 1, 3 and 4 and the probe (check 5) of [Automatic start](modes.md#automatic-start), the probe's start counted as a worker start, and write `<state>/probe-<day>.json` `{ day, passed, failed }` with `writeState`, `failed` naming the first check or step that failed. A failure starts the project supervised for the rest of the UTC day where [orca.md](orca.md#fallback-to-supervised) offers it, else starts no worker there; the report names the check. A supervised project skips the probe.
3. The condition:
   - **`failed`:** report the reason. A state file named unreadable is rebuilt as [SOUL.md](SOUL.md) says.
   - **1, stale lock:** `inspectLock(<state>)` once more; still stale, `removeLock(<state>, raw)` with the `raw` it gave, and report the holder. **1, merge not confirmed:** `gh pr view <n> -R <owner/repo> --json state,mergedAt,mergeCommit,headRefOid`. Set `held` to `merge not confirmed` with what that shows, and file it to the owner once: merges stay paused ([Merge](bot-project.md#merge)) until the answer.
   - **2, red tip without a report:** file the report once as [approvals.md](approvals.md) says, with the red runs and the commits since the last passed tip, and write `red-main.json` `{ sha, report }`. Nothing merges until the owner's answer names the pull request that fixes it, written as its `pr`.
   - **3, an answer:** act on it as [The answer](approvals.md#the-answer) says. An answer to a hold clears `held` and `mergeCommandAt` together, in one `writeState`, and the next event or sweep takes the pull request on. Add an acted-on local question as `<file> <at>` to `answered.json`.
   - **4, merge-ready:** [Merge](bot-project.md#merge).
   - **5 and 6:** the red, conflicted or unreviewed head, as [Pull request events](bot-project.md#pull-request-events) says.
   - **7, a stalled dispatch or run:** read its result file into `result`, then as [Reports and mail](bot-project.md#reports-and-mail). Without one past `stallMinutes`, record `result: "stalled"`, release it as [Clean up](orca.md#clean-up) says, clear `handled` where it names that run's head, and report it: condition 5 or 6 of a later sweep starts the head again, within its 12 runs a day.
4. The report names the condition, what the run did, and what it left for the next sweep.
