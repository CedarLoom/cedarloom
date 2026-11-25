#!/usr/bin/env bash
# Workspace: a base commit with two defects and a fix commit that fixes one of them.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src
cat > src/limit.js <<'EOF'
export function clampRuns(requested, max) {
  if (max && requested > max) return max;
  return requested;
}

export function parseRuns(text) {
  return Number.parseInt(text, 10);
}
EOF
git add . && git commit -q -m "feat: run limits from the command line"
cat > src/limit.js <<'EOF'
export function clampRuns(requested, max) {
  if (max && requested > max) return max;
  return requested;
}

export function parseRuns(text) {
  const runs = Number(text);
  if (!Number.isInteger(runs) || runs < 1) throw new RangeError(`runs must be a positive integer: ${text}`);
  return runs;
}
EOF
git commit -q -am "fix: reject run counts that are not positive integers"
