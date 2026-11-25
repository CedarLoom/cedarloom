#!/usr/bin/env bash
# Workspace: a deploy guide with a restated heading (line 5), a history section
# (lines 11-13) and a recap (lines 15-17) around the deploy step (line 7) and a
# Never rule (line 9).
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p docs
cat > docs/guide.md <<'EOF'
# Deploy guide

## Deploy

This section is about deploying.

Run `./deploy.sh staging`, then `./deploy.sh production` once the staging checks pass.

Never run `./deploy.sh production` from a branch other than main.

## History

We deployed with Capistrano until 2024, then moved to the shell script.

## Summary

In short: deploy to staging first, then to production.
EOF
cat > README.md <<'EOF'
# Shop

The shop's storefront. Deploying: [docs/guide.md](docs/guide.md).
EOF
git add .
git commit -q -m "docs: deploy guide"
