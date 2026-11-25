#!/usr/bin/env bash
# Workspace: a Node.js project whose policy allows merges but sets merge.autoMergeMax to low,
# so a medium-class pull request head is the owner's to merge.
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
  "minPlugin": "0.1.0",
  "startLabel": "cl:ready-for-agent",
  "merge": {
    "allowed": true,
    "requiredChecks": ["ci"],
    "mode": "strict",
    "autoMergeMax": "low"
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
