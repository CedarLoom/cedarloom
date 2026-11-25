#!/usr/bin/env bash
# Workspace: a parser that a review finding asks to validate.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src test
cat > src/limit.js <<'EOF'
export function parseRuns(text) {
  return Number.parseInt(text, 10);
}
EOF
cat > test/limit.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRuns } from '../src/limit.js';

test('parses a count', () => {
  assert.equal(parseRuns('3'), 3);
});
EOF
printf '{ "type": "module" }\n' > package.json
printf '# AGENTS.md\n\nTests: `node --test` in the repository root, on the host. Commits: Conventional Commits.\n' > AGENTS.md
git add . && git commit -q -m "feat: parse run counts"
