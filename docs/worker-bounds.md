# Worker bounds

The `cl-orchestration` dispatch guard refuses the commands that would let a coordinator, a worker or a bot step past a run's bounds by mistake: skip permission prompts, start an agent with the coordinator's role, delete a worktree with its changes, merge a head nobody reviewed, or put a pull request's files on disk. It is a `PreToolUse` hook for Bash, Monitor, PowerShell, Write, Edit and MultiEdit in every Claude Code session that loads the plugin ([hooks/claude-code.json](../plugins/cl-orchestration/hooks/claude-code.json)); Codex does not run it.

| Rule | Refuses |
|---|---|
| `bypass-flag` | `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `bypassPermissions`, Codex's `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, `danger-full-access` and the `never` approval policy, in any command but a plain reader such as `grep` |
| `launch-env` | an `orca` `--command` launch line that starts `claude` or `codex` without `env -u CEDARLOOM_ROLE` in front |
| `worktree-force` | `orca worktree rm --force`, `git worktree remove --force` |
| `direct-merge` | `gh pr merge` without `--match-head-commit` and the full 40-character head (`--disable-auto` alone passes) |
| `no-admin`, `no-auto`, `no-delete-branch` | those flags of `gh pr merge`, `-d` included |
| `update-branch-rebase` | `gh pr update-branch --rebase` |
| `clone-checkout` | `git checkout`, `switch`, `restore` and `worktree` in a scratch clone: a folder in `clones/` of a run folder or of a bot home. A clone that needs files (a trial merge, the policy pull request) lies in `checkouts/` |
| `unreadable-program` | a command whose program is a variable or command substitution (`$RUN`, `"$(which gh)" pr view`, PowerShell's `& $gh`) |
| `away-off` | an `orca` command that holds `/cl-workflow:away off` |

## How it reads a command

- It reads the command as the shell splits it, as the `cl-workflow` role guard does ([plugins.md](plugins.md#role-guard)): quotes, escapes, line continuations, `$'...'`, wrappers (`command`, `env`, `sudo`, `timeout`), subshells and the text of `bash -c` or `eval`.
- Flags count in every spelling the program accepts: `--flag=value`, a short-flag cluster (`-sd`), and git's abbreviations (`--forc`).
- Fail closed: a command it cannot read for a rule (a flag, folder or head commit in a variable or command substitution, `--git-dir`, `cd -`, a redirection into a variable) is refused under that rule. A folder change counts as maybe failed, so the folder before it still counts for the commands after it; past 64 such folders in one command the folder counts as unreadable. Every refusal names its rule and says what to write instead.
- Like the role guard, it reads every line of a here-document and an input redirection's target as it reads a command: a body that holds a refused command is refused too.
- A refused text that only mentions a flag, such as a commit message, goes in a file: `git commit -F`, `gh --body-file`.

## What it does not bound

The guard stops a session that forgets a rule, not one that works around it: a script, an alias, a program that runs `gh` or `git` as a child (`merge.mjs`, `commit-push.mjs`) and the file tools of another agent are not seen. What binds every session is the token's scope, the repository's rulesets and, for an automatic run, the isolated environment ([Automatic bounds](../plugins/cl-orchestration/skills/coordinate/modes.md#automatic-bounds)).
