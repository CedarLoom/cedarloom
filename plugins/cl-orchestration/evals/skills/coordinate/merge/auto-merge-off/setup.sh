#!/usr/bin/env bash
# Workspace: a project whose pull request 31 had its merge command run, and the fake gh's first read
# of step 6.1 shows auto-merge turned on, so the coordinator must switch it off and merge nothing.
set -eu
for program in orca gh; do
  case "$(command -v "$program")" in
    */evals/bin/"$program") ;;
    *) echo "$program on PATH is not the evals fake: put plugins/cl-orchestration/evals/bin first on PATH (plugins/cl-orchestration/evals/README.md)" >&2; exit 1 ;;
  esac
done
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
mkdir -p .fake && touch .fake/orca-calls.jsonl .fake/gh-calls.jsonl
git init -q -b main project
git -C project remote add origin https://github.com/example-org/widget.git
mkdir -p project/docs/agents project/src
cat > project/AGENTS.md <<'MD'
# AGENTS.md

widget: a small HTTP client library for Node.js.

- Tests: `node --test`.
- Pull request titles and commit subjects follow Conventional Commits.
MD
cat > project/docs/agents/orchestration.json <<'JSON'
{
  "schemaVersion": 2,
  "startLabel": "cl:ready-for-agent",
  "merge": {
    "allowed": true,
    "requiredChecks": ["ci"],
    "mode": "strict"
  },
  "closeIssue": true
}
JSON
cat > project/src/client.js <<'JS'
export async function request(url, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url);
    } catch (error) {
      if (attempt >= retries) throw error;
    }
  }
}
JS
git -C project add .
git -C project commit -q -m "feat: http client with retries"
cat > .fake/gh.json <<'JSON'
[
  [["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "{\"defaultBranchRef\":{\"name\":\"main\"},\"nameWithOwner\":\"example-org/widget\"}\n", 0],
  [["pr", "view", "31", "-R", "example-org/widget", "--json", "state,mergeCommit,mergedAt,headRefOid,autoMergeRequest"], "{\"autoMergeRequest\":{\"enabledAt\":\"2026-11-25T09:12:05Z\",\"mergeMethod\":\"SQUASH\"},\"headRefOid\":\"4c1d9e0a7b2f3c4d5e6f708192a3b4c5d6e7f809\",\"mergeCommit\":null,\"mergedAt\":null,\"state\":\"OPEN\"}\n", 0],
  [["api", "graphql", "-f", "query=query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $n) { id isInMergeQueue } } }", "-f", "owner=example-org", "-f", "name=widget", "-F", "n=31"], "{\"data\":{\"repository\":{\"pullRequest\":{\"id\":\"PR_kwDOAAAAAAAAAB8\",\"isInMergeQueue\":false}}}}\n", 0],
  [["pr", "merge", "31", "-R", "example-org/widget", "--disable-auto"], "", 0]
]
JSON
cat > .fake/orca.json <<'JSON'
[
  [["status", "--json"], "{\"result\":{\"runtime\":{\"appVersion\":\"1.4.260\"}}}\n", 0],
  [["skills", "get", "orchestration"], "# Orca orchestration\n\nStart workers with `orca worktree create`, reach them with `orca send`, and read their state with `orca status --json`.\n", 0]
]
JSON
