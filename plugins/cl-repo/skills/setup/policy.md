# Coordinator policy, labels and issue template

The coordinator (`cl-orchestration:coordinate`) starts and merges nothing in a project without `cedarloom.json` at the root of its default branch. Where the file is absent, propose it as a plan item with these answers (ask, recommending the first value named), and an empty `docs/agents/worker-rules.md` (extra rules for the coordinator's workers) when that is absent too. Both are committed in a shared and in a local setup, and from then on both are the owner's to edit: never propose a change to an existing one.

- `startLabel`: the label that lets the coordinator start an issue, `cl:ready-for-agent` unless the user names another.
- `merge.allowed`: `false`, the user merges; `true` lets the coordinator merge a reviewed pull request. With `true`, `merge.requiredChecks` lists check names that run on pull requests, taken from a recent one (`gh pr checks <n> --json name --jq '.[].name'`), never a job that runs only on pushes to the default branch, and only those the user keeps.
- `closeIssue`: `true`, a worker's pull request closes its issue when merged, by anyone, and the coordinator closes one left open; `false` leaves that to the user.
- `trustedAuthors`: none, or the review bots the user names whose comments workers may follow.

Write `{"$schema": "https://cedarloom.github.io/cedarloom/schema/cedarloom.json", "schemaVersion": 3}` with these fields, two-space indented and with a final newline, and leave every other field to its default: the Policy section of `cl-orchestration:coordinate` lists each field and its default.

## Labels

`labels.mjs` below is `node <skill folder>/labels.mjs` (Claude Code: `<skill folder>` is `${CLAUDE_SKILL_DIR}`); it holds the label set and each label's meaning. `<start>` is the policy's `startLabel` (an existing file's, else the answer above when one was asked). `<owner/repo>` is the repository `git remote get-url origin` names, so a fork's clone never reaches its upstream.

- Read only: `gh label list -R <owner/repo> --limit 1000 --json name | labels.mjs missing --start <start>` prints each missing label with its meaning; each is a plan item.
- Apply: `labels.mjs create <owner/repo> --start <start> <label>...` with the approved labels. Name each command it prints as not created in the report.

## Issue template

Where the repository has no `.github/ISSUE_TEMPLATE` folder and its owner has no default issue templates (`gh api repos/<owner>/.github/contents/.github/ISSUE_TEMPLATE` answers 404), propose [issue-templates/work.md](issue-templates/work.md) as `.github/ISSUE_TEMPLATE/work.md` as a plan item, committed. It labels a new issue `cl:triage`, never `startLabel`: on a public repository anyone can file through it.

## Review and report

- Review also checks: a new `cedarloom.json` is valid JSON and holds `$schema`, `schemaVersion` 3 and only the fields above, with the values the user approved.
- Report, with a new policy file: once it is on the default branch, `node <coordinate skill folder>/policy.mjs .` prints the policy the coordinator will use.
