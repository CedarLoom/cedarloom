# Commit and push

How the coordinator commits, checks and pushes a worker's change and opens its draft pull request: `commit-push.mjs`, its steps 1 to 5, and what applies to a supervised Claude Code worker on Orca.

The worker can write the shared `.git` (refs, replace objects, grafts, hooks, config) and its worktree's folder there, so run no git command of your own in its worktree `<W>`: `node <skill folder>/commit-push.mjs` runs each one. It first checks the folder that `<W>/.git` names and the git config, then runs git without hooks, monitor or `ext::` remote and takes commits from origin, never from local refs; the project's hooks do not run here, and its CI checks the change. The commit is signed where the owner's git configuration signs.

Exit 0 prints a JSON line. Exit 1 prints one line, `<step>: <reason>`, and nothing was pushed, except after a line `pull request after the push of <sha>`. Such a line makes the item BLOCKED, with it in the report. A path under `.github/` is the owner's (workflows, the actions and scripts they call run in CI with the repository's secrets before review): BLOCKED with the question. A line that names `cannot lock ref` (a batch's worker goes on in the same worktree) runs again at the next wake-up, and a second failure makes the item BLOCKED. Origin refusing a push as no fast-forward is BLOCKED, never a forced push.

The worker stages its change and reports the branch, the staged files and a commit message. Write the message to a file in the run folder with the file tool, and on the first round the body to another: the commit message and, where the policy's `closeIssue` is true and the pull request is not one of an approved pull request list, a line `Closes #<number>` for its issue ([Ready](merge.md#ready)). `gh` runs in the folder of that file and reads its git config, so the script refuses one under `<W>`.

```text
node <skill folder>/commit-push.mjs commit --project <project path> --worktree <W> --repo <owner/repo> --branch <branch> --default-branch <default branch> --message <file> --file <path> --owned <path> [--merged <sha>] [--title "<your own words>" --body <file>]
```

One `--file` per reported file and one `--owned` per owned path. `--title` and `--body` on the first round only. It prints `{ commit, pullRequest }`.

1. `HEAD` of `<W>` is a commit of origin's `<branch>` (while origin has none, of `<default branch>`); in a merge round, `MERGE_HEAD` is `--merged`, a commit of origin's default branch.
2. The staged files are the reported ones, every one under an owned path and none under `.github/`; no `CHERRY_PICK_HEAD`, whose author `git commit` would take.
3. The commit: its parents are step 1's commit (and in a merge round the merged sha), and it changes exactly step 2's files. Then the push of that sha to `refs/heads/<branch>`, and on the first round `gh pr create --draft`. A new title or body the worker answers with is yours to set through `gh pr edit <n> -R <owner/repo> --title "<your own words>" --body-file <file>`, a new body with the same `Closes` line.
4. Before a follow-up: `commit-push.mjs sync --project <project path> --worktree <W> --branch <branch>` fast-forwards `<W>` to origin's branch (`gh pr update-branch` moves it there).
5. A conflict with the default branch: `sync` with `--branch <default branch> --merge` merges it without a commit and prints `{ merged, conflicts }`; `merged` null means it is already in. The worker resolves and stages in the follow-up, and step 3's commit, with `--merged <merged>`, is the merge.

A supervised Claude Code worker on Orca commits on its branch, fetches and merges itself, and reports its branch, its head commit, a proposed pull request title and a body ([spec-variants.md](spec-variants.md#supervised-claude-code-worker-on-orca)). It runs under the host login without the automatic bounds: these checks catch a mistake, not a worker that works against them. Write its body to a file in the run folder with the file tool, never on the command line, and give the title in your own words, which may follow the worker's.

```text
node <skill folder>/commit-push.mjs supervised --project <project path> --worktree <W> --repo <owner/repo> --branch <branch> --default-branch <default branch> --commit <head commit> --owned <path> [--title "<your own words>" --body <file>]
```

It checks that `refs/heads/<branch>` is the reported commit and that every file the push publishes against origin's default branch, in any of its commits or a merge's resolution, is owned and outside `.github/`, then pushes that commit and opens the draft as step 3 does. A follow-up's new head goes the same way, a new title or body through `gh pr edit`.
