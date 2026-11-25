#!/usr/bin/env bash
# Workspace: a plan whose step names a function signature the code does not have.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src
cat > src/limit.js <<'EOF'
export function clampRuns(requested, max) {
  if (requested > max) return max;
  return requested;
}
EOF
printf '{ "type": "module" }\n' > package.json
printf '# AGENTS.md\n\nTests: `node --test` in the repository root, on the host.\n' > AGENTS.md
cat > PLAN.md <<'EOF'
# Plan: a floor for run counts

Depth: standard (one behavior)
Risk: low (one pure function)

## Steps
1. src/limit.ts: `clampRuns(requested, max, floor)` already takes a floor; change its default from 0 to 1.

## Acceptance
| Requirement | Instrument | Wrong implementation it rejects | Observed in |
|---|---|---|---|
| clampRuns(0, 5) is 1 | test | a floor of 0 | node --test |

Plan check: passed
EOF
git add . && git commit -q -m "feat: clamp run counts"
