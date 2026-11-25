#!/usr/bin/env bash
# Workspace: the project widget, a BLOCKED report of the worker of issue 12 whose draft pull request #57 is open with a
# Closes line, the rerun thread file with the worker's comment, and the saved body of #57.
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
cat > project/AGENTS.md <<'AGENTS'
# AGENTS.md

widget is a small Node.js library. Tests: `npm test`. Lint: `npm run lint`.
AGENTS
git -C project remote add origin https://github.com/example-org/widget.git
git -C project add -A
git -C project commit -q -m "chore: widget"
mkdir -p .cedarloom/runs/r-1125
cat > .cedarloom/runs/r-1125/report-12.md <<'REPORT'
Message: --type worker_done --outcome failed
Subject: BLOCKED: example-org/widget#12 needs a SESSION_SECRET for the integration test

Issue: example-org/widget#12
Outcome: BLOCKED
What changed: draft pull request #57 on fix/12-login-timeout, commit 2e5f2917a754dae6815d67b4d0da759259f335e1, src/session.js
Checks and results: npm test: 46 passed, 2 failed (test/session.integration.test.js needs SESSION_SECRET, which this environment lacks)
Models: opus = example-model-large-2
Phases: plan, implement, test
Review: not run, blocked before review
Open risks: the integration tests did not run
Outside the issue: none
Next step: the owner provides SESSION_SECRET for the integration tests; the issue comment says which tests need it
REPORT
cat > .cedarloom/runs/r-1125/thread-12.md <<'THREAD'
# example-org/widget#12 (rerun 2026-11-25T10:04Z)

Title: Login session times out after 15 minutes instead of 30
State: open. Labels: cl:ready-for-agent, cl:in-progress

Comment 1 (author: example-coordinator, 2026-11-25T10:01Z, trusted: yes):
BLOCKED: test/session.integration.test.js needs SESSION_SECRET, which the worker environment lacks. Work so far is on the draft pull request #57.
THREAD
cat > .cedarloom/runs/r-1125/pr-57-body.md <<'BODY'
Sets the session timeout default to 30 minutes and reads it from the config.

Closes #12

Checks: npm test (2 integration tests need SESSION_SECRET).
BODY
