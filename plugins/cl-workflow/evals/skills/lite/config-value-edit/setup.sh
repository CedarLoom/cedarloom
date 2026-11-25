#!/usr/bin/env bash
# Workspace: a git repository whose token budget total is one JSON value.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p .github
cat > .github/token-budget.json <<'EOF'
{
  "budget": {
    "total": 120000,
    "alwaysLoaded": 1200
  }
}
EOF
cat > AGENTS.md <<'EOF'
# AGENTS.md

## Commands

Check the JSON files with `node -e "JSON.parse(require('fs').readFileSync('.github/token-budget.json','utf8'))"`.

Commit subjects follow Conventional Commits.
EOF
git add .
git commit -q -m "chore: initial commit"
