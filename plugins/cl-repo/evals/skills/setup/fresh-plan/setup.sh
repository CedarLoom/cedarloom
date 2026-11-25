#!/usr/bin/env bash
# Workspace: a Node.js CLI with no agent setup at all, its origin on GitHub, and the
# recorded label list of the hosted repository (two labels, one of them
# cl:ready-for-agent) and the owner's issue template lookup (404).
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
git remote add origin https://github.com/tally-org/tally.git
mkdir -p src test .recorded
cat > package.json <<'EOF'
{
  "name": "tally-cli",
  "version": "1.0.0",
  "type": "module",
  "bin": { "tally": "src/cli.js" },
  "scripts": { "test": "node --test test/" }
}
EOF
for name in cli count format table walk options language report output summary; do
  printf 'export const %s = () => 0;\n' "$name" > "src/$name.js"
done
cat > test/count.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { count } from '../src/count.js';
test('count', () => assert.equal(count(), 0));
EOF
cat > .recorded/labels.json <<'EOF'
[{ "name": "bug" }, { "name": "cl:ready-for-agent" }]
EOF
cat > .recorded/issue-templates.txt <<'EOF'
gh api repos/tally-org/.github/contents/.github/ISSUE_TEMPLATE
HTTP 404: Not Found
EOF
git add .
git commit -q -m "feat: tally cli"
