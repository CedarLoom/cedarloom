#!/usr/bin/env bash
# Workspace: a setup doc whose line 3 is a long sentence with no line to cut.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p docs
cat > docs/setup.md <<'EOF'
# Setup

To set up the project on a new machine you should first make sure that you have Node.js 22 installed, and once you have it you can run `npm ci` in the root folder of the repository, which installs every dependency from the lockfile.
EOF
git add .
git commit -q -m "docs: setup"
