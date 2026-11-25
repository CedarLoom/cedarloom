# Scratch clone

Where and how the coordinator clones a worker's pull request, and the limits on every read there. The names are those of [review.md](review.md#names).

The project's checkout shares its git directory with the workers: a branch, a ref, a grafts file or a setting that a worker writes there makes git show other commits than the remote holds. So no git command of [review.md](review.md), [merge.md](merge.md) or [trial-merge.md](trial-merge.md) runs there. Once `<head>` is read, before any other step, clone the pull request's repository, without a checkout, into a new folder under `clones/` of the run folder ([SKILL.md](SKILL.md#run-files)). `<scratch path>` is that folder's absolute path:

```text
gh repo clone <owner/repo> <scratch path> --no-upstream -- --filter=blob:none --no-checkout
git -C <scratch path> rev-parse --git-dir
git -C <scratch path> fetch origin
```

- The clone must exit 0 and `rev-parse --git-dir` must print `.git`, for a trial clone too. Run that check again in a fresh context before the first command in a clone it finds, and whenever a clone may be deleted in part. A folder without a repository of its own makes `git -C` answer from the repository above it, your working directory's: its file list and its `AGENTS.md`, with exit 0. Then stop: nothing of those files runs for that pull request, and the report names it. The verdict's script makes the same test and gives no verdict either for a scratch path that is the project's repository or that has a second worktree.
- Clone once per pull request, and once more after a trial merge ([Merge](merge.md#merge), step 3; [trial-merge.md](trial-merge.md)), into a folder you name: the project's name, `<n>` and a counter. A fresh context finds the clones there by the run id of the handoff file. After each later read of `<head>`, run the `fetch` again: the clone then holds that head and the default branch as the remote has them.
- **Where.** The run folder lies in your working directory, which no worker's sandbox can write. Never clone into the system's temporary folder: Claude Code lets every sandboxed command write the per-user temporary folder ([sandboxing](https://code.claude.com/docs/en/sandboxing#temporary-directories)), so a worker could put a replace ref, a hook or a setting into a clone there. Clone nothing, and tell the owner, when your working directory lies in a folder that sandboxed commands may write: `/tmp` (any system), `/private/tmp` and `/var/folders` (macOS), the folders `$TMPDIR` and `CLAUDE_CODE_TMPDIR` name, or a folder in the `sandbox.filesystem.allowWrite` setting. On Linux, Claude Code's per-user temporary folder lies in `/tmp` whenever `TMPDIR` and `CLAUDE_CODE_TMPDIR` are unset ([environment variables](https://code.claude.com/docs/en/env-vars)).
- **No file of the pull request is on disk**, so no `CLAUDE.md`, `AGENTS.md` or `.claude` of the pull request, a worker's text, exists there for Claude Code to load as instructions ([memory](https://code.claude.com/docs/en/memory#how-claude-md-files-load)):
  - `--no-checkout` leaves the clone without working files, and no step checks one out: run no `checkout`, `switch`, `restore` or `worktree` command there.
  - Every read goes through git: `git -C <scratch path> diff <range>`, `git -C <scratch path> show '<commit>:<path>'`, `git -C <scratch path> grep -n <pattern> <commit>`.
  - A path of the pull request is a worker's text: it goes into a command line only inside single quotes.
  - A path in the verdict's `unsafePaths` (it holds a single quote, a control character or a line break) is never typed into a command: its file is read only through `git -C <scratch path> diff <range>`, and the pull request is the owner's ([Owner-only](merge.md#owner-only)).
- **No session starts there.** Never start a session, a reviewer or another subagent whose working directory is a clone, and add no clone to a session as an additional directory.
- `--no-upstream`, because `gh` gives the clone of a fork its parent as the remote `upstream` and as the repository that `gh` commands there use (`gh repo clone --help`).
- A `fetch` that does not exit 0 stops the step it belongs to: the clone's refs are then old.
- Write the default branch as `refs/remotes/origin/<default branch>` in every command, never as `origin/<default branch>`: a tag of that name on the remote answers the short name first.
- Besides your own `<scratch path>`, these commands take `<owner/repo>` and `<default branch>` by the names rule ([SKILL.md](SKILL.md#names)) and commit ids that `gh` or git printed. The one other text is a path of the pull request, inside single quotes as above.
- Nothing of the pull request runs in a scratch clone. Its code runs in one place, the check of a trial merge, which gets a clone of its own ([Merge](merge.md#merge), step 3; [trial-merge.md](trial-merge.md)).
- Delete a pull request's clones once it is merged or left for the owner, so that a `keepRunning` run piles up none: each with a command of its own that names the folder's literal absolute path, no variable and no wildcard. The rest goes with the run folder ([SKILL.md](SKILL.md#run-files)).
