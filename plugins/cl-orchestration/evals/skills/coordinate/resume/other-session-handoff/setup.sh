#!/usr/bin/env bash
# Workspace: the project, and in the working directory a handoff file of run run-3 that
# names another session and this project, left by a coordinator session that ended.
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
mkdir -p project/docs/agents
cat > project/AGENTS.md <<'MD'
# AGENTS.md

widget is a small Node.js library. Tests: `node --test`. A worker's worktree is removed with Orca's `worktree rm`; the project starts no dev containers.
MD
cat > project/docs/agents/orchestration.json <<'JSON'
{
  "schemaVersion": 2,
  "startLabel": "cl:ready-for-agent",
  "workersPerProject": 2,
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
JSON
cat > project/index.js <<'JS'
export function greet(name) {
  return `Hello, ${name}`;
}
JS
git -C project add .
git -C project commit -q -m "chore: widget"
mkdir -p .cedarloom/runs
cat > .cedarloom/runs/handoff.md <<MD
# Handoff
Run run-3, projects $PWD/project, started 2026-11-23
Mode: $PWD/project supervised
Session: 5b0c9e1a-0000-4000-8000-000000000003
Models: opus = claude-opus-4-8

## Resume
The steps of the Resume section of orca-resume.md, run id run-3.

## Decisions
- Issue 12: standard depth, low risk, by docs/agents/orchestration.json.

## Open
- Issue 12: worker d-12 on branch fix/12-login-timeout, no report yet.

## Next
- Wait for the report of d-12.
MD
