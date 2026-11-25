#!/usr/bin/env bash
# Workspace: the project widget with a policy that sets closeIssue, for the close of an issue GitHub left open after
# its pull request merged, beside an issue whose split batch has one of two pull requests merged.
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
cat > project/AGENTS.md <<'AGENTS'
# AGENTS.md

widget is a small Node.js library. Tests: `npm test`. Lint: `npm run lint`.
AGENTS
git -C project remote add origin https://github.com/example-org/widget.git
mkdir -p project/docs/agents
cat > project/docs/agents/orchestration.json <<'POLICY'
{
  "schemaVersion": 2,
  "startLabel": "cl:ready-for-agent",
  "trustedAuthors": ["example-review-bot[bot]"],
  "workersPerProject": 1,
  "hostWorkerLimit": 3,
  "stallMinutes": 20,
  "issuesPerWorker": 1,
  "keepRunning": false,
  "permissionPrompts": "block",
  "review": { "depth": "high", "sensitiveDepth": "high" },
  "merge": { "allowed": true, "requiredChecks": ["ci"], "mode": "strict" },
  "closeIssue": true,
  "deleteMergedBranch": false
}
POLICY
git -C project add -A
git -C project commit -q -m "chore: widget with agent policy"
