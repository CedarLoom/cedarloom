#!/usr/bin/env bash
# Workspace: a bug fix whose new test covers the bug, so it fails on the base commit.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src test
cat > src/limit.js <<'EOF'
export function clampRuns(requested, max) {
  if (max && requested > max) return max;
  return requested;
}
EOF
printf '{ "type": "module" }\n' > package.json
printf '# AGENTS.md\n\nTests: `node --test` in the repository root, on the host.\n' > AGENTS.md
git add . && git commit -q -m "feat: clamp run counts"
cat > src/limit.js <<'EOF'
export function clampRuns(requested, max) {
  if (requested > max) return max;
  return requested;
}
EOF
cat > test/limit.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampRuns } from '../src/limit.js';

test('a max of 0 clamps to 0', () => {
  assert.equal(clampRuns(3, 0), 0);
});
EOF
git add . && git commit -q -m "fix: a max of 0 clamps every run count"
