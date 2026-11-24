# Stack

CedarLoom ships as plugins for Claude Code and Codex: [workflow](../plugins/cl-workflow), [repo](../plugins/cl-repo) and [orchestration](../plugins/cl-orchestration), installed together by the [cedarloom](../plugins/cedarloom) bundle. Install steps: [README](../README.md#install).

## Components

| Component | Scope | Purpose |
|---|---|---|
| [Dev Containers](https://code.visualstudio.com/docs/devcontainers/devcontainer-cli) | tooling on host, configuration per repo | project commands run in the container, whose configuration `setup` writes |
| [Ponytail](../README.md#recommended-add-on-ponytail) | recommended add-on, separate plugin | implementation simplicity |
| [workflow](../plugins/cl-workflow/skills/workflow/SKILL.md) | global, Claude + Codex | task kind (software change, docs pass, research) and depth (quick, standard, deep), pre-push correctness review, security review for risky changes; uses installed skills that match a step |

## Contents

| Path | What | Linked as |
|---|---|---|
| [.claude-plugin/marketplace.json](../.claude-plugin/marketplace.json) | the marketplace, read by Claude Code and Codex | `$HOME/.claude/plugins/`, `$HOME/.codex/plugins/` |
| [plugins/cl-repo/rules/project.md](../plugins/cl-repo/rules/project.md) | repository rules (standard level and up) | the CedarLoom block `setup` writes |
| [plugins/cl-orchestration/rules/worker.md](../plugins/cl-orchestration/rules/worker.md) | conduct rules for the workers of a coordinator run | text in every worker spec and subagent brief of `coordinate`; no setup installs it as a rule file |
| `plugins/*/skills/<name>` | the skills, described in [Skills](skills.md) | plugin skills `cl-workflow:<name>`, `cl-repo:<name>` and `cl-orchestration:<name>` |
| [plugins/cl-workflow/agents](../plugins/cl-workflow/agents) | the phase agents the workflow starts at standard and deep (plan, implement, test, review) and per item when research runs items in parallel, each with its effort and tools; the workflow skill passes the model in the call | Claude Code plugin agents `cl-workflow:<role>`; Codex uses general subagents |
| [plugins/cl-orchestration/hooks/rotation](../plugins/cl-orchestration/hooks/rotation/register.ts) | clears an idle coordinator above a context threshold and hands its handoff file back after a clear or compaction ([plugins](plugins.md#coordinator-context-rotation)) | Claude Code plugin options `rotateAtTokens` (200000) and `rotateAtPercent` (off); the restore after a compaction as a `SessionStart` command hook (Claude Code and Codex) |
| [plugins/cl-workflow/hooks/ask](../plugins/cl-workflow/hooks/ask/ask.mjs) | refuses the question tool and plan mode while `/cl-workflow:away` or the plugin option `mode` has the session away, and sets that state ([plugins](plugins.md#terminal-questions)) | Claude Code plugin hooks, on while the plugin is enabled and hooks are not disabled |
| [plugins/cl-workflow/hooks/role-guard](../plugins/cl-workflow/hooks/role-guard/role-guard.mjs) | denies merge, release, tag and default-branch push, repository settings and security, `gh auth`, `git config` write, `git stash` and `claude --bare` commands in a session that does not run as the coordinator and in every subagent ([plugins](plugins.md#role-guard)) | Claude Code plugin hook, on while the plugin is enabled and hooks are not disabled; `CEDARLOOM_ROLE=coordinator` lifts it except for a merge with `--admin`; the bot roles add their own rules ([plugins](plugins.md#bot-roles)) |
| [plugins/cl-repo/skills/debloat/token-budget.mjs](../plugins/cl-repo/skills/debloat/token-budget.mjs) | measures tokens and checks a cut plan for `debloat` | also runs the `token-budget` CI job ([Development](development.md#workflows)) |
| `plugins/*/CHANGELOG.md` | each plugin's changelog (Releases `cedarloom-v*`), see [Releasing](releasing.md) | not linked |
