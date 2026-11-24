# Bots

The Orca bots that run a repository's coordinator work, and the steps the setup skill of cl-repo takes for them. The repository's `docs/agents/bots.md` is this file up to its Setup section, with `<repo>` and `<owner/repo>` filled. Each other `<...>` path stays a placeholder there and is filled, as an absolute path, only in the bot homes:
- `ORCA`: the Orca executable; `<skill folder>`: the `coordinate` skill folder of the installed cl-orchestration plugin; `<maintain folder>`: the `maintain` skill folder of the installed cl-repo plugin.
- `<repo>`: the repository's name; `<owner/repo>`: what `git remote get-url origin` names.
- `<home>`: a bot's home, the folder Orca made for it; `<project home>`: the project bot's; `<clone>`: `<project home>/<repo>`, the project bot's checkout.

## The bots

| Bot | Name | Does | Look (mascot, color; unverified) |
|---|---|---|---|
| Project bot | `<repo>-project` | picks issues, starts the role bot runs, routes pull request events, merges through `merge.mjs` | A1, `#2E6B4F` |
| Planner | `<repo>-planner` | one plan per run for deep work or an unclear approach, then hands the issue on | C1, `#8C7A2E` |
| Worker | `<repo>-worker` | one issue per run | E1, `#2E5F8C` |
| Reviewer | `<repo>-reviewer` | one review per run | B1, `#8C5A2E` |
| Fixer | `<repo>-fixer` | one round of fixes per run | F1, `#6B3A8C` |
| Maintainer | `<repo>-maintainer` | one `cl-repo:maintain` pass per scheduled run; its findings wait for the owner's approval | D1, `#4F5B66` |

The user creates each bot in Orca: from a bot's chat, `ORCA bot create --offer --name <name> --purpose '<Does, as one sentence>'` puts the card there, and the user sets the look with Edit and presses Create bot; with no bot yet, the user creates it by hand with that name, purpose and look. Then, in the bot's settings in Orca (unverified: these settings and a connector limited to one repository): the project bot gets the GitHub connector for `<owner/repo>` only, each role bot no connector and its memory off; every bot its nightly memory tidy-up off.

Orca's built-in templates: `security-check` may be added as an extra bot. `pr-review` only in a repository without `docs/agents/orchestration.json`, which gets no project or role bots: elsewhere the reviewer bot reviews.

## Bot homes

Per bot:
- `<home>/SOUL.md`: the purpose line Create bot wrote, then `<skill folder>/SOUL.md`, the brief every run reads. An update compares it with the installed brief and proposes the difference.
- `<home>/.claude/settings.json`, each role bot (the sandbox covers shell commands, the `Edit` rules the file tools; `<other home>` repeats for each other bot; web and MCP tools stay off; `<role>` is `planner`, `worker`, `reviewer`, `fixer` or `maintainer`):

```json
{
  "env": { "CEDARLOOM_ROLE": "<role>-bot" },
  "permissions": {
    "deny": [
      "Bash(gh pr merge *)", "WebFetch", "WebSearch", "mcp__*",
      "Edit(/<home>/*.md)", "Edit(/<home>/.mcp.json)", "Edit(/<home>/state/**)", "Edit(/<home>/.claude/**)",
      "Edit(/<home>/clones/CLAUDE.md)", "Edit(/<home>/clones/CLAUDE.local.md)", "Edit(/<home>/clones/.claude/**)",
      "Edit(/<other home>/**)"
    ]
  },
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "filesystem": { "denyWrite": ["<home>/SOUL.md", "<home>/MEMORY.md", "<home>/CLAUDE.md", "<home>/CLAUDE.local.md", "<home>/AGENTS.md", "<home>/.mcp.json", "<home>/state", "<home>/.claude", "<home>/clones/CLAUDE.md", "<home>/clones/CLAUDE.local.md", "<home>/clones/.claude", "<other home>"] },
    "network": { "allowedDomains": ["github.com", "api.github.com", "*.githubusercontent.com"] }
  }
}
```

  Claude Code and Codex load `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` and `.mcp.json` from the folder a run starts in, and Claude Code loads `CLAUDE.md` and `.claude/` from `clones/` once a run reads files below it, so a run that wrote one would steer the next; a refused `MEMORY.md` write keeps a role bot's memory off. Each `<...>` is absolute, so every `Edit` rule starts with `//`. `allowedDomains` adds the policy's `sandbox.allowedDomains`.
- The maintainer bot also denies `"Edit"`, `"MultiEdit"` and `"NotebookEdit"`, as it reads `<maintain folder>/SKILL.md` without that skill's tool limits; the role guard refuses its `Write` outside `<home>/results/`, links resolved.
- `<project home>/.claude/settings.json`, the project bot: `env` `{ "CEDARLOOM_ROLE": "project-bot" }`, `permissions.deny` `Bash(gh pr merge *)`, `Edit(/<project home>/SOUL.md)`, `Edit(/<project home>/MEMORY.md)`, `Edit(/<project home>/.claude/**)` and `Edit(/<project home>/pre-merge.json)`. Its shell runs unsandboxed, so the `Edit` rules cover its file tools only and `Bash(gh pr merge *)` is a backstop (`gh api` passes it).
- The project bot's `<clone>` (`gh repo clone <owner/repo> <clone>`) and empty `<project home>/state/` and `<project home>/prompts/`.

`<project home>/pre-merge.json`, only when the user names a command: `{ "command": ["<program>", "<args>"] }`, the program by its absolute path. It gets each merge's and each post's text on stdin and must exit 0; none by default.

Owner questions go where `<skill folder>/approvals.md` (Where it goes) says; the local queue is `<project home>/.cedarloom/questions/`, answered with `/cl-workflow:questions` there.

## Automations

On the project bot, each `--runs-in new --results-to chat --model opus --effort high`, its prompt naming one procedure file:

```text
ORCA automations create --bot <repo>-project --name '<owner/repo> pick' --trigger '*/30 * * * *' --precheck "node <skill folder>/precheck.mjs --prompts <project home>/prompts <clone>" --prompt 'Pick sweep: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot <repo>-project --name '<owner/repo> reconcile' --trigger daily --time <HH:MM> --prompt 'Daily reconciliation: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot <repo>-project --name '<owner/repo> maintain' --trigger '<MM> <HH> * * <weekday>' --prompt 'Weekly maintenance with <maintain folder>: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot <repo>-project --name '<owner/repo> catch-up' --trigger '*/15 * * * *' --precheck "node <skill folder>/precheck.mjs --catch-up <clone> --state <project home>/state" --precheck-timeout 120 --prompt 'Catch-up sweep: take <skill folder>/bot-catch-up.md.' <flags> --json
```

Event rules and role bot runs are the project bot's runs' to make, never setup's. Event rules fire only once `ORCA automations trigger-options --bot <repo>-project` lists `github` events (Orca signed in, the Orca GitHub app on `<owner/repo>`); until then the sweeps alone find the work.

## Setup

The setup skill of cl-repo takes these steps in its own phases. It creates no bot.
- **Which bots.** None where no Orca executable is found or the user declines. With `docs/agents/orchestration.json` on the default branch or in the plan: the project bot and the five role bots. Templates, if wanted, as [The bots](#the-bots) says.
- **Read only.** `ORCA bot list` and the homes of the bots it lists, `ORCA automations list --json`, an existing `docs/agents/bots.md`, and `<skill folder>`, which must hold `merge.mjs`, `precheck.mjs` and the procedures Automations names, and `<maintain folder>/SKILL.md`: a missing one skips the bots, naming it. Orca keys a bot's home by its name, so a listed bot whose `<clone>` has another `origin` than `<owner/repo>` stops the step, naming that repository. A plugin update moves both folders: compare each automation's filled text, its `--precheck` string included, with the plan and `SOUL.md`'s paths with them, and propose each that differs and a missing `<project home>/prompts/`. Ask the reconciliation time, the maintenance weekday and time, and a pre-merge command (none recommended).
- **Plan.** A filled path stays inside quotes in each command, in single quotes within a `--precheck` string; a path that holds a quote stops the step, naming it. `docs/agents/bots.md`, committed, with no local path; per bot its card (name, purpose, look), its home files, the clone and the automations, each with its filled text. Bot homes and automations belong to the repository's bots, not to user scope.
- **Apply.** Per bot `ORCA bot list` lacks, put its card in the bot chat the session runs in, else ask the user to create it as [The bots](#the-bots) says, and wait for Create bot, then for the user's answer that the Orca settings named there are set; a listed bot keeps its card, and only its differences are applied. Then write its home files (never its `MEMORY.md`) and the clone. Before the project bot's automations, a test run on each role bot, `ORCA automations create --bot <role bot> --name '<repo> guard test' --runs-in new --once --by <UTC now plus one minute> --prompt '<the test>' --json`, asks it to write its `MEMORY.md` with the file tool and its `CLAUDE.md` and `clones/CLAUDE.md` with a shell command, to fetch `https://example.com` with `WebFetch` and with `curl`, to write a file under `<home>/results/` with the file tool and one under `<home>/clones/` with a shell command (the maintainer also one with the file tool), to run `gh api rate_limit` and `gh issue comment 0 -R <owner/repo> --body guard-test`, and to name every MCP tool it can call. Its result, in that bot's chat, must show the first five refused by a deny rule or the sandbox, not by a file mode, the next three done, the comment and the maintainer's file tool write under `clones/` refused by the role guard, and no MCP tool; no result fails the test. The project bot's test run asks for `git -C <clone> push --dry-run origin HEAD:refs/heads/guard-test`, which the role guard must refuse. A role bot whose memory stays on (its `MEMORY.md` write not refused) gets no runs, and its other results still count: Apply adds to `docs/agents/bots.md` that fresh workers take that role. Back up an existing `MEMORY.md` and `CLAUDE.md` and restore them afterwards, else remove the files the run made. Whether a bot run loads its home's `.claude/settings.json`, and in which permission mode, is unverified. Passed, and `docs/agents/orchestration.json` on the default branch: create the automations, the catch-up sweep last. Otherwise create none and report them as waiting, with the reason: the next setup run plans them as differences. A failed test also proposes `ORCA automations edit <id> --disabled` for the existing ones.
