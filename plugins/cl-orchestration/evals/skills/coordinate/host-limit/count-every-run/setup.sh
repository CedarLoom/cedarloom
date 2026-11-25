#!/usr/bin/env bash
# Workspace: one supervised project whose policy sets hostWorkerLimit 3 and workersPerProject 3, so only the
# host limit binds; the prompt states the run, worker and terminal lists.
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
cat > project/AGENTS.md <<'EOT'
# AGENTS.md

Widget is a small Node.js web service.

Tests: `node --test`. Commits follow Conventional Commits.
EOT
cat > project/docs/agents/orchestration.json <<'EOT'
{
  "schemaVersion": 2,
  "startLabel": "cl:ready-for-agent",
  "workersPerProject": 3,
  "hostWorkerLimit": 3
}
EOT
cat > project/src/session.js <<'EOT'
export const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
EOT
git -C project add .
git -C project commit -q -m "feat: widget service"
