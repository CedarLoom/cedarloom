#!/usr/bin/env bash
# Hand-run check of the CedarLoom rules block (plugins/cl-repo/rules/project.md), which
# has no skill to trigger: an eval run loads no project AGENTS.md. Each run builds the
# fixture in a new temporary folder, gives one headless Claude Code session the task
# there and checks the result with check.sh. Prints the pass count per check.
# Usage: bash run.sh [runs] [model]   (defaults: 3 runs, model opus)
# Each run is a full session on the signed-in account with your user settings and
# plugins; run it by hand, never in CI. The workspaces stay in the printed folder.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
runs=${1:-3} model=${2:-opus}
out=$(mktemp -d)
task='In src/report.js, format the duration with formatSpan from src/span.js instead of formatDuration. Then add one sentence to README.md that says how durations print. Do not commit.'
echo "workspaces and answers: $out"
passed=0
for n in $(seq 1 "$runs"); do
  ws="$out/run-$n"
  mkdir "$ws"
  (cd "$ws" && bash "$here/fixture.sh" "$here/../../rules/project.md") || exit 1
  (cd "$ws" && claude -p "$task" --model "$model" --permission-mode acceptEdits --allowedTools 'Bash(node --test:*)' --no-session-persistence --max-turns 40 </dev/null >"$out/answer-$n.txt")
  echo "run $n"
  bash "$here/check.sh" "$ws" "$out/answer-$n.txt" | tee "$out/check-$n.txt" && passed=$((passed + 1))
done
echo "runs per check and result:"
cat "$out"/check-*.txt | sort | uniq -c
echo "$passed/$runs runs passed every check"
[[ "$passed" = "$runs" ]]
