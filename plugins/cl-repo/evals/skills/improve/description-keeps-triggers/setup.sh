#!/usr/bin/env bash
# Workspace: a project skill whose description is in the first person and holds a
# trigger sentence and a boundary sentence.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p .claude/skills/release
cat > .claude/skills/release/SKILL.md <<'EOF'
---
name: release
description: "I cut a release: I bump the version, write the changelog and tag the commit. Use when the user asks for a release. Do not use for hotfix branches; use the hotfix skill there."
---

1. Bump the version in package.json.
2. Add the changelog entry for the version.
3. Tag the commit `v<version>`.
EOF
git add .
git commit -q -m "chore: release skill"
