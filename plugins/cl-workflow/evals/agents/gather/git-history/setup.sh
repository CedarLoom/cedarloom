#!/usr/bin/env bash
# Workspace: a repository whose run limit changed twice.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p config
printf '{\n  "maxRuns": 4\n}\n' > config/limits.json
git add . && git commit -q -m "feat: add run limits"
printf '{\n  "maxRuns": 6\n}\n' > config/limits.json
git commit -q -am "feat: raise the run limit to 6"
printf 'Run limits live in config/limits.json.\n' > README.md
git add README.md && git commit -q -m "docs: point to the run limits"
