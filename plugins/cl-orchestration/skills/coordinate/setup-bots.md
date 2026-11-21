# Bots

The Orca bots that run a repository's coordinator work, and the steps the setup skill of cl-repo takes for them. The repository's `docs/agents/bots.md` is this file up to its Setup section, with `<repo>` and `<owner/repo>` filled. Each other `<...>` path stays a placeholder there and is filled, as an absolute path, only in the bot homes:
- `ORCA`: the Orca executable; `<skill folder>`: the `coordinate` skill folder of the installed cl-orchestration plugin.
- `<repo>`: the repository's name; `<owner/repo>`: what `git remote get-url origin` names.
- `<home>`: a bot's home, the folder Orca made for it; `<project home>`: the project bot's; `<clone>`: `<project home>/<repo>`, the project bot's checkout.

## The bots

| Bot | Name | Does | Look (mascot, color) |
|---|---|---|---|
| Project bot | `<repo>-project` | picks issues, starts the role bot runs, routes pull request events, merges | A1, `#2E6B4F` |
| Reviewer | `<repo>-reviewer` | one review per run | B1, `#8C5A2E` |
| Fixer | `<repo>-fixer` | one round of fixes per run | F1, `#6B3A8C` |
| Worker | `<repo>-worker` | one issue per run | E1, `#2E5F8C` |
| Chat bot (optional) | the user's | relays owner questions to a chat, only for the `chat` channel | D1, `#3A5A8C` |

The user creates each bot in Orca: from a bot's chat, `ORCA bot create --offer --name <name> --purpose '<Does, as one sentence>'` puts the card there; the user sets the look under Edit and presses Create bot. Then, in the bot's settings in Orca: the project bot gets the GitHub connector for `<owner/repo>` only; each role bot gets no connector and its nightly memory tidy-up turned off.

Orca's built-in templates: `security-check` may be added as an extra bot. `pr-review` only in a repository without `docs/agents/orchestration.json`, which gets no project or role bots: elsewhere the reviewer bot reviews, and a built-in review bot never counts as a review.

## Bot homes

Per bot:
- `<home>/SOUL.md`: the purpose line Create bot wrote, then `<skill folder>/SOUL.md`, the brief every run reads. An update compares it with the installed brief and proposes the difference.
- `<home>/.claude/settings.json`, each role bot (the sandbox covers shell commands, the `Edit` rules the file tools; both deny the same paths, and `<other home>` repeats for the project bot and the two other role bots):

```json
{
  "permissions": {
    "deny": [
      "Bash(gh pr merge *)",
      "Edit(/<home>/SOUL.md)", "Edit(/<home>/MEMORY.md)", "Edit(/<home>/state/**)", "Edit(/<home>/.claude/**)",
      "Edit(/<other home>/**)"
    ]
  },
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "filesystem": { "denyWrite": ["<home>/SOUL.md", "<home>/MEMORY.md", "<home>/state", "<home>/.claude", "<other home>"] },
    "network": { "allowedDomains": ["github.com", "api.github.com", "*.githubusercontent.com"] }
  }
}
```

  A refused `MEMORY.md` write is what keeps a role bot's memory off. Each `<...>` is absolute, so every `Edit` rule starts with `//`. `allowedDomains` adds the policy's `sandbox.allowedDomains`.
- `<project home>/.claude/settings.json`, the project bot: `permissions.deny` `Bash(gh pr merge *)`, `Edit(/<project home>/SOUL.md)`, `Edit(/<project home>/.claude/**)`, `Edit(/<project home>/pre-merge.json)` and `Edit(/<project home>/questions.json)`. Its shell runs unsandboxed, so these cover its file tools only.

The deny rules are a backstop: every bot may act under one GitHub login, so the Roles of `SOUL.md` hold by its procedures, not by a permission.
- The project bot's `<clone>` (`gh repo clone <owner/repo> <clone>`) and an empty `<project home>/state/`.

Merges go only through `node <skill folder>/merge.mjs`, which only the project bot runs, never `gh pr merge`, `--admin` or `--auto`. `<project home>/pre-merge.json`, only when the user names a command: `{ "command": ["<program>", "<args>"] }`, the program by its absolute path. It gets each merge's and each post's text on stdin and must exit 0; none by default.

## Owner questions

`<project home>/questions.json`, the channel the user picks: `{ "channel": "issues" }` (recommended), `"local"` or `"chat"`. The record is a GitHub issue or a local question file either way:
- `issues`: an issue labeled `cl:needs-human` in `<owner/repo>`, public-safe text only; a question that is not public-safe goes to a local question file.
- `local`: `<project home>/.cedarloom/questions/*.md`, answered with `/cl-workflow:questions` in `<project home>`.
- `chat`: the issue or file as above, its link mailed to the chat bot (`{ "channel": "chat", "bot": "<name>" }`), which posts it and records the answer on it.

## Automations

On the project bot, each `--runs-in new --results-to chat --model opus --effort high`, its prompt naming one procedure file:

```text
ORCA automations create --bot <repo>-project --name '<owner/repo> pick' --trigger '*/30 * * * *' --precheck "node <skill folder>/precheck.mjs <clone>" --prompt 'Pick sweep: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot <repo>-project --name '<owner/repo> reconcile' --trigger daily --time <HH:MM> --prompt 'Daily reconciliation: take <skill folder>/bot-project.md.' <flags> --json
ORCA automations create --bot <repo>-project --name '<owner/repo> catch-up' --trigger '*/15 * * * *' --precheck "node <skill folder>/precheck.mjs --catch-up <clone> --state <project home>/state" --precheck-timeout 120 --prompt 'Catch-up sweep: take <skill folder>/bot-catch-up.md.' <flags> --json
```

The catch-up sweep only once `<skill folder>` holds `SOUL.md`, `bot-project.md`, `bot-catch-up.md`, `bot-reviewer.md`, `bot-fixer.md` and `bot-worker.md`: without them its precheck starts a run at every sweep. The event rules per pull request and each role bot run's one-time automation are made by the project bot's runs (`bot-project.md`), never by setup. They fire only once `ORCA automations trigger-options --bot <repo>-project` lists `github` events (Orca signed in, the Orca GitHub app on `<owner/repo>`); until then the sweeps alone find the work.

## Setup

The setup skill of cl-repo takes these steps in its own phases. It creates no bot.
- **Which bots.** None where no Orca executable is found or the user declines. With `docs/agents/orchestration.json` on the default branch or in the plan: the project bot and the three role bots, and `security-check` if wanted. Without it: only the `pr-review` and `security-check` templates, if wanted.
- **Read only.** `ORCA bot list` and the homes of the bots it lists, `ORCA automations list --json`, an existing `docs/agents/bots.md`, and `<skill folder>`, which must hold `merge.mjs`, `precheck.mjs` and the procedures Automations names: a missing one skips the bots, naming it. A plugin update moves `<skill folder>`: compare each automation's and `SOUL.md`'s paths with it, and propose the changed ones. Ask the owner-question channel (`issues` recommended), the reconciliation time and a pre-merge command (none recommended).
- **Plan.** A filled path stays inside quotes in each command, in single quotes within a `--precheck` string; a path that holds a quote stops the step, naming it. `docs/agents/bots.md`, committed, with no local path; per bot its card (name, purpose, look), its home files, the clone and the automations, each with its filled text. Bot homes and automations belong to the repository's bots, not to user scope.
- **Apply.** Per bot `ORCA bot list` lacks, put its card in the bot chat the session runs in, else give the user the command, and wait for Create bot; a listed bot keeps its card, and only its differences are applied. Then write its home files (never its `MEMORY.md`) and the clone. Before any automation, a one-time run on each role bot asks it to write its `MEMORY.md` with the file tool and with a shell command, and to run `gh api rate_limit`. Its result must show both writes refused by a deny rule or the sandbox, not by a file mode, and the `gh` call answered: no result, or a write that went through, fails the test. Copy an existing `MEMORY.md` before the run; after a failed one, put it back, or remove the one the run made. Whether a bot run loads its home's `.claude/settings.json` is unverified. Passed, and `docs/agents/orchestration.json` on the default branch: create the automations, the catch-up sweep last. Otherwise create none and report them as waiting, with the reason: the next setup run plans them as differences.
