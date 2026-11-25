#!/usr/bin/env bash
# Workspace: an ordering module, its caller and a plan whose acceptance table misses one requirement.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src test
cat > src/pickup.js <<'EOF'
export function orderReady(issues) {
  return [...issues].sort((a, b) => a.createdAt - b.createdAt);
}
EOF
cat > src/sweep.js <<'EOF'
import { orderReady } from './pickup.js';

export function nextIssue(issues) {
  return orderReady(issues.filter((issue) => issue.ready))[0];
}
EOF
cat > test/pickup.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderReady } from '../src/pickup.js';

test('oldest first', () => {
  assert.deepEqual(orderReady([{ id: 2, createdAt: 2 }, { id: 1, createdAt: 1 }]).map((i) => i.id), [1, 2]);
});
EOF
printf '{ "type": "module" }\n' > package.json
git add . && git commit -q -m "feat: pick ready issues oldest first"
cat > plan.md <<'EOF'
# Plan: order ready issues by priority

Task: pickup orders ready issues by the Priority field, highest first, then by age; issues without a priority come last.

Depth: standard (one behavior)
Risk: low (ordering only)

## Steps
1. src/pickup.js: sort by priority (high, medium, low), then by createdAt.
2. test/pickup.test.js: add a test for priority before age.

## Acceptance
| Requirement | Instrument | Wrong implementation it rejects | Observed in |
|---|---|---|---|
| Highest priority first | test "priority before age" | sorting by age only | node --test |
| Same priority: oldest first | test "oldest first" | sorting newest first | node --test |

## Open questions
None.

Plan check: none
EOF
