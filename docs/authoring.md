# Authoring instruction text

Rules for the text the plugins load into a session. `.github/scripts/skill-lint.mjs` checks the budgets.

## Budgets

Budgets count the words of the body after the front matter, the same on every host without a tokenizer. Above the budget the lint warns, above the cap it fails.

| Text | Budget | Cap |
|---|---|---|
| `SKILL.md` | 1,200 | 3,000 |
| Skill reference file (any other `.md` in a skill folder) | 1,500 | 3,000 |
| cl-workflow entry skill: every file in `skills/workflow/` | 450 | 900 |
| Subagent prompt (`plugins/*/agents/`) | 400 | 600 |
| Rules file (`plugins/*/rules/`) | 450 | 600 |
| Bot brief (`SOUL.md`) | 600 | 800 |
| Bot procedure (`coordinate/bot-*.md`) | 450 | 900 |
| Listed description of a skill or an agent | 300 characters | 1,024 characters |

A file that was over its cap when the budgets began is listed in `AT_SIZE` in the lint at that size: it may shrink, never grow. When it shrinks, lower its entry in the same change.

## Structure

- `SKILL.md` is the overview: when the skill applies, its steps, and a link to each reference file. Reference files link from `SKILL.md` only, one level deep, so the model reads each one whole instead of following a chain.
- A file over 1,000 words opens with a contents list, so a partial read still shows what the file holds.
- One job per skill.
- Text that must survive a long session goes in the first 5,000 tokens of a skill: after compaction, Claude Code attaches each invoked skill again, cut to that length.

## Descriptions

- Third person ("Reviews a pull request ..."), never "I" or "you": the description goes into the system prompt.
- The use case first, then the details: a host's listing can cut a long description short.

## Invocation

- `disable-model-invocation: true` for a skill only the user starts: one with side effects or a moment the user picks (a setup, a release, a mode switch). Claude Code leaves it out of the model's listing; for Codex the lint requires `policy.allow_implicit_invocation: false` in the skill's OpenAI YAML.
- `user-invocable: false` for background knowledge the model loads when it applies but nobody types as a command: the skill leaves the `/` menu and stays in the model's listing.

## Current form only

CedarLoom supports only its current form: no backward compatibility, no retired skills, aliases, redirects, shims or migration notes. A renamed or removed skill, command, option or path is gone in the same change, with every reference to it.

## Writing

- No restating: each fact lives in the one file that owns it, and other files link to it. No recap of headings, code, labels or another file.
- Scripts and hooks over wording: a rule that a script, hook or check can enforce goes there, and the text names it at most.
- A change removes as much as it adds: new instruction text replaces or tightens old text, so the totals hold.

Sources: [Claude Code skills](https://code.claude.com/docs/en/skills), [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
