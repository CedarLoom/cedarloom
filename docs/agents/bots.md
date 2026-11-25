# Bots

The Orca bots that run this repository's coordinator work: [setup-bots.md](../../plugins/cl-orchestration/skills/coordinate/setup-bots.md) up to its Setup section, with the repository filled in. Each `<...>` path stays a placeholder here and is filled, as an absolute path, only in the bot homes:
- `ORCA`: the Orca executable; `<skill folder>`: the `coordinate` skill folder of the installed cl-orchestration plugin; `<maintain folder>`: the `maintain` skill folder of the installed cl-repo plugin.
- `<home>`: a bot's home, the folder Orca made for it; `<project home>`: the project bot's; `<clone>`: `<project home>/cedarloom`, the project bot's checkout.

## Roles

| Role | Runs on |
|---|---|
| Builder (plans, builds, fixes) | fresh workers |
| Reviewer | `cl-reviewer` |
| Maintain | fresh workers |

Fresh workers take the builder and maintain roles: [bot-project.md](../../plugins/cl-orchestration/skills/coordinate/bot-project.md) (Start, Fresh worker) starts an Orca worker for each plan, build, fix and maintain run, so this repository needs no `cl-builder` or `cl-maintain` bot. Reviews run on `cl-reviewer` while its home holds no `state/guard-failed`; with it, fresh workers take reviews too. With no builder bot, a role bot run passes `--lock <cl-reviewer home>/state/host-limit.lock` to `precheck.mjs`.

## The bots

| Bot | Name | Does | Look (mascot, color; unverified) |
|---|---|---|---|
| Project bot | `cl-cedarloom` | picks issues, starts the role bot runs, routes pull request events, merges through `merge.mjs` | A1, `#2E6B4F` |
| Builder | `cl-builder` | plans inline, builds and tests an issue, and fixes its own pull request: one plan, build or round of fixes per run | E1, `#2E5F8C` |
| Reviewer | `cl-reviewer` | one review per run | B1, `#8C5A2E` |
| Maintain | `cl-maintain` | one `cl-repo:maintain` pass per weekly run, in a private repository none while a maintenance pull request is open; its findings wait for the owner's approval | D1, `#4F5B66` |

Each repository has its own project bot; the role bots serve every repository on the host, one per role. One home cannot keep its runs apart: the repositories on one role bot share its results, clones and allowed domains, and a run for one can write another's result file. So repositories share the `cl-<role>` bots only with the same owner and the same visibility. A run's prompt names the procedure file that sets what differs by domain (software, hardware); the bot and its settings do not. Every bot name starts with `cl-`, so setup never takes over a bot it did not plan.

The user creates each bot in Orca: from a bot's chat, `ORCA bot create --offer --name <name> --purpose '<Does, as one sentence>'` puts the card there, and the user sets the look with Edit and presses Create bot; with no bot yet, the user creates it by hand with that name, purpose and look. Then, in the bot's settings in Orca (unverified: these settings and a connector limited to one repository): the project bot gets the GitHub connector for `CedarLoom/cedarloom` only, each role bot no connector, the builder and reviewer bots their memory off and the maintain bot its memory on; every bot its nightly memory tidy-up off.

Orca's built-in templates: `security-check` may be added as one bot `cl-security` for every repository. `pr-review` only in a repository without `docs/agents/orchestration.json`, which gets no project or role bots: elsewhere the reviewer bot reviews.

## Bot homes

Per bot:
- `<home>/SOUL.md`: the purpose line Create bot wrote, then `<skill folder>/SOUL.md`, the brief every run reads. An update compares it with the installed brief and proposes the difference.
- `<home>/.claude/settings.json`, each role bot (the sandbox covers shell commands, the `Edit` rules the file tools; `<other home>` repeats for each other bot, every repository's project bot included; web and MCP tools stay off; `<role>` is `builder`, `reviewer` or `maintain`):

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

  Claude Code and Codex load `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` and `.mcp.json` from the folder a run starts in, and Claude Code loads `CLAUDE.md` and `.claude/` from `clones/` once a run reads files below it, so a run that wrote one would steer the next; a refused `MEMORY.md` write keeps the builder's and reviewer's memory off. Each `<...>` is absolute, so every `Edit` rule starts with `//`. `allowedDomains` adds the `sandbox.allowedDomains` of each repository's policy.
- The maintain bot also denies `"Edit"`, `"MultiEdit"` and `"NotebookEdit"`, as it reads `<maintain folder>/SKILL.md` without that skill's tool limits; the role guard refuses its `Write` outside `<home>/results/` and `<home>/MEMORY.md`, links resolved. Its memory stays on: in place of `Edit(/<home>/*.md)` it denies `Edit(/<home>/SOUL.md)`, `Edit(/<home>/CLAUDE.md)`, `Edit(/<home>/CLAUDE.local.md)` and `Edit(/<home>/AGENTS.md)`, so its file tool writes `MEMORY.md` ([bot-maintain.md](../../plugins/cl-orchestration/skills/coordinate/bot-maintain.md)) and its shell still does not.
- `<project home>/.claude/settings.json`, the project bot: `env` `{ "CEDARLOOM_ROLE": "project-bot" }`, `permissions.deny` `Bash(gh pr merge *)`, `Edit(/<project home>/SOUL.md)`, `Edit(/<project home>/MEMORY.md)`, `Edit(/<project home>/.claude/**)` and `Edit(/<project home>/pre-merge.json)`. Its shell runs unsandboxed, so the `Edit` rules cover its file tools only and `Bash(gh pr merge *)` is a backstop (`gh api` passes it).
- The project bot's `<clone>` (`gh repo clone CedarLoom/cedarloom <clone>`) and empty `<project home>/state/` and `<project home>/prompts/`; each role bot's `<home>/state/`, where the builder bot's holds the host limit lock of [bot-project.md](../../plugins/cl-orchestration/skills/coordinate/bot-project.md).

`<project home>/pre-merge.json`, only when the user names a command: `{ "command": ["<program>", "<args>"] }`, the program by its absolute path. It gets each merge's and each post's text on stdin and must exit 0; none by default.

Owner questions go where `<skill folder>/approvals.md` (Where it goes) says; the local queue is `<project home>/.cedarloom/questions/`, answered with `/cl-workflow:away off` there.

## Automations

On the project bot, each `--runs-in new --results-to chat --model opus --effort high`, its prompt naming one procedure file:

```text
ORCA automations create --bot cl-cedarloom --name 'CedarLoom/cedarloom pick' --trigger '*/30 * * * *' --precheck "node <skill folder>/precheck.mjs --prompts <project home>/prompts <clone>" --prompt 'Pick sweep: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot cl-cedarloom --name 'CedarLoom/cedarloom reconcile' --trigger daily --time <HH:MM> --prompt 'Daily reconciliation: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot cl-cedarloom --name 'CedarLoom/cedarloom maintain' --trigger '<MM> <HH> * * <weekday>' --prompt 'Weekly maintenance with <maintain folder>: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot cl-cedarloom --name 'CedarLoom/cedarloom catch-up' --trigger '*/15 * * * *' --precheck "node <skill folder>/precheck.mjs --catch-up <clone> --state <project home>/state" --precheck-timeout 120 --prompt 'Catch-up sweep: take <skill folder>/bot-catch-up.md.' <flags> --json
```

Event rules and role bot runs are the project bot's runs' to make, never setup's. Event rules fire only once `ORCA automations trigger-options --bot cl-cedarloom` lists `github` events (Orca signed in, the Orca GitHub app on `CedarLoom/cedarloom`); until then the sweeps alone find the work.
