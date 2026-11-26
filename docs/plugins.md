# The plugins

Hooks and their settings, workflow definitions, Code Mode and the filter for untrusted issue and pull request text. Install steps: [README](../README.md); skills: [Skills](skills.md).

| Plugin | Hooks | Settings |
|---|---|---|
| `cl-workflow` | [Terminal questions](#terminal-questions), [role guard](#role-guard) | `mode` |
| `cl-orchestration` | [Coordinator context rotation](#coordinator-context-rotation) | `rotateAtTokens`, `rotateAtPercent` |
| `cl-repo` | none | none |

Every hook runs `node`, so Node.js must be on the PATH. Codex runs neither the terminal-questions hooks nor the role guard. Set options with `/plugin` (Installed tab, Configure options) or under `pluginConfigs` in `$HOME/.claude/settings.json`, then start a new session.

## Terminal questions

With cl-workflow on, the agent may use the question tool (`AskUserQuestion`) and plan mode (`EnterPlanMode`) until you go away.

- The option `mode` sets how a session starts: `here` (default) or `away`; any other value starts away. A job or bot sets it in user settings or a `--settings` file (project settings do not set plugin options): `"pluginConfigs": { "cl-workflow@cedarloom": { "options": { "mode": "away" } } }`.
- `/cl-workflow:away` goes away at once, until `/cl-workflow:away off`; `30` or `30m` (minutes), `2h` or `until 07:30` (local time, the next such time) set an end. A span that ends before the current away, or text it cannot read, changes nothing.
- While away, the `PreToolUse` hook refuses both, giving the rule as its reason: open questions with recommendations go into one issue per task in the project's tracker, else the report; safe, reversible recommendations are taken and the work goes on; no chat-text interviews. It does the same in a session nobody answers in ([owner questions](#owner-questions)), and when it cannot start ([`onFailure: "block"`](https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails)).
- `/cl-workflow:away off` comes back and asks up to 5 [owner questions](#owner-questions), then says how many remain; when already here, it only asks them.
- A `SessionStart` hook starts a new process or a resumed conversation in the mode and adds the state as one line; `/clear`, compaction and a fork keep it. A `UserPromptExpansion` hook sets the state when a prompt's command expands ([hooks reference](https://code.claude.com/docs/en/hooks#userpromptexpansion)), so the same text in a scheduled task, a `/loop` iteration or another session's message sets nothing.
- The state is one file per Claude Code process in the plugin's data folder (`ask/<CLAUDE_PID>.json`); a file it cannot read, or none where the mode is not `here`, means away until off. `CLAUDE_PID` is set in the Bash tool too, so a model could change the state by writing or deleting the file; the [role guard](#role-guard) refuses such writes.
- On Windows (untested) the hooks start `node` without a shell, so `node.exe` itself must be on the PATH: with only a `.cmd` or `.bat` shim, `/cl-workflow:away` cannot keep its state.
- `disableAllHooks` turns the hooks off.

## Owner questions

The coordinator of `/cl-orchestration:coordinate` files an owner question, in the approval layout, as an issue labeled `cl:needs-human` in the project's repository when it has issues on, else in the local queue, `.cedarloom/questions/<project>-<n>.md` in the coordinator's folder, kept out of git. Use a private repository: on a public one the question is public, and the coordinator warns when the run starts and in its report.

| Label | Meaning |
| --- | --- |
| `cl:plan` | CedarLoom may read and plan the issue and ask on it; no work starts |
| `cl:ready-for-agent` | the coordinator may start the issue (default `startLabel`); an answered question gets it, an approval never does ([approvals](../plugins/cl-orchestration/skills/coordinate/approvals.md)) |
| `cl:needs-human` | a question or approval waits for the owner |
| `cl:in-progress` | a worker holds the issue, so it never starts twice; after a worker ended without a pull request (a host restart) it stays until you remove it: `gh issue edit <number> -R <owner/repo> --remove-label cl:in-progress` |
| `cl:deferred` | parked by the owner: it does not start and the question queue skips it |
| `cl:follow-up` | found during other work and reported by workers, reviewers and jobs; in a private repository the coordinator files it (at the run's close, daily, and in a `keepRunning` run when a project goes idle), elsewhere it lists it in the run report; you choose whether it starts |
| `cl:triage` | filed through the issue template; read it before adding another label |

Rejected work is closed as not planned, with no label. `/cl-repo:setup` lists the labels the repository lacks and creates the ones you approve.

`/cl-workflow:away off` asks in batches this repository's `cl:needs-human` issues, then the local queue, where it writes the answer line the coordinator reads. That line counts as the owner's, so the [role guard](#role-guard) refuses edit-tool writes to the queue and commands that reach it, in every subagent and every session except one where `/cl-workflow:away off` set the answer flag; the coordinator files through `approval.mjs file`.

- No hook input tells a typed command from a piped one, so no flag is set outside `default`, `acceptEdits`, `plan`, `auto` and `bypassPermissions` mode, or where `CLAUDE_CODE_ENTRYPOINT` is unset or starts with `sdk-` (Agent SDKs and `claude -p`; a TypeScript SDK or `claude -p` child of an IDE session keeps its value); there `off` changes nothing and the question tool and plan mode stay refused.
- Each `off` logs a line in the plugin's data folder (`ask/log/`); a flagged run shows the runs since the last flagged one.
- A command reaches the queue when its text names `.cedarloom/questions` or a word or redirection target, as the shell decodes it from the session folder and from each folder a prior `cd`, `pushd` or `Set-Location` names, lies in it (`*`, `?` and `[...]` match any name; `*/*` matches none). A session whose folder lies in the queue writes nothing there.
- Not prevented: a process on your account typing into a session in a mode above or writing the queue, state or log files; a command written to get around the check (`.c*/q*`, braces, variables, bracket classes, look-alike letters, `git -C`) or one that acts on `.cedarloom` itself.
- In every session the guard also refuses writes to the state files of `/cl-workflow:away`, commands that name them, and a `claude` launch with `/cl-workflow:away off` or `/away off` in its command line, since `claude -p` expands such a command ([headless mode](https://code.claude.com/docs/en/headless)); with cl-orchestration on, its hook refuses the same in an `orca` command, even one that only mentions both.

## Role guard

The role guard leaves merges, releases and shared repository state to the coordinator as far as a hook can. In every other session with cl-workflow on, and in every subagent, its `PreToolUse` hook for Bash, Monitor and PowerShell (and the edit tools, for the [local queue](#owner-questions)) denies these commands; a Monitor call on a WebSocket runs no command and passes:

- merges and direct commits: `gh pr merge`, `gh repo sync` (also without a repository), the merge, `merge-upstream` and `contents` endpoints of `gh api` with a method other than GET, and its merge and `createCommitOnBranch` mutations sent to the `graphql` endpoint in any case, with leading or trailing slashes, a query or a fragment, or as its full URL; releases: `gh release` except `list`, `view`, `download` and `verify`, `gh workflow run`, and the `dispatches` endpoints of `gh api`
- tag pushes (`git push --tags`, `--follow-tags`, `--mirror`, `tag <name>`, or a refspec under `refs/tags/`, naming a tag of the repository, or naming a version such as `v1.2.0` that is no local branch) and pushes to the default branch (`main`, `master`, the branch `refs/remotes/<remote>/HEAD` names, or the current branch's push target for a `git push` without a refspec), `--all` and `--branches` included, and to a remote whose default branch the hook cannot read: a URL, a path, or a remote without `refs/remotes/<remote>/HEAD` (`git remote set-head <remote> --auto` sets it). A push that names no remote goes where git sends it: the branch's `pushRemote`, `remote.pushDefault`, the branch's remote, the sole remote, else `origin`. Git takes a unique prefix of a long option, so `--tag` counts as `--tags`
- repository settings and security: `gh repo edit`, `rename`, `archive`, `delete` and `deploy-key`, `gh secret` and `gh variable` writes, `gh workflow enable` and `disable`, and `gh api` calls other than GET to settings, rulesets, branch protection, secrets and security alerts
- `gh auth`, gh's own config, aliases and keys
- `git config` except its `--get` and `--list` forms, `git -c`, and `git stash`
- `claude --bare`: hooks do not run in bare mode, this one included, even for a plugin loaded with a flag ([headless mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)).

Only the coordinator's session runs with `CEDARLOOM_ROLE=coordinator` ([how to start it](../README.md#typical-flow)): a variable in your shell profile or the `env` of user settings reaches every session, workers included. A session started from a guarded one is guarded while it runs hooks.

- Subagents inherit the coordinator's environment, so the hook guards every call that names one (`agent_id`, [hooks reference](https://code.claude.com/docs/en/hooks)). Start a session from the coordinator's shell without the variable: `env -u CEDARLOOM_ROLE claude -p "<prompt>"`.
- The hook reads the command as the shell splits it, with the backslash as escape character for Bash and Monitor and the backtick for PowerShell: line continuations join, quoted words stay whole, and each quoted word's text is read again as commands. So `bash -c "gh pr merge 1"` is denied, and so is a commit message or comment text that names such a command: put it in a file (`-F`, `--body-file`).
- Git questions (current branch, tags, the remote's default branch) go to the session's folder, the existing folder a leading `cd`, `pushd` or `Set-Location` moves to, or `git -C <dir>`. A push from the repository `GIT_DIR` (set anywhere in the command) or `git --git-dir` names is denied: push from its folder with `git -C <dir>`. After any other folder change (a variable, substitution, missing folder or `~` target, `cd -`, `popd`, `Pop-Location`, a `cd` after the start of the command) git's folder is unknown: the push must name its branch (`git push origin <branch>`; none or `HEAD` is denied), checked in the session's folder and each folder the command names, each needing a readable `refs/remotes/<remote>/HEAD`. A push without a refspec is denied where no current branch can be read (`git -C` to a missing folder, a detached HEAD), as is every push without git on the hook's PATH.
- It stops a model that forgets its role, not one that works around it (a variable as the command, a git or gh alias, a script, `node -e`, an MCP tool, or a switch to the default branch before a push of the current branch in the same line: `git checkout main && git merge feat/x && git push`). The binding layer is a GitHub token without those rights and rulesets on the default branch (pull requests required) and release tags, which you set up.
- Input the hook cannot read exits 2, which refuses the call, as does a hook that cannot start. The hook is not tested in `bypassPermissions` mode.

### Bot roles

A bot role in `CEDARLOOM_ROLE` (`env` in its home's `.claude/settings.json`) guards a session like any other and also refuses what its procedure does not need, for its subagents too. Any other set value (empty, misspelled, `builder`, `worker-bot`) runs and writes nothing. No role, the coordinator included, runs `gh pr merge --admin` (the merge endpoints are not read for it) or `git commit --no-verify`, which skips the commit hooks, in any spelling git takes: `-n`, grouped with other short options (`-an`, `-nm <message>`), or a prefix such as `--no-veri`, anywhere before the `--` or `--end-of-options` that ends the options (`-m --` takes it as the message).

| `CEDARLOOM_ROLE` | Also refused |
|---|---|
| `project-bot` | every `git push`; it may delete a head branch named `<type>/<number>-<slug>` (the shape fits `release/2026-11` too) with `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`; the hook does not check that the branch is merged or refuse `gh pr close --delete-branch` |
| `reviewer-bot`, `maintain-bot` | every `git push`; `gh` commands other than `repo clone`, `view` and `list`, `pr view`, `diff`, `list`, `checks` and `status`, `issue view`, `list` and `status`, `run view`, `list` and `watch`, `search`, and `gh api` with GET only, so no GraphQL (a GET to `graphql` runs no query); the maintain bot's file tool writes outside `<home>/results/` and `<home>/MEMORY.md` |
| `builder-bot` | the `gh` commands the reviewer bot is refused; a push whose refspec names any branch but the one checked out where git runs (on both sides), a push after `git checkout`, `git switch`, `git rebase`, `git bisect`, `git symbolic-ref HEAD <ref>` or a branch rename or copy in the same command, and a force or delete push (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, `--delete`, `-d`, `--prune`, a refspec starting with `+` or `:`) |

- The table's `gh` rules apply where `gh` runs as the command: first, or after env assignments, shell keywords (`do`, `then`) and wrappers such as `env`, `sudo`, `xargs`, `timeout` and `eval`; in PowerShell also after an assignment, `&` or `.`, and first in a script block. Elsewhere, as in `grep gh`, a guarded session's rules apply.
- The builder bot pushes from a local branch named like its remote branch.
- Merges go through `merge.mjs`, whose `gh` child process no hook sees, so no bot needs a merge exception.

## Coordinator context rotation

An idle coordinator of `/cl-orchestration:coordinate` clears its context and resumes from its handoff file, so it never grows until auto-compaction garbles its state.

Where it applies:

- Only a coordinator whose project folder (where the agent started; a shell `cd` does not move it) holds the handoff file `.cedarloom/runs/handoff.md`, which the skill writes when a run starts and deletes when it closes, and whose session id the file names (`Session: <id>`). A Codex session holds no run: the coordinator needs Claude Code ([Start the run](../plugins/cl-orchestration/skills/coordinate/orca.md#start-the-run)).
- The hooks act only in the session whose id matches and that draws on a surface. A `claude -p` run that resumes it never counts as the coordinator, except for the hand-back after a compaction, which that command hook cannot tell apart. A `claude --resume` of it in a second terminal draws on a surface too, so both processes can restore, clear and move the line.
- After one or more `/clear` in the same Claude Code process, the plugin moves the line to the new session id at the next prompt or turn. Only a `session.end` with reason `clear` arms that move, for one use; any other session end disarms it. If that hook did not run, or a `/resume` away and back follows the `/clear`, the line keeps the old id: no restore, stamp or clear until the owner asks the coordinator to resume the run and it writes its id into the line ([Handoff file](../plugins/cl-orchestration/skills/coordinate/run-files.md#handoff-file)).
- Without the file or that line the hooks do nothing. They also refuse a file that is a symbolic link or sits behind one, and a folder that is no readable git repository or where git tracks anything under `.cedarloom/runs`, so a repository cannot plant the file.

What it does:

- After a `/clear` or compaction, the plugin hands the file back with a line telling the model to run its Resume steps first (Orca's mail, then the run's state): after a `/clear` with the first prompt that is no slash command, as context, or in its own resume prompt; after a compaction through a `SessionStart` command hook that reads it from the folder `CLAUDE_PROJECT_DIR` names, which may not follow a `/cd`, a host's directory change or a worktree move. After the file comes what git shows changed since the coordinator last wrote it (the plugin's own status line does not count): commits on local branches and uncommitted files with a newer modification time, at most 20 each; a git failure leaves the section out. At most 9,000 characters come back: the file, a line saying the rest was cut, then the section in the room left.
- In Claude Code the plugin also writes a status line into the file's status block before a compaction and before its own clear.
- Where Claude Code's built-in guard loads, it passes over the settings hook events of a user-installed mod ([mods admin](https://code.claude.com/docs/en/plugins/mods/admin)): the status line before a compaction and the idle clear do not run, only the hand-back, so the context grows until auto-compaction, or to the window limit when that is off.
- Claude Code only: when the main loop ends a turn with no background task running and no other Stop hook blocking, and its context is above the option `rotateAtTokens` (200000 by default), the plugin runs `/clear` and submits a prompt that resumes the coordinator from the file. `rotateAtPercent` above 0 compares that percent of the model's context window instead; both at 0 turns it off. On a model with a 200k window auto-compaction comes first, so set `rotateAtPercent` there (for example 60). At most one clear every 10 minutes. Without a reported context size the plugin says so once in the transcript and clears nothing at the threshold.
- A `/clear` and resume prompt not finished after 15 minutes are given up: the plugin says so in the transcript and clears again at a later idle stop.

The hooks write only the handoff file. They read it, run `git` in its project folder (`ls-files`, `status`, `rev-parse`, `log`), read the modification times of the changed files git lists, and make no network request of their own.

## Model map

Every CedarLoom caller takes a session's or subagent's model and effort from one map: the coordinator, the workflow phases, the `full` workflow script and bot runs.

```sh
node plugins/cl-workflow/skills/workflow/models.mjs [<project path> | --repository <file>] [--depth quick|standard|deep] [--risk low|medium|high|critical] [--json]
```

- It prints each task's model and effort with the row and file that set it, at standard depth and low risk unless given. Files, later ones overriding earlier ones entry by entry: the defaults `plugins/cl-workflow/skills/workflow/models.json`, the user file `$XDG_CONFIG_HOME/cedarloom/cedarloom.json` (`~/.config/cedarloom/cedarloom.json` when that variable is unset or not absolute, [XDG base directory spec](https://specifications.freedesktop.org/basedir-spec/latest/)), which holds `models` only, and the repository file: the project's `cedarloom.json` in the working tree, or the `--repository` file (`-` reads it from stdin), and none without either. The coordinator and the project bot pass `cedarloom.json` as the policy reader read it from the default branch (`git show <commit>:cedarloom.json` with the `commit` the reader printed, piped to `--repository -`), so a local edit, another checked-out branch or a moved ref does not change their lookup. The schema of both files is `cedarloom.json`'s.
- `models.roles` names `{ model, effort }` pairs; `models.tasks` gives each task a role name or an inline pair. A lookup takes the `tasks` row, then the `depth` row (`quick` or `deep`), which may lower or raise it, then the `risk` rows, which only raise it: `high`, and for `critical` the `high` row first, then the `critical` row.
- Rank for raising: the model first (`haiku`, `sonnet`, `opus`, `fable`), then the effort (`low`, `medium`, `high`, `xhigh`, `max`).
- `implement` and `fix` run only on `opus`: the schema refuses an inline pair with another model there, and the resolver refuses any file whose rows or roles put them on another model at any depth and risk. It exits 1 and names the row and file for every refused file.
- `--hook` prints one line for a session's context, the roles and the command; the plugin's SessionStart hook runs it.
- The plugin's agent files take their `model` and `effort` from the defaults through the generator. The skill lint refuses a literal model value (`--model opus`, `model: opus`, `"model": "opus"`, model `` `opus` ``, a model name next to an effort level) in the plugins outside the defaults file, the resolver, the schema, the agent files, tests and evals.

## Workflows

A typed entry such as `/cl-workflow:dev` is generated from one JSON definition in `plugins/cl-workflow/definitions/<name>.json`: edit the definition, then run the generator. The generator is the only validator of the format and imports Node.js built-ins and the model map's resolver only.

| Field | Value |
|---|---|
| `schemaVersion` | `2` |
| `name` | kebab-case, not ending in `-run`: the command `/<prefix>:<name>` |
| `description` | at most 250 characters, ending in a period |
| `when`, `writes` | optional strings for the skill's `metadata` and [Skills](skills.md) |
| `work` | `software`, `docs` or `research`: the playbook |
| `depth` | `quick`, `standard` or `deep` as a floor, or `classify` for the depth rules alone |
| `script` | `true` writes a workflow script too; it needs `work` `software` and `depth` `deep` |
| `stages` | `[{ id, phases }]`; a phase has `id`, `run` (`session` or `agent`) and an optional `brief` |

- A session phase has `step` (`settle` or `pull-request`; `settle` may set `questions`) and stands first or last in its stage.
- An agent phase has `agent` (a name such as `cl-workflow:review`, never a path), `task` (a task of the [model map](#model-map), whose model and effort the phase runs on), and optionally `loop` and `with` (a phase of the same stage that has a loop, run beside it once).
- A `loop` has `fix` (an earlier agent phase of the same stage), `maxRounds` (1 or 2; 1 where `fix` is the `cl-workflow:plan` agent), `escalate` (boolean) and an optional `recheck` agent.
- A scripted definition starts only the agents `cl-workflow:plan`, `implement`, `test`, `verify`, `review` and `recheck`; a phase with `loop` or `with` and a `recheck` are `verify`, `review` or `recheck`, and `fix` is a `plan` or `implement` phase.
- The test phase (`cl-workflow:test`) runs each test the change adds or changes on the base commit, in a scratch clone, and reports per test `fails on base`, `passes on base` or `not run on base` (blocked by a build or load error from code only other tests use). A test that passes on base is flagged as not proving the change; it fails the phase only when the change claims to fix a bug that test covers.

```sh
node plugins/cl-workflow/generator/generate.mjs <definition>... [--prefix <plugin name>|--prefix ''] [--out <folder>] [--check] [--json]
```

- Defaults: prefix `cl-workflow`, out the plugin folder. It writes `skills/<name>/SKILL.md` and `skills/<name>/agents/openai.yaml` under the out folder, for `script: true` also `workflows/<name>.js`, and refuses to replace such a file that it did not generate. Into the plugin folder it also writes the `model` and `effort` of each `agents/<task>.md` from the model map's defaults. For `script: false` the entry names the playbook; the stages are validated, not written into it.
- A script runs one stage per start, as the workflow `<prefix>:<name>-run`, and holds the stage's order, review rounds, trial and stuck reruns in code. It takes each phase's model and effort from `args.models`, the resolver's `--json` output for the run's depth and risk class, remediations from the `fix` task and separate re-reviews from `recheck`, and reruns a call that fails on another model once on `opus`. The entry starts it and runs the session phases itself; where workflows are off or not allowed, it runs the phases as prose by the playbooks.
- `--check` writes nothing and exits 1 when a generated file differs; the plugin tests run it over the shipped definitions.
- A refusal names the file, the field and the rule, and exits 1; nothing is written. The field is the path to the value: keys joined by `.`, array positions from 0 in brackets, such as `stages[1].phases[3].loop.maxRounds`; an empty field means the whole file. `--json` prints the refusals to standard output as an array of `{ "file", "field", "rule" }` (empty when none).
- A project's own workflow: keep the definition in `.cedarloom/workflows/<name>.json` and run the installed plugin's generator from the project's root with `--prefix '' --out .claude` (`--prefix ''` needs `--out`). The generator of a plugin installed from this marketplace is `~/.claude/plugins/cache/cedarloom/cl-workflow/<version>/generator/generate.mjs` (under `CLAUDE_CODE_PLUGIN_CACHE_DIR` instead of `~/.claude/plugins` when that is set). The entry is then `/<name>` and a script `/<name>-run`; its header names `.cedarloom/workflows/<name>.json` wherever the generator read the file from. The entry needs `cl-workflow` installed and says so when it is not.

### Switch off per project

Every switch except one environment variable is a Claude Code setting: in `.claude/settings.json` it holds for everyone in the project, in `.claude/settings.local.json` for you alone, and managed settings override both ([Settings files](https://code.claude.com/docs/en/settings)). A rule denied at one level cannot be allowed at another ([Permissions](https://code.claude.com/docs/en/permissions)).

- The plugin: `"cl-workflow@cedarloom": false` under `enabledPlugins` removes all `cl-workflow` skills and agents in the project ([`enabledPlugins`](https://code.claude.com/docs/en/settings-reference)). `cl-orchestration` and the bundle `cedarloom` depend on it, so they do not load either and report the dependency as disabled; `cl-repo` keeps working ([Dependencies](https://code.claude.com/docs/en/plugins/dependencies)).
- A copy loaded with `--plugin-dir` has its own key, `cl-workflow@inline`, which the `@cedarloom` key does not reach. With only `"cl-workflow@inline": false` the installed copy loads instead; set both keys to `false` to remove the plugin ([CLI reference](https://code.claude.com/docs/en/plugins/cli-reference)).
- The `workflow` skill: `Skill(cl-workflow:workflow)` blocks the skill by its plugin name, `Skill(skill:workflow)` by any of its names ([Restrict Claude's skill access](https://code.claude.com/docs/en/skills)). It is the only `cl-workflow` skill the model can call on its own. `/cl-workflow:dev`, `full` and `research` load it first and stop when that load is refused.
- The typed entries `away`, `dev`, `full`, `lite`, `plan` and `research` set `disable-model-invocation: true`: the model cannot call them through the Skill tool, but typing the slash command still starts each, and a `Skill` deny rule does not stop that. Switch them off with `enabledPlugins`; the `workflow` skill deny stops `dev`, `full` and `research`, and `lite` only for a task its gate sends to that skill, not `away` and `plan`.
- One phase agent: `Agent(cl-workflow:<agent>)`, with the agents `gather`, `implement`, `plan`, `recheck`, `research`, `review`, `test` and `verify` ([Subagents](https://code.claude.com/docs/en/sub-agents)). A denied call comes back to the model as a tool error naming the rule; a headless run does not list it in `permission_denials`.
- One workflow script: `Workflow(cl-workflow:full-run)` blocks the script, also where an allow rule or `--allowedTools Workflow` allows the Workflow tool ([Workflows](https://code.claude.com/docs/en/workflows)). Until the workspace is trusted, the project file's allow rules are ignored and its deny rules apply ([Project allow rules and workspace trust](https://code.claude.com/docs/en/permissions#project-allow-rules-and-workspace-trust)).
- Every workflow script: `"disableWorkflows": true` removes the Workflow tool and the plugin's scripts in any settings file, the project's included ([`disableWorkflows`](https://code.claude.com/docs/en/settings-reference#disableworkflows)); the environment variable `CLAUDE_CODE_DISABLE_WORKFLOWS=1` does the same for one session ([Turn workflows off](https://code.claude.com/docs/en/workflows#turn-workflows-off)). `/cl-workflow:full` then runs its phases as prose.

## Code Mode (optional)

[Code Mode](https://code.claude.com/docs/en/code-mode) is an experimental, default-off Claude Code feature in which Claude writes JavaScript that makes several tool calls in one step; it may change or be removed in any release.

- It needs Claude Code at the [minimum version](../README.md#requirements) on the native build, an interactive terminal session and a supported model; its [requirements](https://code.claude.com/docs/en/code-mode#requirements) list the models and the settings that block it.
- Turn it on: set `"CLAUDE_CODE_EXPERIMENTAL_CODE_MODE": "1"` in the `env` block of `$HOME/.claude/settings.json`; Claude Code ignores it in a project's settings. A Code Mode session resumes only with it on.
- The hooks of these plugins keep working: each tool call the code makes still reaches the `PreToolUse` hooks, and a hook that fails or times out refuses that call.

## Untrusted input

`/cl-orchestration:coordinate` passes workers and reviewers only issue and pull request text by trusted authors: the repository owner, the policy's `trustedAuthors`, and members or collaborators with `admin` or `write` on the [permission endpoint](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user); a failed lookup passes nothing.

| Text | How it reaches an agent |
|---|---|
| Issue title, body and comments | `thread.mjs` writes the trusted thread and counts the comments left out; the spec's `Thread:` block carries it |
| Unresolved review threads | `thread.mjs --pull` writes each thread a trusted author opened, with its trusted comments, and counts the rest; the reviewer's brief and the worker's follow-up carry it. Access counts in the project's repository |
| Any other comment or review | not passed: the spec and `rules/worker.md` tell workers and reviewers to read none themselves |

Run unattended CedarLoom work only in an isolated environment: a dedicated machine or VM you can restore, or a [dev container](https://code.claude.com/docs/en/devcontainer), with scoped tokens ([Requirements](../README.md#requirements)).
