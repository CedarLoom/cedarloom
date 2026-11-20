# Fixer bot run

The procedure of one fixer bot run: one round's findings, a red head or a conflict of one pull request. [SOUL.md](SOUL.md) holds first. The prompt holds the follow-up: `<owner/repo>`, `<n>`, `<branch>`, `<default branch>`, `<head>`, the issue's Thread block and acceptance criteria, then the findings in the project bot's words (severity, file, line, thread id), the red checks or the conflict, and the threads file. Then the result file.

1. **Clone.** `gh repo clone <owner/repo> <bot home>/clones/<repo>-<n>-<counter> --no-upstream` into a new folder of this bot's home, the next free counter; `git -C <clone> rev-parse --git-dir` prints `.git`. Then `git -C <clone> switch <branch>`. `git -C <clone> rev-parse HEAD` must print `<head>`: another head means the branch moved, so report that and end.
2. **Check each finding** on the branch. Fix the confirmed ones; for one that does not hold, keep the evidence (file and line, a command and its output). A red check: read its log (`gh run view <run id> -R <owner/repo> --log-failed`) and fix the cause, never the check. A conflict: `git -C <clone> merge refs/remotes/origin/<default branch>` after a fetch, resolved the way the repository's conventions say. Stay within the issue's scope; a finding that needs more goes in the report.
3. **Gates.** Run the checks `AGENTS.md` names for the changed area; a failing one is fixed or reported, never skipped.
4. **Commit and push.** One fix commit, its message from a file, `git -C <clone> push origin <branch>`, never with force; a rejected push is reported, not retried with force. A permission dialog or a refused command: answer nothing, report it, end.
5. **Report** in the result file, with the file tool: DONE or BLOCKED, the fix commit, per finding and per thread of the threads file the fix commit or the evidence, the gate commands and their results, and what was not checked. A question goes in the report as BLOCKED, with your recommendation: this run is never resumed, and the next round starts a new one.
6. Delete the clone, a command of its own with the folder's literal absolute path, and end.

This run posts nothing on GitHub but its push: the project bot replies on the threads and starts the re-review.
