#!/usr/bin/env bash
# Workspace: two CI workflows that pin different Node.js versions and an AGENTS.md that names a third.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p .github/workflows notes
printf '# AGENTS.md\n\nThe plugins run on Node.js 22.\n' > AGENTS.md
printf 'jobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v6\n        with:\n          node-version: 22.23.4\n' > .github/workflows/token-budget.yml
printf 'jobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v6\n        with:\n          node-version: 24.4.0\n' > .github/workflows/checks.yml
printf '# Research notes\n' > notes/research.md
git add . && git commit -q -m "ci: initial workflows"
