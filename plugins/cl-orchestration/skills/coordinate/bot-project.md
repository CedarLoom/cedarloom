# Project bot run

The pick sweep and pull request event runs. [SOUL.md](SOUL.md) holds first. `<state>` is `<bot home>/state/`, `<clone>` the bot's checkout, `<skill folder>` this folder, `ORCA` as [orca.md](orca.md) says, `state` is `node <skill folder>/state.mjs` (its head lists the files and answers). Named steps of other files apply with the changes below.

## Every run

1. **Run folder.** Run id: the UTC start `YYYYMMDDTHHMMSSZ`, `-`, `openssl rand -hex 3`. `mkdir` without `-p` `<bot home>/.cedarloom/runs/<run id>/` (one that exists takes a new id) for the run's files; delete it at the end but for files a report names.
2. **Count.** `state count <state>`, `--pr <n>` for a run about a pull request. Exit 1 ends the run: report `limit`, a `prRuns` cap only where `report` is true, never in an approval issue. Right before each worker or role bot start, `state count <state> --worker`: exit 1 starts none. Exit 2 stops the run: report it.
3. **State.** `state read <state>/pr-<n>.json`; exit 1: rebuild it as [SOUL.md](SOUL.md) says. End when `handled` names the event's head with an action that answers it (`fix` a red head or conflict; `merge`, `trial` or `update` a green one), or the pull request is `held`: [catch-up](bot-catch-up.md#the-run) condition 3 takes the owner's answer.
4. **Write** each decision right after it: its fields to a file, then `state write <state file> <fields file>`. Reports go to `chat`.

A decision taken on the owner's behalf names its source (file and line) where it acts; `(owner)` marks only the answer `approval.mjs answer` reads.

## Pick

Report each file the precheck names on stderr. A prompt file whose result file holds text is that run's report ([bot-reports.md](bot-reports.md)); one past `stallMinutes` without it is stalled: report it and delete it, unless its issue carries `cl:in-progress`, which stays for the owner. Then run the precheck again and take step 1 of the [Loop](SKILL.md#loop) on the issues it prints, three starts at most, with the spec of [spec-template.md](spec-template.md). A deep issue, or one that leaves its approach open, first gets a plan run unless a plan run's report or an answered `design` approval holds its plan. `cl:in-progress` goes on right before a start.

An automatic worker starts after check 2 of [Automatic start](automatic-start.md) and a passed probe of the UTC day in `<state>/probe-<day>.json`; without one the project runs supervised that day where [orca.md](orca.md#fallback-to-supervised) offers it, else starts nothing.

## Start

- **Host limit.** Count working workers ([Host limit](orca.md#host-limit)), then `node <skill folder>/precheck.mjs --host-limit <hostWorkerLimit> --working <count> --reserve <bot home>/prompts/<name>.md --result <role bot home>/results/<name>.md --lock <host lock folder>/host-limit.lock <folders>`, `<folders>` the `prompts/` folders of the homes `ORCA bot list` names. Only exit 0 starts: it made the prompt file, which a failed start deletes.
- **Role bot run.** `<name>`: `<repo>-<n>-<role>-<round>-<run id>-<k>`, `maintain` for `<n>`, `<round>` 0 but for a fix (its review round), `<k>` the run's start count from 1. The prompt file: `bot-<role>.md`, then the spec (build), `Plan only.` and the spec (plan), the follow-up (fix), the brief of [Review](review.md#review), or `<maintain folder>` and `<state>/maintain.json`; last, on its own line, `Result file: <role bot home>/results/<name>.md`. Then `ORCA automations create --bot cl-<role> --name '<owner/repo>#<n> <role> <round>' --model <model> --effort <effort> --runs-in new --results-to none --once --by <UTC now plus one minute> --prompt 'Read <skill folder>/SOUL.md, then the prompt file <its absolute path>.' --json`.
- **Fresh worker** where the repository has no role bots, `docs/agents/bots.md` names them for the role, or the role bot's home holds `state/guard-failed` (reported once): an Orca worker with that prompt ([Start the run](orca.md#start-the-run)).
- **Record** `{ startedAt, head, role, resultFile, result: null }` in `runs` (role bot) or `dispatches` (worker), the automation ids in `rules`. Delete a role bot run's prompt file once its result is in, a worker's once the count shows it or the run ends.

## Pull request events

- **Green head, not reviewed.** `mkdir <state>/claim-<n>-<head>`; an existing folder younger than `stallMinutes` ends the run. An older one: catch-up condition 7 where a reviewer entry for that head has no `result`, else `rmdir` it and claim again. Then the claim comment and a reviewer run at the level of [Sensitive or routine](review.md#sensitive-or-routine), the re-review of [Rounds](review.md#rounds) where `reviewedHead` is set.
- **Red head or conflict** not in `handled`: on `ci_failed`, `gh pr checks <n> -R <owner/repo> --json state` without `FAILURE`, `TIMED_OUT`, `STARTUP_FAILURE` or `ERROR` starts nothing. Else one fix run, `handled` `{ head, action: "fix" }`.
- **Green accepted head** ([Ready](merge.md#ready), the review read only at `reviewUrl`): Merge. Verdict `update`: `gh pr update-branch <n> -R <owner/repo>`, record `updatedAt` and `handled` `{ head, action: "update" }`, end.

## Merge

Steps 1 to 5.2 of [Merge](merge.md#merge) in the newest clone, subject and body in `<state>/pr-<n>-subject.txt` and `pr-<n>-body.md`, a trial's base as `trialBase`. Record `handled` (head, the verdict's `next`), the clone as the last of `clones` and the review's `riskClass`, then `node <skill folder>/merge.mjs <state>/pr-<n>.json --run <run id>` once (`--method` only as `AGENTS.md` names):

- `merged`: delete the event rules, clones and branch ([Clean up](run-files.md#clean-up)); with `closeIssue`, check the issue closed ([Outcomes](outcomes.md)).
- `wait`, `redMain`: end.
- `restart`: steps 1 to 5.2 once more; a second ends the run.
- `stop`: file the reason once, as `held` unless the script set it; with `mergedAt`, also the cleanup of `merged`. Report exit 1.

A held merge command, or one without a merge log line, pauses every merge of the repository until the owner's answer; another hold blocks only its pull request.
