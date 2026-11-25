# Bots

The Orca bots that run a repository's coordinator work, and the steps the setup skill of cl-repo takes for them. The repository's `docs/agents/bots.md` is this file up to its Setup section, with `<repo>` and `<owner/repo>` filled. Each other `<...>` path stays a placeholder there and is filled, as an absolute path, only in the bot homes:
- `ORCA`: the Orca executable; `<skill folder>`: the `coordinate` skill folder of the installed cl-orchestration plugin; `<maintain folder>`: the `maintain` skill folder of the installed cl-repo plugin.
- `<repo>`: the repository's name; `<owner/repo>`: what `git remote get-url origin` names.
- `<home>`: a bot's home, the folder Orca made for it; `<project home>`: the project bot's; `<clone>`: `<project home>/<repo>`, the project bot's checkout.

## The bots

| Bot | Name | Does | Look (mascot, color; unverified) |
|---|---|---|---|
| Project bot | `cl-<repo>` | picks issues, starts the role bot runs, routes pull request events, merges through `merge.mjs` | A1, `#2E6B4F` |
| Builder | `cl-builder` | plans inline, builds and tests an issue, and fixes its own pull request: one plan, build or round of fixes per run | E1, `#2E5F8C` |
| Reviewer | `cl-reviewer` | one review per run | B1, `#8C5A2E` |
| Maintain | `cl-maintain` | one `cl-repo:maintain` pass per weekly run, in a private repository none while a maintenance pull request is open; its findings wait for the owner's approval | D1, `#4F5B66` |

Each repository has its own project bot; one set of `cl-<role>` bots serves every repository on the host, one per role, whatever its owner or visibility. The repositories on one role bot share its results, clones and allowed domains, and a run for one can write another's result file: keep a repository whose runs must stay apart off this host's role bots, with fresh workers for each role in its `docs/agents/bots.md`. A run's prompt names the procedure file that sets what differs by domain (software, hardware); the bot and its settings do not. Every bot name starts with `cl-`, so setup never takes over a bot it did not plan.

The user creates each bot in Orca: from a bot's chat, `ORCA bot create --offer --name <name> --purpose '<Does, as one sentence>'` puts the card there, and the user sets the look with Edit and presses Create bot; with no bot yet, the user creates it by hand with that name, purpose and look. Then, in the bot's settings in Orca (unverified: these settings and a connector limited to one repository): the project bot gets the GitHub connector for `<owner/repo>` only, each role bot no connector, the builder and reviewer bots their memory off and the maintain bot its memory on; every bot its nightly memory tidy-up off.

A bot starts from an Orca bot template only when its duty is Orca-specific and the template covers it: know-how that is not Orca-specific stays in CedarLoom skills and procedures, which also run outside Orca, and no bot is split into one bot per template. The project, builder and maintain bots start plain, each run taking its CedarLoom procedure, so their cards name no template. Two built-in templates are the exceptions, added only when the user asks: `security-check` as one bot `cl-security` for every repository, a check on top of the one `cl-workflow` runs on each change, and `pr-review` only in a repository without `docs/agents/orchestration.json`, which gets no project or role bots: elsewhere the reviewer bot reviews.

## Bot homes

Per bot:
- `<home>/SOUL.md`: the purpose line Create bot wrote, then `<skill folder>/SOUL.md`, the brief every run reads. An update compares it with the installed brief and proposes the difference.
- `<home>/.claude/settings.json`, each role bot (the `Edit` rules cover the file tools only, and a shell command writes what the bot's user can; `<other home>` repeats for each other bot, every repository's project bot included; web and MCP tools stay off; `<role>` is `builder`, `reviewer` or `maintain`):

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
  }
}
```

  Claude Code and Codex load `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` and `.mcp.json` from the folder a run starts in, and Claude Code loads `CLAUDE.md` and `.claude/` from `clones/` once a run reads files below it, so a run that wrote one would steer the next; a refused `MEMORY.md` write keeps the builder's and reviewer's memory off. Each `<...>` is absolute, so every `Edit` rule starts with `//`. Only the isolated environment the bots run in bounds their shell commands: run them only on a dedicated machine or VM you can restore, or in a dev container, with scoped tokens.
- The maintain bot also denies `"Edit"`, `"MultiEdit"` and `"NotebookEdit"`, as it reads `<maintain folder>/SKILL.md` without that skill's tool limits; the role guard refuses its `Write` outside `<home>/results/` and `<home>/MEMORY.md`, links resolved. Its memory stays on: in place of `Edit(/<home>/*.md)` it denies `Edit(/<home>/SOUL.md)`, `Edit(/<home>/CLAUDE.md)`, `Edit(/<home>/CLAUDE.local.md)` and `Edit(/<home>/AGENTS.md)`, so its file tool writes `MEMORY.md` ([bot-maintain.md](bot-maintain.md)).
- `<project home>/.claude/settings.json`, the project bot: `env` `{ "CEDARLOOM_ROLE": "project-bot" }`, `permissions.deny` `Bash(gh pr merge *)`, `Edit(/<project home>/SOUL.md)`, `Edit(/<project home>/MEMORY.md)`, `Edit(/<project home>/.claude/**)` and `Edit(/<project home>/pre-merge.json)`. The `Edit` rules cover its file tools only, and `Bash(gh pr merge *)` is a backstop (`gh api` passes it).
- The project bot's `<clone>` (`gh repo clone <owner/repo> <clone>`) and empty `<project home>/state/` and `<project home>/prompts/`; each role bot's `<home>/state/`, where the builder bot's holds the host limit lock of [bot-project.md](bot-project.md).

`<project home>/pre-merge.json`, only when the user names a command: `{ "command": ["<program>", "<args>"] }`, the program by its absolute path. It gets each merge's and each post's text on stdin and must exit 0; none by default.

Owner questions go where `<skill folder>/approvals.md` (Where it goes) says; the local queue is `<project home>/.cedarloom/questions/`, answered with `/cl-workflow:away off` there.

## Automations

On the project bot, each `--runs-in new --results-to chat --model opus --effort high`, its prompt naming one procedure file:

```text
ORCA automations create --bot cl-<repo> --name '<owner/repo> pick' --trigger '*/30 * * * *' --precheck "node <skill folder>/precheck.mjs --prompts <project home>/prompts <clone>" --prompt 'Pick sweep: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot cl-<repo> --name '<owner/repo> reconcile' --trigger daily --time <HH:MM> --prompt 'Daily reconciliation: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot cl-<repo> --name '<owner/repo> maintain' --trigger '<MM> <HH> * * <weekday>' --prompt 'Weekly maintenance with <maintain folder>: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot cl-<repo> --name '<owner/repo> catch-up' --trigger '*/15 * * * *' --precheck "node <skill folder>/precheck.mjs --catch-up <clone> --state <project home>/state" --precheck-timeout 120 --prompt 'Catch-up sweep: take <skill folder>/bot-catch-up.md.' <flags> --json
```

Event rules and role bot runs are the project bot's runs' to make, never setup's. Event rules fire only once `ORCA automations trigger-options --bot cl-<repo>` lists `github` events (Orca signed in, the Orca GitHub app on `<owner/repo>`); until then the sweeps alone find the work.

## Setup

The setup skill of cl-repo takes these steps in its own phases. It creates no bot.
- **Which bots.** None where no Orca executable is found or the user declines. With `docs/agents/orchestration.json` on the default branch or in the plan: the project bot and the three role bots. Templates, if wanted, as [The bots](#the-bots) says.
- **Read only.** `ORCA bot list` and the homes of the bots it lists, `ORCA automations list --json`, an existing `docs/agents/bots.md`, and `<skill folder>`, which must hold `merge.mjs`, `precheck.mjs` and the procedures Automations names, and `<maintain folder>/SKILL.md`: a missing one skips the bots, naming it. Orca keys a bot's home by its name, so a listed bot whose `<clone>` has another `origin` than `<owner/repo>` stops the step, naming that repository. A repository named `builder`, `reviewer`, `maintain` or `security` stops the step, as its project bot would take a role bot's name. A plugin update moves both folders: compare each automation's filled text, its `--precheck` string included, with the plan and `SOUL.md`'s paths with them, and propose each that differs and a missing `<project home>/prompts/`. A prompt file there whose role is none of `builder`, `reviewer` and `maintain` stops the step, naming it: its run's result is read, or its issue released (`cl:in-progress` off), and the file deleted, by hand first, since the precheck reads no such file. Ask the reconciliation time, the maintenance weekday and time, and a pre-merge command (none recommended). Where `ORCA bot list` shows role bots, state what [The bots](#the-bots) says they share and ask whether this repository's runs must stay apart (no recommended): a yes plans fresh workers for each role in `docs/agents/bots.md` and no role bot work for this repository.
- **Plan.** A filled path stays inside quotes in each command, in single quotes within a `--precheck` string; a path that holds a quote stops the step, naming it. `docs/agents/bots.md`, committed, with no local path; per bot its card (name, purpose, look), its home files, the clone and the automations, each with its filled text. Bot homes and automations belong to the repository's bots, not to user scope.
- **Apply.** Per bot `ORCA bot list` lacks, put its card in the bot chat the session runs in, else ask the user to create it as [The bots](#the-bots) says, and wait for Create bot, then for the user's answer that the Orca settings named there are set; a listed bot keeps its card, and only its differences are applied. Then write its home files (never its `MEMORY.md`) and the clone. Before the project bot's automations, a test run on each role bot, `ORCA automations create --bot <role bot> --name '<repo> guard test' --runs-in new --once --by <UTC now plus one minute> --prompt '<the test>' --json`, asks it to write its `MEMORY.md` with the file tool and its `CLAUDE.md` and `clones/CLAUDE.md` with a shell command, to fetch `https://example.com` with `WebFetch` and with `curl`, to write a file under `<home>/results/` with the file tool and one under `<home>/clones/` with a shell command (the maintain bot also one with the file tool), to run `gh api rate_limit` and `gh issue comment 0 -R <owner/repo> --body guard-test`, and to name every MCP tool it can call. Its result, in that bot's chat, must show the `MEMORY.md` write and the `WebFetch` fetch refused by a deny rule, not by a file mode, but the maintain bot's `MEMORY.md` write done; the two shell writes done and the `curl` fetch done or failed at the network, never refused by a setting or the role guard, as no setting bounds a shell command (a network failure is the environment's limit, not a failed guard); the next three done; the comment and the maintain bot's file tool write under `clones/` refused by the role guard as no step of `<role>-bot`, and no MCP tool; no result fails the test. The project bot's test run asks for `git -C <clone> push --dry-run origin HEAD:refs/heads/guard-test`, which the role guard must refuse. A builder or reviewer bot whose memory stays on (its `MEMORY.md` write not refused), and a maintain bot whose `MEMORY.md` write is refused, gets no runs, and its other results still count: Apply adds to `docs/agents/bots.md` that fresh workers take that role. Back up an existing `MEMORY.md`, `CLAUDE.md` and `clones/CLAUDE.md` and restore them afterward, else remove the files the run made. Whether a bot run loads its home's `.claude/settings.json`, and in which permission mode, is unverified. Passed, and `docs/agents/orchestration.json` on the default branch: create the automations, the catch-up sweep last. Otherwise create none and report them as waiting, with the reason: the next setup run plans them as differences. A failed test also proposes `ORCA automations edit <id> --disabled` for the existing ones. Apply writes `<home>/state/guard-failed` of a role bot whose test failed or that gets no runs, naming why, and removes it after a passed test: no project bot gives that bot a run while it is there.
