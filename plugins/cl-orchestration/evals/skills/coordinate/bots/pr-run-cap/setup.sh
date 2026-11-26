#!/usr/bin/env bash
# Workspace: a small Node.js project whose project bot run is described in the prompt; the
# project gives the coordinate skill a real checkout to start on.
set -eu
for program in orca gh; do
  case "$(command -v "$program")" in
    */evals/bin/"$program") ;;
    *) echo "$program on PATH is not the evals fake: put plugins/cl-orchestration/evals/bin first on PATH (plugins/cl-orchestration/evals/README.md)" >&2; exit 1 ;;
  esac
done
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
mkdir -p .fake && touch .fake/orca-calls.jsonl .fake/gh-calls.jsonl
cat > .fake/gh.json <<'JSON'
[[["repo","view","--json","nameWithOwner,defaultBranchRef"],"{\"defaultBranchRef\":{\"name\":\"main\"},\"nameWithOwner\":\"example-org/widget\"}\n",0]]
JSON
git init -q -b main project
git -C project remote add origin https://github.com/example-org/widget.git
mkdir -p project/docs/agents project/src project/test
cat > project/AGENTS.md <<'MD'
# AGENTS.md

Widget is a small Node.js library for login sessions. Tests: `node --test`. Lint: `npx eslint src test`.
MD
cat > project/src/session.js <<'JS'
export function isExpired(session, now = Date.now()) {
  return now - session.lastSeen > session.timeoutMs;
}
JS
cat > project/test/session.test.js <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExpired } from '../src/session.js';

test('a session past its timeout is expired', () => {
  assert.equal(isExpired({ lastSeen: 0, timeoutMs: 10 }, 11), true);
});
JS
cat > project/cedarloom.json <<'JSON'
{
  "schemaVersion": 3,
  "startLabel": "cl:ready-for-agent",
  "workersPerProject": 1,
  "hostWorkerLimit": 2,
  "issuesPerWorker": 1,
  "merge": {
    "allowed": true,
    "requiredChecks": ["ci"]
  },
  "closeIssue": true
}
JSON
git -C project add .
git -C project commit -q -m "feat: widget sessions"
