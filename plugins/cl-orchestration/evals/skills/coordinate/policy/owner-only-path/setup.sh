#!/usr/bin/env bash
# Workspace: example-org/widget whose policy allows merging and adds `infra` to the owner-only paths, so the case checks
# that a low-risk pull request touching a file below it is left for the owner with an owner-only approval.
set -eu
for program in orca gh; do
  case "$(command -v "$program")" in
    */evals/bin/"$program") ;;
    *) echo "$program on PATH is not the evals fake: put plugins/cl-orchestration/evals/bin first on PATH (plugins/cl-orchestration/evals/README.md)" >&2; exit 1 ;;
  esac
done
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
mkdir -p .fake && touch .fake/orca-calls.jsonl .fake/gh-calls.jsonl

git init -q -b main project
git -C project remote add origin https://github.com/example-org/widget.git
mkdir -p project/docs/agents project/src project/test project/infra
cat > project/AGENTS.md <<'EOF'
# AGENTS.md

widget: a small Node.js web library. Tests: `node --test`.
EOF
cat > project/docs/agents/orchestration.json <<'EOF'
{
  "schemaVersion": 2,
  "startLabel": "cl:ready-for-agent",
  "merge": {
    "allowed": true,
    "requiredChecks": ["ci"],
    "ownerOnlyPaths": ["infra"]
  },
  "closeIssue": true
}
EOF
cat > project/src/login.js <<'EOF'
export const loginTimeoutMs = 30_000;
EOF
cat > project/test/login.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginTimeoutMs } from '../src/login.js';

test('login timeout', () => assert.equal(loginTimeoutMs, 30_000));
EOF
cat > project/infra/alerts.yml <<'EOF'
login_timeout_ms: 30000
EOF
git -C project add .
git -C project commit -q -m "chore: widget with coordinator policy"

cat > .fake/gh.json <<'EOF'
[
  [["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "{\"nameWithOwner\":\"example-org/widget\",\"defaultBranchRef\":{\"name\":\"main\"}}\n", 0],
  [["pr", "view", "31", "-R", "example-org/widget", "--json", "files"], "{\"files\":[{\"path\":\"src/login.js\"},{\"path\":\"test/login.test.js\"},{\"path\":\"infra/alerts.yml\"}]}\n", 0]
]
EOF
