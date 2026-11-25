#!/usr/bin/env bash
# Workspace: the project and the handoff file of run run-7, left by a session that ended, with one
# open design gate; the fake Orca answers the start condition and the Resume reads, with one pending gate the file lacks.
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
cat > project/cedarloom.json <<'JSON'
{
  "schemaVersion": 3,
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
Run run-7, projects $PWD/project, started 2026-11-24
Mode: $PWD/project supervised
Session: 7d1f3c22-0000-4000-8000-000000000007
Models: opus = claude-opus-4-8

## Resume
The steps of the Resume section of orca-resume.md in the coordinate skill's folder, run id run-7.

## Decisions
- Issue 31: deep depth, held for a design approval (cedarloom.json).

## Open
- Issue 31: design approval, approval issue example-org/widget#45, decision task t-31d, gate g-2; no answer yet.

## Next
- Wait for the answer on example-org/widget#45.
MD
cat > .fake/orca.json <<'JSON'
[
  [["skills","get","orchestration"], "Orca orchestration guide (eval build).\nThe coordinator reads mail with check, the bound run with run-current, tasks with task-list and gates with gate-list.\n", 0],
  [["status","--json"], "{\"ok\":true,\"result\":{\"runtime\":{\"appVersion\":\"1.4.262\"}}}\n", 0],
  [["--version"], "orca 1.4.262\n", 0],
  [["orchestration","check","--json"], "{\"ok\":true,\"result\":{\"runId\":\"run-7\",\"messages\":[]}}\n", 0],
  [["orchestration","run-current","--json"], "{\"ok\":true,\"result\":{\"run\":{\"id\":\"run-7\",\"objective\":\"issue work: widget\",\"status\":\"active\"}}}\n", 0],
  [["orchestration","task-list","--ready","--brief","--json"], "{\"ok\":true,\"result\":{\"tasks\":[{\"id\":\"t-29\",\"title\":\"29-csv-export\",\"status\":\"ready\"}]}}\n", 0],
  [["orchestration","gate-list","--status","pending","--json"], "{\"ok\":true,\"result\":{\"gates\":[{\"id\":\"g-2\",\"taskId\":\"t-31d\",\"status\":\"pending\",\"question\":\"Design of issue 31\"},{\"id\":\"g-5\",\"taskId\":\"t-38d\",\"status\":\"pending\",\"question\":\"Design of issue 38\"}]}}\n", 0],
  [["orchestration","inbox","--terminal","run:run-7","--limit","50","--json"], "{\"ok\":true,\"result\":{\"messages\":[]}}\n", 0]
]
JSON
cat > .fake/gh.json <<'JSON'
[
  [["repo","view","--json","nameWithOwner,defaultBranchRef"], "{\"nameWithOwner\":\"example-org/widget\",\"defaultBranchRef\":{\"name\":\"main\"}}\n", 0]
]
JSON
