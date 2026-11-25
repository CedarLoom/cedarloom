#!/usr/bin/env bash
# Workspace: a repository whose CI workflow pins one Node.js version.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p .github/workflows
cat > .github/workflows/token-budget.yml <<'EOF'
name: Token budget
on: pull_request
jobs:
  token-budget:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v6
        with:
          node-version: 22.23.4
      - run: node scripts/token-budget.mjs check
EOF
cat > .github/workflows/checks.yml <<'EOF'
name: Checks
on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v6
        with:
          node-version: 24.4.0
      - run: node --test
EOF
git add .
git commit -q -m "ci: initial workflows"
