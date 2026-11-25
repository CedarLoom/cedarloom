#!/usr/bin/env bash
# Workspace: a Node.js project in merge.mode disjoint, whose pull request passed a trial merge;
# the default branch moved after the trial, so step 5.4 of Merge sends it back to step 1.
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
mkdir -p project/docs/agents project/docs/changelog.d project/src
cat > project/AGENTS.md <<'MD'
# AGENTS.md

widget: a small HTTP client library for Node.js.

- Tests: `node --test`.
- Pull request titles and commit subjects follow Conventional Commits.
- Each pull request adds one changelog entry under `docs/changelog.d/`.
MD
cat > project/docs/agents/orchestration.json <<'JSON'
{
  "schemaVersion": 2,
  "startLabel": "cl:ready-for-agent",
  "merge": {
    "allowed": true,
    "requiredChecks": ["ci"],
    "mode": "disjoint",
    "additivePaths": ["docs/changelog.d/"]
  },
  "closeIssue": true
}
JSON
cat > project/docs/changelog.d/README.md <<'MD'
One file per pull request: `<issue number>.md`, one line.
MD
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
