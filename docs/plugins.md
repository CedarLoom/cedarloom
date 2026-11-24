# The plugins

What the CedarLoom plugins add to a Claude Code session besides their skills: hooks and their settings, workflow definitions, Code Mode, and how the coordinator filters untrusted issue and pull request text. Install, update and uninstall steps are in the [README](../README.md); the skills are in [Skills](skills.md).

| Plugin | Hooks | Settings |
|---|---|---|
| `cl-workflow` | [Terminal questions](#terminal-questions), [role guard](#role-guard) | `mode` |
| `cl-orchestration` | [Coordinator context rotation](#coordinator-context-rotation) | `rotateAtTokens`, `rotateAtPercent` |
| `cl-repo` | none | none |

Every hook runs `node`, so Node.js must be on the PATH. Set a plugin's options with `/plugin` (Installed tab, Configure options) or under `pluginConfigs` in `$HOME/.claude/settings.json`, then start a new session.

## Terminal questions

In a Claude Code session with the cl-workflow plugin on, the agent may ask you with the question tool (`AskUserQuestion`) and plan mode (`EnterPlanMode`) until you go away.

- The plugin option `mode` sets how a session starts: `here` (default) or `away`; any other value starts away. A job or bot sets `away` in its settings: `"pluginConfigs": { "cl-workflow@cedarloom": { "options": { "mode": "away" } } }` in user settings or a `--settings` file (project settings do not set plugin options).
- `/cl-workflow:away` goes away at once, until `/cl-workflow:away off`; `30` or `30m` (minutes), `2h` or `until 07:30` (local time, the next such time) set an end. A span that ends before the current away, or text it cannot read, changes nothing.
- While away, the plugin's `PreToolUse` hook refuses both with the rule as its reason: open questions with recommendations go into one issue per task in the issue tracker the project names, else the report; safe, reversible recommendations are taken and the work goes on; no chat-text interviews either. It refuses both in a session nobody answers in too ([owner questions](#owner-questions)).
- `/cl-workflow:away off` comes back and asks up to 5 [owner questions](#owner-questions), then says how many remain; when already here, it only asks them.
- A `SessionStart` hook starts a new Claude Code process or a resumed conversation in the mode and adds the state as one line; `/clear`, compaction and a fork keep the state.
- A `UserPromptExpansion` hook sets the state; that event fires when a prompt's command expands ([hooks reference](https://code.claude.com/docs/en/hooks#userpromptexpansion)). By that reference the same text in a scheduled task, a `/loop` iteration or a message from another session sets nothing; the skill is user-only.
- The state is one file per Claude Code process in the plugin's data folder (`ask/<CLAUDE_PID>.json`); one it cannot read, or none where the mode is not `here`, is away until off. `CLAUDE_PID` is set in the Bash tool too, so a model that writes or deletes that file changes the state; the [role guard](#role-guard) refuses such writes.
- When the refusal hook cannot start, both are refused ([`onFailure: "block"`](https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails)).
- On Windows (untested) the hooks start `node` without a shell, so `node.exe` itself must be on the PATH: with only a `.cmd` or `.bat` shim, `/cl-workflow:away` cannot keep its state.
- `disableAllHooks` turns the hooks off.
- Codex runs none of these hooks.

## Owner questions

The coordinator of `/cl-orchestration:coordinate` files an owner question, in the approval layout, as an issue labeled `cl:needs-human` in the project's repository when it has issues on, else in the local queue, `.cedarloom/questions/<project>-<n>.md` in the coordinator's folder, kept out of git. A private repository is recommended: on a public one the question is public, and the coordinator warns in the session when the run starts and again in its report.

| Label | Meaning |
| --- | --- |
| `cl:plan` | CedarLoom may read and plan the issue and ask on it; it does not start work |
| `cl:ready-for-agent` | the coordinator may start the issue (the default `startLabel`); a question you answered gets it, but an approval never does; a question whose answer drops the work is closed as not planned, and one left open with the label is listed for you, not started |
| `cl:needs-human` | a question or approval waits for the owner |
| `cl:in-progress` | a worker holds the issue, so it never starts twice; a label left after its worker ended without a pull request (a host restart) holds the issue until you take it off: `gh issue edit <number> -R <owner/repo> --remove-label cl:in-progress` |
| `cl:deferred` | the owner parked it: it does not start and the question queue skips it |
| `cl:follow-up` | found during other work and reported by workers, reviewers and jobs; in a private repository the coordinator files it, sized for one pull request, at the run's close, daily, and in a `keepRunning` run when a project goes idle, in any other repository it lists it in the run report; you choose whether it starts |
| `cl:triage` | filed through the issue template; read it before adding another label |

Rejected work is closed as not planned, with no label. `/cl-repo:setup` lists the labels the repository lacks and creates the ones you approve.

`/cl-workflow:away off` asks up to 5 in batches: this repository's `cl:needs-human` issues, then the local queue, where it writes the answer line the coordinator reads. That line counts as the owner's, so the [role guard](#role-guard) refuses edit-tool writes to the queue, and commands that reach it, in every subagent and every session but one where `/cl-workflow:away off` set the answer flag; the coordinator files through `approval.mjs file`.

- No hook input tells a typed command from a piped one, so no flag is set outside `default`, `acceptEdits`, `plan`, `auto` and `bypassPermissions` mode, or where `CLAUDE_CODE_ENTRYPOINT` is unset or starts with `sdk-` (Agent SDKs and `claude -p`, except that a TypeScript SDK or `claude -p` child of an IDE session keeps its value); there `off` changes nothing and the question tool and plan mode stay refused.
- Each `off` logs a line in the plugin's data folder (`ask/log/`); a flagged run shows the runs since the last flagged one.
- Not prevented: a process on your account typing into a session in a mode above, writing the queue, state or log files, or naming the command in a file, a variable or a spelling the shell joins.
- A command reaches the queue when its text names `.cedarloom/questions` or when a word or redirection target, read as the shell decodes it from the session folder and from each folder a `cd`, `pushd` or `Set-Location` before it names, lies in it (`*`, `?` and `[...]` match any name, but two such segments in a row (`*/*`) match no folder).
- It does not catch a command written to get around it (`.c*/q*`, braces, variables, bracket classes, look-alike letters, a tool's own folder option such as `git -C`), nor one that acts on `.cedarloom` itself. A session whose folder lies in the queue writes nothing there.
- The guard also refuses, in every session, writes to the state files of `/cl-workflow:away`, commands that name them, and a `claude` launch with `/cl-workflow:away off`, `/away off`, `/cl-workflow:questions` or `/questions` in its command line: `claude -p` expands such a command ([headless mode](https://code.claude.com/docs/en/headless)); where cl-orchestration is on, its hook refuses the same in an `orca` command, even one that only mentions both.

## Role guard

The role guard leaves merges, releases and shared repository state to the coordinator as far as a hook can. In every other session with the cl-workflow plugin on, and in every subagent, its `PreToolUse` hook for the Bash, Monitor and PowerShell tools (and the edit tools, for the [local queue](#owner-questions)) denies these commands as it reads them. A Monitor call on a WebSocket runs no command and passes.

- merging and direct commits (`gh pr merge`, `gh repo sync`, its local form without a repository included, the merge, `merge-upstream` and `contents` endpoints of `gh api` with a method other than GET, and its merge and `createCommitOnBranch` mutations, sent to the `graphql` endpoint in any case, with leading or trailing slashes, a query or a fragment, or as its full URL) and releases (`gh release` except `list`, `view`, `download` and `verify`, `gh workflow run`, and the `dispatches` endpoints of `gh api`)
- tag pushes (`git push --tags`, `--follow-tags`, `--mirror`, `tag <name>`, or a refspec that is under `refs/tags/`, names a tag of the repository, or names a version such as `v1.2.0` and is no local branch) and pushes to the default branch (`main`, `master`, the branch `refs/remotes/<remote>/HEAD` names, or the current branch's push target for a `git push` without a refspec), `--all` and `--branches` included, and pushes to a remote whose default branch the hook cannot read: a URL, a path, or a remote without `refs/remotes/<remote>/HEAD` (`git remote set-head <remote> --auto` sets it); a push that names no remote goes where git sends it: the branch's `pushRemote`, `remote.pushDefault`, the branch's remote, the sole remote, else `origin`; git takes a unique prefix of a long option, so `--tag` counts as `--tags`
- repository settings and security: `gh repo edit`, `rename`, `archive`, `delete` and `deploy-key`, `gh secret` and `gh variable` writes, `gh workflow enable` and `disable`, and `gh api` calls other than GET to settings, rulesets, branch protection, secrets and security alerts
- `gh auth`, gh's own config, aliases and keys
- `git config` except its `--get` and `--list` forms, `git -c`, and `git stash`
- `claude --bare`: hooks do not run in bare mode, this one included, even for a plugin loaded with a flag ([headless mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)). No plugin line starts `claude` with `--bare`, as a command line or a spawn call's argument list (skill lint). Bare mode is announced as the future default for `-p`; once it is, such a launch from a guarded session runs unguarded unless the hook covers it.

Only the coordinator's session runs with `CEDARLOOM_ROLE=coordinator` ([how to start it](../README.md#typical-flow)): a variable in your shell profile or the `env` of user settings reaches every session, workers included. Every other session with the plugin on is guarded, as is one started from a guarded one while it runs hooks.

- Subagents inherit the coordinator's environment, so the hook guards every call that names one (`agent_id`, [hooks reference](https://code.claude.com/docs/en/hooks)). Start a session from the coordinator's shell without the variable: `env -u CEDARLOOM_ROLE claude -p "<prompt>"`.
- The hook reads the command as the shell splits it, with the backslash as escape character for Bash and Monitor and the backtick for PowerShell: line continuations join, quoted words stay whole, and the text of each quoted word is read again as commands, so `bash -c "gh pr merge 1"` is denied, and so is a commit message or comment text that names such a command: put that text in a file (`-F`, `--body-file`).
- Git questions (the current branch, tags, the remote's default branch) go to the session's folder, to the existing folder a `cd`, `pushd` or `Set-Location` at the start of the command moves to, or to `git -C <dir>`. A push from the repository `GIT_DIR` (set anywhere in the command) or `git --git-dir` names is denied: push from its folder with `git -C <dir>`. After any other folder change git's folder is unknown: a target that is a variable, a substitution, a missing folder or a `~` path, `cd -`, `popd`, `Pop-Location`, and a `cd` later in the command, after a keyword, in parentheses, braces, a pipeline, quoted text, a comment or a here-document. A push then names its branch (`git push origin <branch>`; none or `HEAD` is denied), checked in the session's folder and each folder the command names, each needing a readable `refs/remotes/<remote>/HEAD`. A push without a refspec is denied where no current branch can be read (`git -C` to a missing folder, a detached HEAD), and every push without git on the hook's PATH.
- The hook asks git for the current branch before the command runs, so a push of the current branch after a switch to the default branch in the same line passes (`git checkout main && git merge feat/x && git push`).
- It stops a model that forgets its role, not one that works around it (a variable as the command, a git or gh alias, a script, `node -e`, an MCP tool). The binding layer is a GitHub token without those rights and rulesets on the default branch (pull requests required) and release tags, which you set up.
- Input the hook cannot read exits 2, which refuses the call; so does a hook that cannot start ([`onFailure: "block"`](https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails)). The hook is not tested in `bypassPermissions` mode.
- Codex runs no such hook.

### Bot roles

A bot role in `CEDARLOOM_ROLE` (`env` in its home's `.claude/settings.json`) guards a session like any other and also refuses what its procedure does not need, for its subagents too. Any other set value (empty, misspelled, `planner`) runs and writes nothing; an unset role is an ordinary guarded session. No role, the coordinator included, runs `gh pr merge --admin`; the merge endpoints are not read for it.

| `CEDARLOOM_ROLE` | Also refused |
|---|---|
| `project-bot` | every `git push`; it may delete a head branch named `<type>/<number>-<slug>` (the shape fits `release/2026-11` too) with `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`, and the hook does not check that the branch is merged or refuse `gh pr close --delete-branch` |
| `planner-bot`, `reviewer-bot`, `maintainer-bot` | every `git push`; `gh` commands other than `repo clone`, `view` and `list`, `pr view`, `diff`, `list`, `checks` and `status`, `issue view`, `list` and `status`, `run view`, `list` and `watch`, `search`, and `gh api` with GET only, so no GraphQL (a GET to `graphql` runs no query); the maintainer's file tool writes outside `<home>/results/` |
| `fixer-bot`, `worker-bot` | the `gh` commands the reviewer bot is refused; a push whose refspec names any branch but the one checked out where git runs (on both sides), a push after `git checkout`, `git switch`, `git rebase`, `git bisect`, `git symbolic-ref HEAD <ref>` or a branch rename or copy in the same command, and a force or delete push (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`, `--delete`, `-d`, `--prune`, a refspec starting with `+` or `:`) |

- The `gh` rules of the table apply where `gh` runs as the command: first, or after env assignments, shell keywords (`do`, `then`) and wrappers such as `env`, `sudo`, `xargs`, `timeout` and `eval`; in PowerShell also after an assignment (`$r = gh ...`), `&` or `.`, and first in a script block (`ForEach-Object { gh ... }`, `try { gh ... } catch { }`). Elsewhere, as in `grep gh`, the rules of a guarded session apply.
- A fixer or worker bot pushes from a local branch named like its remote branch.
- Merges go through `merge.mjs`, whose `gh` child process no hook sees, so no bot needs a merge exception.

## Coordinator context rotation

A long-running coordinator of `/cl-orchestration:coordinate` starts over with a fresh context when it is idle, instead of growing until auto-compaction garbles its state.

Where it applies:

- Only a coordinator whose project folder (where the agent started; a shell `cd` does not move it) holds the handoff file `.cedarloom/runs/handoff.md`, which the skill writes when a run starts and deletes when it closes, and whose session id the file names (`Session: <id>`). A Codex session holds no run: the coordinator needs Claude Code ([Start the run](../plugins/cl-orchestration/skills/coordinate/orca.md#start-the-run)), so the Codex `SessionStart` hook finds no file that names its session.
- The hooks act only in the session whose id matches, and only in a session that draws on a surface. A `claude -p` run that resumes the coordinator's session carries its id but never counts as the coordinator, except for the hand-back after a compaction: that command hook does not tell such a run apart. A `claude --resume` of the coordinator's session in a second terminal draws on a surface, so both processes can restore, clear and move the line.
- After a `/clear`, or several in a row, in the same Claude Code process, the plugin moves the line to the new session id at the next prompt or turn. Only a `session.end` with reason `clear` arms that move, for one use, and any other session end disarms it, so an id change with no `/clear` before it leaves the line as it is. A `/clear` whose `session.end` hook did not run, and a `/clear` followed by a `/resume` away and back, leave the line at the old id: the coordinator then gets no restore, stamp or clear until the owner asks it to resume the run, when it writes its id into the line ([Handoff file](../plugins/cl-orchestration/skills/coordinate/SKILL.md#handoff-file)).
- Without the file or that line the hooks do nothing, and they refuse a file that is a symbolic link or sits behind one, and a folder that is no readable git repository or where git tracks anything under `.cedarloom/runs`, so a repository cannot plant the file; the coordinator's folder must be a git repository.

What it does:

- After a `/clear` or compaction, the plugin hands the file back with a line telling the model to run its Resume steps first (Orca's mail, then the run's state). After a `/clear` it comes with the first prompt that is no slash command, as context, or in the text of the plugin's own resume prompt; after a compaction a `SessionStart` command hook reads it from the folder `CLAUDE_PROJECT_DIR` names. The module reads the session's project root, which follows a `/cd`, a host's directory change and a worktree move; `CLAUDE_PROJECT_DIR` may not, so after such a move a compaction may not bring the file back. After the file comes what git shows changed since the coordinator last wrote it (the plugin's own status line does not count): commits on local branches and uncommitted files with a newer modification time, at most 20 each; a git failure leaves the section out. At most 9,000 characters come back: the file first, with a line saying the rest was cut, then the section in the room left.
- In Claude Code the plugin also writes a status line into the file's status block before a compaction and before its own clear.
- Where Claude Code's built-in guard loads, it passes over the settings hook events of a mod the user installed ([mods admin](https://code.claude.com/docs/en/plugins/mods/admin)). There the status line before a compaction and the idle clear do not run, only the hand-back, and the coordinator's context grows until auto-compaction, or to the window limit when auto-compaction is off.
- Claude Code only: when the main loop ends a turn with no background task running and no other Stop hook blocking, and its context is above the option `rotateAtTokens` (200000 by default), the plugin runs `/clear` and submits a prompt that resumes the coordinator from the file. `rotateAtPercent` above 0 compares that percent of the model's context window instead; both at 0 turns it off. On a model with a 200k context window auto-compaction comes first, so set `rotateAtPercent` there (for example 60). At most one clear every 10 minutes. When Claude Code reports no context size, the plugin says so once in the transcript and clears nothing at the threshold.
- A `/clear` and resume prompt that have not finished after 15 minutes are given up: the plugin says so in the transcript, submits no resume prompt, and clears again at a later idle stop.

The hooks write only the handoff file. They read it, run `git` in its project folder (`ls-files`, `status`, `rev-parse`, `log`), read the modification times of the changed files git lists, and make no network request of their own.

## Workflows

A typed entry such as `/cl-workflow:dev` is generated from one JSON definition in `plugins/cl-workflow/definitions/<name>.json`; edit the definition, then run the generator. The generator is the only validator of the format and imports Node.js built-ins only.

| Field | Value |
|---|---|
| `schemaVersion` | `2` |
| `name` | kebab-case, not ending in `-run`: the command `/<prefix>:<name>` |
| `description` | at most 250 characters, ending in a period |
| `when`, `writes` | optional strings for the skill's front matter and [Skills](skills.md) |
| `work` | `software`, `docs` or `research`: the playbook |
| `depth` | `quick`, `standard` or `deep` as a floor, or `classify` for the depth rules alone |
| `script` | `true` writes a workflow script too; it needs `work` `software` and `depth` `deep` |
| `stages` | `[{ id, phases }]`; a phase has `id`, `run` (`session` or `agent`) and an optional `brief` |

- A session phase has `step` (`settle` or `pull-request`; `settle` may set `questions`) and stands first or last in its stage.
- An agent phase has `agent` (a name such as `cl-workflow:review`, never a path), `model` (`haiku`, `sonnet`, `opus`, `fable` or `inherit`), and optionally `effort` (`low` to `max`), `loop` and `with` (a phase of the same stage that has a loop, run beside it once).
- A `loop` has `fix` (an earlier agent phase of the same stage), `maxRounds` (1 or 2; 1 where `fix` is the `cl-workflow:plan` agent), `escalate` (boolean) and an optional `recheck` agent.
- A scripted definition starts only the agents `cl-workflow:plan`, `implement`, `test`, `verify`, `review` and `recheck`; a phase with `loop` or `with` and a `recheck` are `verify`, `review` or `recheck`, and `fix` is a `plan` or `implement` phase.
- The test phase (`cl-workflow:test`) runs each test the change adds or changes on the base commit, in a scratch clone, and reports per test `fails on base` or `passes on base`. A test that passes on base is flagged as not proving the change; it fails the phase only when the change claims to fix a bug that test covers.

```sh
node plugins/cl-workflow/generator/generate.mjs <definition>... [--prefix <plugin name>|--prefix ''] [--out <folder>] [--check] [--json]
```

- Defaults: prefix `cl-workflow`, out the plugin folder. It writes `skills/<name>/SKILL.md` and `skills/<name>/agents/openai.yaml` under the out folder, for `script: true` also `workflows/<name>.js`, and refuses to replace such a file that it did not generate. For `script: false` the entry names the playbook; the stages are validated, not written into it.
- A script runs one stage per start, as the workflow `<prefix>:<name>-run`, and holds the stage's order, review rounds, trial and stuck reruns in code. The entry starts it and runs the session phases itself; where workflows are off or not allowed, the entry runs the same phases as prose by the playbooks.
- `--check` writes nothing and exits 1 when a generated file differs; the plugin tests run it over the shipped definitions.
- A refusal names the file, the field and the rule, and exits 1; the generator then writes nothing. The field is the path to the value: keys joined by `.`, array positions from 0 in brackets, such as `stages[1].phases[3].loop.maxRounds`; an empty field means the whole file. `--json` prints the refusals to standard output as an array of `{ "file", "field", "rule" }` (an empty array when none).
- A project's own workflow: keep the definition in `.cedarloom/workflows/<name>.json` and run the installed plugin's generator from the project's root with `--prefix '' --out .claude` (`--prefix ''` needs `--out`). With the plugin installed from this marketplace, the generator is `~/.claude/plugins/cache/cedarloom/cl-workflow/<version>/generator/generate.mjs` (under `CLAUDE_CODE_PLUGIN_CACHE_DIR` instead of `~/.claude/plugins` when that is set). The entry is then `/<name>`, a script runs as `/<name>-run`, and its header names `.cedarloom/workflows/<name>.json` wherever the generator read the file from. The entry needs `cl-workflow` installed and says so when it is not.

### Switch off per project

Every switch except one environment variable is a Claude Code setting. In the project's `.claude/settings.json` it holds for everyone in the project, in `.claude/settings.local.json` for you alone, and managed settings override both ([Settings files](https://code.claude.com/docs/en/settings)). A rule denied at one level cannot be allowed at another ([Permissions](https://code.claude.com/docs/en/permissions)).

```json
{
  "enabledPlugins": { "cl-workflow@cedarloom": false },
  "permissions": {
    "deny": [
      "Skill(cl-workflow:workflow)",
      "Agent(cl-workflow:review)",
      "Workflow(cl-workflow:full-run)"
    ]
  },
  "disableWorkflows": true
}
```

- The plugin: `"cl-workflow@cedarloom": false` under `enabledPlugins` removes all `cl-workflow` skills and agents in the project ([`enabledPlugins`](https://code.claude.com/docs/en/settings-reference)). The plugins that depend on it, `cl-orchestration` and the bundle `cedarloom`, then do not load either and report the dependency as disabled; `cl-repo` keeps working ([Dependencies](https://code.claude.com/docs/en/plugins/dependencies)).
- A copy loaded with `--plugin-dir` has its own key, `cl-workflow@inline`, and the `@cedarloom` key does not reach it. With only `"cl-workflow@inline": false`, the installed copy loads instead; set both keys to `false` to remove the plugin from such a session ([CLI reference](https://code.claude.com/docs/en/plugins/cli-reference)).
- The `workflow` skill: `Skill(cl-workflow:workflow)` blocks the skill by its plugin name, `Skill(skill:workflow)` by any of its names ([Restrict Claude's skill access](https://code.claude.com/docs/en/skills)). It is the only `cl-workflow` skill the model can call on its own. `/cl-workflow:dev`, `full` and `research` load it first and stop when that load is refused.
- The typed entries: `ask`, `away`, `dev`, `full`, `plan`, `questions` and `research` set `disable-model-invocation: true`, so the model cannot call them through the Skill tool. You still start each by typing its slash command, which a `Skill` deny rule does not stop. To switch them off, use `enabledPlugins`; the `workflow` skill deny stops `dev`, `full` and `research`, but not `ask`, `away`, `plan` and `questions`.
- One phase agent: `Agent(cl-workflow:<agent>)`, with the agents `gather`, `implement`, `plan`, `recheck`, `research`, `review`, `test` and `verify` ([Subagents](https://code.claude.com/docs/en/sub-agents)). A denied call comes back to the model as a tool error naming the rule; a headless run does not list it in `permission_denials`, so a check that reads only that list misses it.
- One workflow script: `Workflow(cl-workflow:full-run)` blocks the script, also where the Workflow tool is allowed by an allow rule or `--allowedTools Workflow` ([Workflows](https://code.claude.com/docs/en/workflows)). Until the workspace is trusted, the project file's allow rules are ignored and its deny rules apply ([Project allow rules and workspace trust](https://code.claude.com/docs/en/permissions#project-allow-rules-and-workspace-trust)).
- Every workflow script: `"disableWorkflows": true` removes the Workflow tool and the plugin's scripts in any settings file, the project's included ([`disableWorkflows`](https://code.claude.com/docs/en/settings-reference#disableworkflows)); the environment variable `CLAUDE_CODE_DISABLE_WORKFLOWS=1` does the same for one session ([Turn workflows off](https://code.claude.com/docs/en/workflows#turn-workflows-off)). `/cl-workflow:full` then runs its phases as prose.

## Code Mode (optional)

[Code Mode](https://code.claude.com/docs/en/code-mode) is an experimental Claude Code feature in which Claude writes JavaScript that makes several tool calls in one step. It is off by default and may change or be removed in any release.

- It needs, among others: Claude Code at the [minimum version](../README.md#requirements) on the native build, an interactive terminal session, and Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.2. Its [requirements](https://code.claude.com/docs/en/code-mode#requirements) list the rest and the settings that block it.
- Turn it on: set `"CLAUDE_CODE_EXPERIMENTAL_CODE_MODE": "1"` in the `env` block of `$HOME/.claude/settings.json`. Claude Code ignores it in a project's settings. A Code Mode session resumes only with it on.
- The hooks of these plugins keep working: each tool call the code makes still reaches the `PreToolUse` hooks, and a hook that fails or times out refuses that call.

## Untrusted input

Issue and pull request text can carry instructions. `/cl-orchestration:coordinate` passes workers and reviewers only text by trusted authors: the repository owner, the policy's `trustedAuthors`, and members or collaborators with `admin` or `write` on the [permission endpoint](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user). A failed lookup passes nothing.

| Text | How it reaches an agent | Check |
|---|---|---|
| Issue title, body and comments | `thread.mjs` writes the trusted thread and counts the comments left out; the spec's `Thread:` block carries it | `thread.test.mjs` |
| Unresolved review threads | `thread.mjs --pull` writes each thread a trusted author opened, with its trusted comments, and counts the rest; the reviewer's brief and the worker's follow-up carry it. Access counts in the project's repository | `thread.test.mjs` |
| Any other comment or review | not passed: the spec and `rules/worker.md` tell workers and reviewers to read none themselves | wording only |

Run unattended workers in a sandbox or a dev container with a network allow-list ([Requirements](../README.md#requirements)).
