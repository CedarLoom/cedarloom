# Worker bot run

The procedure of one worker bot run: one issue, from the spec in the prompt ([spec-template.md](spec-template.md)), whose Depth, Risk, owned paths, Thread block and handoff block hold. [SOUL.md](SOUL.md) holds first. After the spec, the prompt holds the command the report goes back with.

1. **Clone.** `gh repo clone <owner/repo> <bot home>/clones/<repo>-<n>-<counter> --no-upstream` into a new folder of this bot's home, the next free counter; `git -C <clone> rev-parse --git-dir` prints `.git`. Then `git -C <clone> switch -c <branch> refs/remotes/origin/<default branch>`, the branch of the spec. Work only in that clone.
2. **Build** the issue as the spec says, with the workflow skill at the spec's depth: only the owned paths, the gates of `AGENTS.md`, a test only where its test rule asks for one.
3. **Questions.** Answer what the spec, the code or the repository's docs settle, and name the source. Any other choice that is safe and reversible takes the recommended default, named in the report. An owner-only choice ([SOUL.md](SOUL.md#owner-only-decisions)) ends the run as BLOCKED with the question and your recommendation: this run is never resumed.
4. **Commit and push** on `<branch>`, the message from a file, `git -C <clone> push origin <branch>`, never with force. No pull request: the project bot opens the draft. A permission dialog or a refused command: answer nothing, report it, end.
5. **Report** with the prompt's command, as the spec's handoff block asks: the outcome, the branch and its head commit, a pull request title and body, the gate commands and their results, the defaults taken, and what was not checked.
6. Delete the clone, a command of its own with the folder's literal absolute path, and end.

Before it opens the draft, the project bot reads the files of the pushed commits (`gh api repos/<owner/repo>/compare/<default branch>...<head>`) against the owned paths: a path outside them or under `.github/` makes the item BLOCKED for the owner, as step 2 of [Commit and push](modes.md#commit-and-push) says.
