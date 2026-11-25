#!/usr/bin/env bash
# Workspace: a run-limit module with one real defect and one correct comparison.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src
cat > src/limit.js <<'EOF'
export function clampRuns(requested, max) {
  if (requested > max) return max;
  return requested;
}

export function parseRuns(text) {
  return Number.parseInt(text, 10);
}
EOF
git add . && git commit -q -m "feat: run limits from the command line"
