#!/usr/bin/env bash
# Workspace: a docs-only repository area with a test rule in AGENTS.md.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p docs
cat > AGENTS.md <<'EOF'
# AGENTS.md

## Tests

- Do not add tests by default. Add one only when it fails if your change is reverted.
- Never test copy or translations.

## Commands

Docs build: `node scripts/build-docs.mjs`.
EOF
cat > docs/install.md <<'EOF'
# Install

Run the installer, then open Settings and pick the units.
EOF
git add . && git commit -q -m "docs: install guide"
