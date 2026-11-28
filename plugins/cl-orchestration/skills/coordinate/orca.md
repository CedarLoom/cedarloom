# Orca commands

Checked with Orca 1.4.254 to 1.4.274.
Checked with Claude Code 2.1.330.

The coordinator starts and reaches its workers only through Orca. `ORCA` stands for the executable the session resolved and used for `ORCA skills get orchestration`; substitute it, do not run `ORCA` literally. Load that guide first: it is the version-matched source for every command and state, and it wins where an Orca file differs. Prefer `--json`.

Contents: [Start the run](#start-the-run), [Host limit](#host-limit).

## Start the run

The start condition of every run, checked before `run-create`; when one of these fails, start nothing and tell the owner which one and why:

1. The session is Claude Code.
2. An Orca executable is found, and `ORCA skills get orchestration` succeeds.
3. `ORCA status --json` prints `result.runtime.appVersion`, the version of the running Orca app, at [1.4.259](https://github.com/stablyai/orca/releases/tag/v1.4.259) or later: three numbers `<major>.<minor>.<patch>`, compared number by number. A missing field means Orca is not running, or too old. `0.0.0-dev` and a value of any other form fail too. `ORCA --version` shows the installed CLI, not the running app: it goes into the message to the owner and never admits a start.

`ORCA orchestration run-create --objective "issue work: <project names>" --json` once, then one start per worker, a batch being one worker. Right after `run-create`, a coordinator in a chat names its chat once: `ORCA chat rename --name 'Coordinator: <project names>'`. Outside a chat Orca refuses it, so a coordinator in a terminal skips it.

A Claude Code worker starts in a worktree of its own, then by its project's [mode](modes.md#modes):

```text
ORCA worktree create --name <number>-<slug> --repo path:<project path> --base-branch <default branch> --no-parent --setup run --json
```

Supervised: a terminal the coordinator makes, on the host's default Claude Code login, so that its launch carries `--permission-mode auto`. Orca's own launch adds the flag of Orca's agent permission setting, the user's choice in Orca's Settings, Agents, Agent Permissions, which Orca ships at "full-access", and that adds `--dangerously-skip-permissions` for Claude Code; `worker-start` takes no permission flag, and its `--model` and `--effort` do not combine with `--terminal`. So no Claude Code worker starts through Orca's own launch. The `--permission-mode` flag wins over every settings file's `permissions.defaultMode` ([permission modes](https://code.claude.com/docs/en/permission-modes)), so a user's `"defaultMode": "bypassPermissions"` does not reach the worker. Where auto mode is not available to the session (a model without it, an organization or a settings file that turned it off, Anthropic turning it off), Claude Code starts it in Manual instead (same page). Manual prompts for every worker: `permissions.disableAutoMode` set to `"disable"` in a settings file the worker loads ([settings reference](https://code.claude.com/docs/en/settings-reference)), which also applies to the user's own sessions there. Another agent's supervised worker keeps Orca's own launch (Codex: below).

Before the first Claude Code start of a run, `env which claude` prints `<claude path>`, the absolute path of the `claude` executable on the PATH (`env` runs the external `which`, so no shell alias or function answers). Every version check runs `'<claude path>' --version` and every launch line below starts `'<claude path>'`, so the check reads the executable the terminal starts, whatever PATH the terminal's login shell has. Before the first supervised Claude Code start, that check prints 2.1.330 or later, the CedarLoom minimum ([Automatic bounds](modes.md#automatic-bounds)). No output, a path that does not start with `/` or holds a quote, `$`, `\` or a backtick, or a lower version: start no Claude Code worker and name the path and the version in the report.

The launch unsets `CEDARLOOM_ROLE`, and each supervised Claude Code worker still measures it: a worker that inherits the variable passes the role guard as the coordinator. Its spec (`kind` `supervised` of [spec-template.md](spec-template.md)) carries a Role check line, and a follow-up file ([Follow-ups](orca-follow-ups.md)) takes this one after the Chat name line:

```text
Role check: right after the chat name, before any other command, run `printenv CEDARLOOM_ROLE` yourself, in your main session, never through a subagent. It passes when the CedarLoom role guard refuses it as a command that names the variable, since the guard lets such a command run only in the main session with the coordinator's role, and when it prints nothing. A value it prints, and any other result, ends this follow-up: change nothing, report BLOCKED with the role check failed and its output quoted, and end. No report, message or comment of yours names the variable, a command you list or an output you quote included: write `the role variable` in its place, since the role guard refuses a command whose text names it, a report's `send` included.
```

After such a report, start no further supervised Claude Code worker in the run, send none that reported a follow-up, and tell the owner: `CEDARLOOM_ROLE` goes on the coordinator's launch line only (`CEDARLOOM_ROLE=coordinator claude`).

```text
node <skill folder>/worker-settings.mjs --supervised <worktree path> <project path>
node <skill folder>/worker-settings.mjs --check --supervised <worktree path> <project path>
ORCA terminal create --worktree path:<worktree path> --title <number>-<slug> --command "env -u CEDARLOOM_ROLE CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false '<claude path>' --autocompact 200k --model '<model>' --effort <effort> --permission-mode auto" --json
ORCA terminal wait --terminal <terminal> --for tui-idle --timeout-ms 60000 --json
ORCA orchestration worker-start --spec-file <filled spec file> --terminal <terminal> --worktree path:<worktree path> --task-title '<chat name>' --keep-open --json
```

The first two lines write and check its rule file ([Worker rules](modes.md#worker-rules)) before each start, retry and follow-up; a failure starts nothing and makes the item BLOCKED. `worker-start` on a session that is not idle yet fails with `agent_unconfigured`, hence the wait. The same lines serve the start, a retry, a new start for a follow-up, and a Claude Code worker of an automatic project that falls back to supervised. Its spec takes `kind` `supervised`, whose Rule file line keeps the worker off `.claude/settings.local.json`.

Automatic: a terminal of its own as well, its launch carrying `--permission-mode auto` and the settings below:

```text
ORCA terminal create --worktree path:<worktree path> --title <number>-<slug> --command "env -u CEDARLOOM_ROLE CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false '<claude path>' --autocompact 200k --model '<model>' --effort <effort> --permission-mode auto --settings '<run folder>/settings/<id>.json'" --json
ORCA terminal wait --terminal <terminal> --for tui-idle --timeout-ms 60000 --json
ORCA orchestration worker-start --spec-file <filled spec file> --terminal <terminal> --worktree path:<worktree path> --task-title '<chat name>' --keep-open --json
```

A Codex worker starts with `ORCA orchestration worker-start --spec-file <filled spec file> --worktree new-top-level --repo path:<project path> --base-branch <default branch> --name <number>-<slug> --agent codex --model "<model>" --effort <effort> --task-title '<chat name>' --keep-open --json`.

- `--autocompact 200k` caps the worker's context at 200,000 tokens before it compacts, and `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` turns off the next-prompt suggestions no one reads in a worker terminal. `env` sets the variable in any login shell, and it runs the binary at `<claude path>`, never a shell alias or function named `claude` (one that adds `--dangerously-skip-permissions`, say): keep `env` first in every form of the line.
- No launch line in the Orca files carries a permission-bypass flag. A Codex worker gets the flag of Orca's agent permission setting (under "full-access", `--dangerously-bypass-approvals-and-sandbox`, which also turns off Codex's sandbox). A Claude Code worker's `terminal create --command` line, supervised or automatic, is the coordinator's alone: that setting adds nothing to it.
- Automatic is for a Claude Code worker only (a Codex worker of an automatic project takes the [fallback](#fallback-to-supervised)): write its settings file first ([Automatic bounds](modes.md#automatic-bounds)), `<id>` being `<number>-<slug>`. Before each such worker, pass [Automatic start](automatic-start.md); the probe worker starts the same way in a worktree `probe-<r>` with the probe as its spec, and is released and its worktree removed after it. The `--check` read of check 2 is the last command before every `terminal create` of an automatic worker, a retry and a follow-up included, and the launch's `--settings` takes the same absolute path as that read: a relative one would name a file in the worktree. A failed check or probe step takes the [fallback](#fallback-to-supervised), except a failed `--check` read of an item, or check 3 or 4 failing at a later start, which makes that item BLOCKED and starts no worker.
- Write the filled spec to a file in the run folder and pass that file with `--spec-file`, so issue text is never read by the shell.
- The model and effort are those of the spec's `Agent:` line, the model inside single quotes. Leave out what that line gives as the agent default, and the effort whenever the model is left out.
- A Claude Code worker takes its task only once its agent reached its idle prompt. A `terminal wait` that times out or ends in another state starts no worker: read its screen once (`ORCA terminal read --terminal <terminal> --screen --json`). Such a start has a worktree and a terminal but no dispatch, so neither `worker-list` nor [Clean up](orca-clean-up.md) sees them:
  - A dialog there (a trust question, a login) is the owner's ([Rules](SOUL.md#rules)). List the issue, the terminal handle and the worktree path for the owner, and count it as a working worker ([Host limit](#host-limit)) until the owner acts.
  - Anything else is a failed start ([outcomes.md](outcomes.md)). Close the terminal (`ORCA terminal close --terminal <terminal> --json`); the one retry runs in that worktree with a new terminal, from the settings or rule file, checks 3 and 4 of [Automatic start](automatic-start.md) for an automatic worker and the file's `--check` read on, and makes no second worktree.
- `<chat name>` is the spec's ([spec-template.md](spec-template.md)): `--task-title` names the worker's task in Orca with it, and the spec's Chat name line names its chat. An automatic worker runs no Orca command, so its chat keeps the name Orca gives it.
- `<number>-<slug>` takes the first issue of a batch, for the worktree, the terminal title and `--name`. `worktree create` prints the worktree path; for a Codex worker, `worker-show` gives it.
- When the agent refuses the model, start without `--model` and `--effort` and say so in the report.
- A Claude Code worker's start and retry keep `--keep-open`, without which Orca releases a worker about 2 minutes after its accepted `worker_done` (`autoReleaseAt` in `worker-show` and `worker-list`). Its terminal comes from `terminal create`, and `worker-release` never closes such a pre-existing terminal, so the coordinator closes it: an automatic worker's at its report, a supervised one's once its pull request is merged or left for the owner, which keeps its session for follow-ups ([Clean up](orca-clean-up.md)). A Codex worker starts in a new worktree, which Orca keeps open after its report whatever the flag, until `worker-release`.
- Keep the returned dispatch id and task id per worker with its project, issues, worktree path and branch names (the spec's `<type>/<number>-<slug>`); every later command takes the dispatch id. A follow-up `send` that Orca turns into a task ([Follow-ups](orca-follow-ups.md)) returns a new task id and dispatch id: keep both. `worker-show`, `worker-read`, `send`, `worker-retain` and the stall check take the newest; `worker-release` takes each, newest first, and an older one already released reports `already_released`. `<branch>`, `<default branch>` and `<owner/repo>` in the Orca files are the names of that spec.
- A non-zero exit means no worker: read `failedStage` and `residualResources` before trying again.


### Fallback to supervised

An automatic project whose [Automatic start](automatic-start.md) failed runs supervised for the rest of the run, and so does a Codex worker of an automatic project. Such a worker starts as a supervised one (above) and has none of the automatic bounds (no settings file): a Claude Code one runs in auto mode with the worktree rule file of [Worker rules](modes.md#worker-rules), as every supervised one does, and a Codex one with Orca's agent permission setting, under the shipped "full-access" with no permission prompt. For a failed start, write in the report the project, the failed check or step, and that its workers run without the automatic bounds, its Claude Code workers in auto mode, or after a failed version check that none starts ([Start the run](#start-the-run)). For a Codex worker, the report names that worker and that it runs without the automatic bounds under Orca's setting.

## Host limit

The limit is machine-wide, and `worker-list` covers one run (the bound one unless `--run` is given). Count the rows whose `outcome` is `in_progress` in every run that `ORCA orchestration run-list` shows, before every start: a kept-open worker's terminal state is `retained` also while it works, so that state does not tell the working ones. An automatic or supervised Claude Code worker whose terminal close is confirmed (Release) does not count, whatever its row shows; for a row of another run, or one this run has no record of, the close is confirmed when `ORCA terminal list --json` no longer lists its terminal. A start held at a dialog ([Start the run](#start-the-run)) counts as working too: a terminal that `ORCA terminal list --json` lists in a worktree of the project that no worker row names is one, until that terminal closes; a worker whose last turn ended while its `ask`, or a `needs-input` question held for the owner ([Stops](orca-messages.md#stops)), waits for the owner, with no other work left open, does not, until its reply; one that works on counts.

Orca reserves no slot and lists a start in `worker-list` once `worker-start` returns: start workers one at a time, each once the last is listed, held at a dialog or failed. `hostWorkerLimit` holds exactly only with one coordinator per host.

A follow-up puts a worker that already reported back to work (an automatic worker's is a new start in its worktree, [Follow-ups](orca-follow-ups.md)), so it counts like a start for `hostWorkerLimit` and `workersPerProject`: count before it too, leaving out the worker that takes it. When a cap is full the follow-up waits, and no start in that project (for `hostWorkerLimit`: on the machine) comes before it: else new issues keep the slot and the pull request never merges. Count each worker of this run with an unanswered follow-up as working, whatever its row says; another run's follow-up workers are not counted this way and can pass `hostWorkerLimit`.

### Project bot starts

Names as in [bot-project.md](bot-project.md). Before each start, note the UTC second `<t>` (`date -u +%Y-%m-%dT%H:%M:%SZ`), count working workers as above, then `node <skill folder>/precheck.mjs --host-limit <hostWorkerLimit> --working <count> --counted-at <t> --reserve <bot home>/prompts/<name>.md --result <role bot home>/results/<name>.md --lock <host lock folder>/host-limit.lock <folders>`, `<folders>` the `prompts/` folders of the homes `ORCA bot list` names. Only exit 0 starts: it made the prompt file, which a failed start deletes. Exit 1 printing `recount`: a worker left the folders for the Orca count after `<t>`, so take a new `<t>` and count once more.

A fresh worker's prompt file counts that worker until the Orca count shows it. Once it does, or the run ends, delete the file with `node <skill folder>/precheck.mjs --hand-over <its absolute path> --lock <host lock folder>/host-limit.lock`, which records the time under the lock, so a start counted before it counts again.
