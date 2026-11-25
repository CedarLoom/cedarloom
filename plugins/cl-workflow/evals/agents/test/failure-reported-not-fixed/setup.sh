#!/usr/bin/env bash
# Workspace: a change that breaks an existing test elsewhere in the suite.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src test
cat > src/format.js <<'EOF'
export function formatVelocity(fps) {
  return `${fps} fps`;
}
EOF
cat > test/format.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVelocity } from '../src/format.js';

test('fps label', () => {
  assert.equal(formatVelocity(2800), '2800 fps');
});
EOF
printf '{ "type": "module" }\n' > package.json
printf '# AGENTS.md\n\nTests: `node --test` in the repository root, on the host.\n' > AGENTS.md
git add . && git commit -q -m "feat: velocity labels"
cat > src/format.js <<'EOF'
export function formatVelocity(fps) {
  return `${fps} ft/s`;
}
EOF
git commit -q -am "feat: spell out the velocity unit"
