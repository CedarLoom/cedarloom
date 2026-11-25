#!/usr/bin/env bash
# Workspace: a project in merge.mode disjoint whose dev container runs no repository file before the check;
# the case states a trial merge that passed, so the coordinator makes a new scratch clone, comments and goes on.
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
mkdir -p project/.devcontainer project/docs/agents project/docs/changelog.d project/src
cat > project/AGENTS.md <<'MD'
# AGENTS.md

widget: a small HTTP client library for Node.js.

## Checks

Every check runs in the dev container: start it with `devcontainer up --workspace-folder .`, then run `devcontainer exec --workspace-folder . node --test`. The changed-files check is that one command.

- Pull request titles and commit subjects follow Conventional Commits.
- Each pull request adds one changelog entry under `docs/changelog.d/`.
MD
cat > project/.devcontainer/devcontainer.json <<'JSON'
{
  "name": "widget",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:22"
}
JSON
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
