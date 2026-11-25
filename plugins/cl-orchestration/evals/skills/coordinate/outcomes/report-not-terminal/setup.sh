#!/usr/bin/env bash
# Workspace: the project widget, the report of the worker of issue 12 (DONE with a draft pull request) and a saved
# terminal read of the same worker that shows a failed test run, so the outcome must come from the report alone.
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
Message: --type worker_done --outcome succeeded
Subject: DONE: example-org/widget#12

Issue: example-org/widget#12
Outcome: DONE
What changed: draft pull request #57 on fix/12-login-timeout, commit 2e5f2917a754dae6815d67b4d0da759259f335e1, src/session.js and test/session.test.js
Checks and results: npm test: 48 passed, 0 failed; npm run lint: clean
Models: opus = example-model-large-2
Phases: plan, implement, test, review
Review: standard, no security review (no auth or input handling changed)
Open risks: the timeout default is not checked against the production config
Outside the issue: none
Next step: review pull request #57
REPORT
cat > .cedarloom/runs/r-1125/terminal-12.txt <<'TERM'
> widget@1.2.0 test
> node --test

not ok 3 - session expires after timeout
  error: expected 900 to equal 1800
# tests 48
# pass 47
# fail 1
TERM
