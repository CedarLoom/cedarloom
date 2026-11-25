#!/usr/bin/env bash
# Workspace: the project widget with the merged worker worktree wt/12-login-timeout, which holds an untracked .env, and the
# fake Orca answers for its clean-up; the removal fails on the untracked file as Orca 1.4.254 does.
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

Widget is a small Node.js library. Tests: `node --test`.

The remote is not reachable from this workspace: `refs/remotes/origin/*` holds its last known state. Run no `git fetch`, `git pull` or `git ls-remote`.

Worktrees: remove them with Orca, as the coordinator's clean-up says. No dev containers run for this project.
AGENTS
mkdir -p project/src
printf 'export const widget = () => 1;\n' > project/src/index.js
git -C project remote add origin https://github.com/example-org/widget.git
git -C project add .
git -C project commit -q -m "chore: initial commit"
git -C project update-ref refs/remotes/origin/main HEAD

root=$(pwd -P)
wt="$root/wt/12-login-timeout"
git -C project worktree add -q -b fix/12-login-timeout "$wt"
printf 'export const timeoutMs = 30000;\n' > "$wt/src/session.js"
git -C "$wt" add src/session.js
git -C "$wt" commit -q -m "fix: login timeout"
git -C project update-ref refs/remotes/origin/fix/12-login-timeout fix/12-login-timeout
git -C "$wt" branch -q --set-upstream-to=origin/fix/12-login-timeout
mkdir -p "$wt/.claude"
printf '{\n  "permissions": { "deny": [] }\n}\n' > "$wt/.claude/settings.local.json"
printf '.claude/settings.local.json\n' >> "$(git -C "$wt" rev-parse --git-common-dir)/info/exclude"
printf 'EVAL_ONLY=1\n' > "$wt/.env"

cat > worker-12.md <<FACTS
# Worker of issue 12

- Run: \`run-7\`, supervised, one project: \`project\`.
- Worker: supervised Claude Code worker on Orca, dispatch \`d-12\`, terminal \`term-12\` (from \`terminal create\`).
- Worktree: \`$wt\`, branch \`fix/12-login-timeout\`, every commit pushed.
- Pull request: example-org/widget#31, merged by the owner. No follow-up is open.
FACTS

cat > .fake/orca.json <<JSON
[
  [["skills","get","orchestration"], "# Orca orchestration\n\nworker-read, worker-show, worker-retain, worker-release, terminal close, terminal list and worktree rm take --json. worker-release never closes a terminal it did not create.\n", 0],
  [["status","--json"], "{\"ok\":true,\"result\":{\"runtime\":{\"appVersion\":\"1.4.259\"}}}\n", 0],
  [["orchestration","worker-show","--dispatch","d-12","--json"], "{\"ok\":true,\"result\":{\"dispatchId\":\"d-12\",\"outcome\":\"succeeded\",\"terminalState\":\"retained\",\"released\":false,\"terminal\":{\"handle\":\"term-12\"}}}\n", 0],
  [["orchestration","worker-read","--dispatch","d-12","--json"], "{\"ok\":true,\"result\":{\"dispatchId\":\"d-12\",\"entries\":[{\"source\":\"dispatch\",\"text\":\"Start: issue 12 spec\"},{\"source\":\"worker\",\"text\":\"DONE: fix/12-login-timeout, head committed\"}]}}\n", 0],
  [["orchestration","worker-read","--dispatch","d-12","--source","terminal","--limit","50","--json"], "{\"ok\":true,\"result\":{\"dispatchId\":\"d-12\",\"lines\":[\"> Start: issue 12 spec\",\"DONE reported.\",\"\",\"> \",\"  auto mode on\"]}}\n", 0],
  [["terminal","close","--terminal","term-12","--json"], "{\"ok\":true,\"result\":{\"closed\":true,\"terminal\":\"term-12\"}}\n", 0],
  [["terminal","list","--worktree","path:$wt","--json"], "{\"ok\":true,\"result\":{\"terminals\":[]}}\n", 0],
  [["terminal","list","--json"], "{\"ok\":true,\"result\":{\"terminals\":[]}}\n", 0],
  [["orchestration","worker-release","--dispatch","d-12","--json"], "{\"ok\":true,\"result\":{\"dispatchId\":\"d-12\",\"status\":\"retained\"}}\n", 0],
  [["worktree","rm","--worktree","path:$wt","--run-hooks","--json"], "{\"ok\":false,\"error\":{\"message\":\"Failed to delete worktree at $wt. ?? .env\"}}\n", 1],
  [["worktree","list","--json"], "{\"ok\":true,\"result\":{\"worktrees\":[{\"path\":\"$root/project\"},{\"path\":\"$wt\"}]}}\n", 0],
  [["orchestration","worker-list","--run","run-7","--terminal-state","reclaimable","--json"], "{\"ok\":true,\"result\":{\"workers\":[]}}\n", 0],
  [["orchestration","worker-list","--run","run-7","--terminal-state","retained","--json"], "{\"ok\":true,\"result\":{\"workers\":[{\"dispatchId\":\"d-12\",\"outcome\":\"failed\",\"error\":\"Terminal closed by operator request\"}]}}\n", 0]
]
JSON

cat > .fake/gh.json <<'JSON'
[
  [["repo","view","--json","nameWithOwner,defaultBranchRef"], "{\"nameWithOwner\":\"example-org/widget\",\"defaultBranchRef\":{\"name\":\"main\"}}\n", 0],
  [["pr","view","31","-R","example-org/widget","--json","state"], "{\"state\":\"MERGED\"}\n", 0]
]
JSON
