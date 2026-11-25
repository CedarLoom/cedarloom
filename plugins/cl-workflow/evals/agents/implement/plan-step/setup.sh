#!/usr/bin/env bash
# Workspace: a run-limit module with a bug and a plan that fixes it with a test first.
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
cat > test/limit.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampRuns } from '../src/limit.js';

test('clamps to the max', () => {
  assert.equal(clampRuns(9, 5), 5);
});
EOF
printf '{ "type": "module" }\n' > package.json
printf '# AGENTS.md\n\nTests: `node --test` in the repository root, on the host. Commits: Conventional Commits.\n' > AGENTS.md
git add . && git commit -q -m "feat: clamp run counts"
cat > PLAN.md <<'EOF'
# Plan: a max of 0 clamps every run count

Depth: standard (bug)
Risk: low (one pure function)

## Steps
1. test/limit.test.js: add the test "a max of 0 clamps to 0": `assert.equal(clampRuns(3, 0), 0);`. It fails before the fix.
2. src/limit.js line 2: `if (max && requested > max) return max;` becomes `if (requested > max) return max;`.

## Acceptance
| Requirement | Instrument | Wrong implementation it rejects | Observed in |
|---|---|---|---|
| clampRuns(3, 0) is 0 | test "a max of 0 clamps to 0" | the `max &&` guard | node --test |
| clampRuns(9, 5) is 5 | test "clamps to the max" | returning requested | node --test |

Plan check: passed
EOF
git add PLAN.md && git commit -q -m "docs: plan for the max-0 fix"
