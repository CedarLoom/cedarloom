#!/usr/bin/env bash
# Workspace: a run in progress with one supervised worker on issue 12 whose branch got a
# commit 5 minutes ago, so a timer wake-up runs the wake-up checks and finds no stall.
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
now=$(date +%s)
iso() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
git -C project worktree add -q -b fix/12-login-timeout ../worktrees/12-login-timeout
wt="$PWD/worktrees/12-login-timeout"
cat > "$wt/login.js" <<'JS'
export const LOGIN_TIMEOUT_MS = 30000;
JS
git -C "$wt" add login.js
GIT_AUTHOR_DATE="$((now - 300)) +0000" GIT_COMMITTER_DATE="$((now - 300)) +0000" git -C "$wt" commit -q -m "fix: raise the login timeout"
started=$(iso $((now - 1200))); acked=$(iso $((now - 900))); last=$(iso $((now - 360)))
row="{\\\"dispatchId\\\":\\\"d-12\\\",\\\"taskId\\\":\\\"t-12\\\",\\\"title\\\":\\\"12-login-timeout\\\",\\\"agent\\\":\\\"claude\\\",\\\"terminal\\\":\\\"term-12\\\",\\\"worktree\\\":\\\"$wt\\\",\\\"state\\\":\\\"ready\\\",\\\"outcome\\\":\\\"in_progress\\\",\\\"startedAt\\\":\\\"$started\\\",\\\"acknowledgedAt\\\":\\\"$acked\\\",\\\"lastMessageAt\\\":\\\"$last\\\",\\\"projection\\\":{\\\"liveness\\\":\\\"ready\\\",\\\"attention\\\":{\\\"requiresAction\\\":false},\\\"nextAction\\\":null}}"
list="{\\\"ok\\\":true,\\\"result\\\":{\\\"runId\\\":\\\"run-7\\\",\\\"workers\\\":[$row]}}\\n"
cat > .fake/orca.json <<JSON
[
  [["skills","get","orchestration"], "Orca orchestration guide (eval build).\\nWorkers report with orchestration send; the coordinator reads state with worker-list and worker-show.\\n", 0],
  [["status","--json"], "{\\"ok\\":true,\\"result\\":{\\"runtime\\":{\\"appVersion\\":\\"1.4.262\\"}}}\\n", 0],
  [["--version"], "orca 1.4.262\\n", 0],
  [["orchestration","check","--json"], "{\\"ok\\":true,\\"result\\":{\\"runId\\":\\"run-7\\",\\"messages\\":[]}}\\n", 0],
  [["orchestration","worker-list","--run","run-7","--full","--json"], "$list", 0],
  [["orchestration","worker-list","--run","run-7","--json","--full"], "$list", 0],
  [["orchestration","worker-list","--run","run-7","--full"], "$list", 0],
  [["orchestration","worker-list","--full","--run","run-7","--json"], "$list", 0]
]
JSON
cat > .fake/gh.json <<'JSON'
[
  [["repo","view","--json","nameWithOwner,defaultBranchRef"], "{\"nameWithOwner\":\"example-org/widget\",\"defaultBranchRef\":{\"name\":\"main\"}}\n", 0],
  [["pr","list","-R","example-org/widget","--head","fix/12-login-timeout","--state","merged","--json","number,title,mergedAt"], "[]\n", 0],
  [["pr","list","-R","example-org/widget","--head","fix/12-login-timeout","--state","open","--json","number,isCrossRepository"], "[]\n", 0]
]
JSON
