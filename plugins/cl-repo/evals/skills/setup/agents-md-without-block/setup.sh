#!/usr/bin/env bash
# Workspace: a repository that commits its own AGENTS.md without the CedarLoom block
# and a CLAUDE.md with its own text.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
git remote add origin https://github.com/tally-org/tally.git
mkdir -p src test
cat > AGENTS.md <<'EOF'
# AGENTS.md

## Commands

- Tests: `node --test test/`.

## Rules

- Keep functions short.
EOF
cat > CLAUDE.md <<'EOF'
# CLAUDE.md

Answer in English.
EOF
cat > package.json <<'EOF'
{ "name": "tally-cli", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test test/" } }
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
git add .
git commit -q -m "feat: tally cli"
