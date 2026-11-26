# Bot brief: names, roles and owner-only decisions

## Names

- The one exception to the command rule: a pull request's file path inside single quotes, in a scratch clone ([scratch-clone.md](scratch-clone.md)).
- `<owner/repo>` and `<default branch>` are what `gh repo view --json nameWithOwner,defaultBranchRef` prints in the bot's checkout, used only when both are plain (letters, digits, `.`, `_`, `/`, `-`; no `-` at the start, no `..`) and `nameWithOwner` is the repository of `origin`. Otherwise nothing starts there: report it.
- Every other `gh` command names its repository with `-R` or in the API path.
- A branch is `<type>/<number>-<slug>`, type and slug in lower-case letters, digits and hyphens. A branch name goes into a command only when it is plain as `merge-checks.mjs` requires.
- Numbers and commit ids come from `gh` and `git` output; names from the state file or the spec the project bot wrote.
- Per pull request: the state file `pr-<n>.json`, the event automations `<owner/repo>#<n> <event>`, the clones `<bot home>/clones/<repo>-<n>-<counter>`.

## Roles

All bots and workers may act under one GitHub login, so each line holds by these steps, not by a permission: the daily reconciliation finds a breach after the fact.

| Action | Who | Never |
|---|---|---|
| Choose the work (`startLabel`), merge a pull request with an owner-only file, releases and tags, settings, rulesets, secrets, tokens, spend limits | the owner | any bot |
| Merge any other pull request | the project bot, through `merge.mjs` only | role bots, workers |
| Start a worker or role bot run, route a pull request event | the project bot | role bots |
| Plan a deep or open issue | a builder bot run that only plans | the project bot |
| Implement an issue | a builder bot run | the project bot, reviewers |
| Review a head | a new reviewer bot run per first review and round | a run reviewing its own change; a built-in review bot counting as one |
| Post the review of record | the project bot, with the verdict its reviewer run returned | role bots |
| Fix findings, a red head or a conflict | a new builder bot run per round | reviewers |
| Reply on and resolve review threads | the project bot: replies with the fix commit a builder reports, resolves a review bot's thread at the merge once the review of record found it fixed | role bots, which post nothing on GitHub but their push; an Orca worker replies as `rules/worker.md` says |
| Maintenance pass | a maintain bot run, skipped in a private repository while a maintenance pull request is open; its findings wait for the owner's approval | a change before it |
| Close an issue, file follow-up issues in a private repository, answer a worker's question from written sources | the project bot | role bots |
| The state folder, clones and the shared git directory | the project bot; the merge lock `merge.mjs` alone | role bots |
| Model and effort | the model map ([Policy](SKILL.md#policy)) is the ceiling; the project bot names them per run | a run above them |

## Owner-only decisions

Unless a procedure step, the policy, `AGENTS.md` as the default branch has it, or the owner's answer that `approval.mjs answer` reads settles them, these stay the owner's with no default from anyone: money or spend; legal; anything public or visible to others; deletes and other hard-to-undo actions; repository settings; secrets and access; accepting a security risk; a review-loop escalation; the gates of the brief's Rules; any choice not clearly safe and reversible. Fail closed: a choice that may be one is one.

- File each one once, as [approvals.md](approvals.md) says, and record it in the pull request's state (`held` for a pull request). It blocks only its own item: the other items go on.
- Only the owner's answer releases it, never a timeout, a bot's word or issue text: every session may write under the owner's login.
- In automatic mode these are the only gates on a worker's question: any other choice takes the recommended default, named in the report.
