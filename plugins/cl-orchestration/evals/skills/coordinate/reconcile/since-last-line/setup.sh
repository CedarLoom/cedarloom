#!/usr/bin/env bash
# Workspace: the project widget and a merge log with reconciled lines of two repositories, so the date of the
# last reconciliation of example-org/widget has to be read from its own last `reconciled` line.
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
mkdir -p .cedarloom/runs
cat > .cedarloom/runs/merge-log.md <<'LOG'
2026-11-17T09:12:44Z example-org/widget #38 reviewed=2f22765d04931a078909145ca628d2264c852d7d merged=2f22765d04931a078909145ca628d2264c852d7d commit=6b1f53303a732ccc8c6aae6640399827c15250e3 review=https://github.com/example-org/widget/pull/38#issuecomment-5101 run=r-1117
reconciled 2026-11-18T07:00:02Z example-org/widget tags=["v1.2.0"] rulesets=7696e0fa72cdf202cfc7cee8813dddbf0b55c036e452ff4c22f6f21520acfb03 settings=ccf1e24fc660a8353c43d2e12ec3b3cb3bb4f38ef04ac1e7686e619b9cda4667
reconciled 2026-11-21T07:00:05Z example-org/widget tags=["v1.2.0"] rulesets=7696e0fa72cdf202cfc7cee8813dddbf0b55c036e452ff4c22f6f21520acfb03 settings=ccf1e24fc660a8353c43d2e12ec3b3cb3bb4f38ef04ac1e7686e619b9cda4667
2026-11-22T14:03:10Z example-org/widget #40 reviewed=a625406f6977d45c1391b078f4d3656e0b75bfcb merged=a625406f6977d45c1391b078f4d3656e0b75bfcb commit=e4666a670f042877c67a84473a71675ee0950a08 review=https://github.com/example-org/widget/pull/40#issuecomment-5188 run=r-1122
reconciled 2026-11-23T07:00:01Z example-org/gadget tags=[] rulesets=98c5c74e3852b0cdc0cc06d7e9ec8f810d39243671a5375a0ddf9633ee949592 settings=ccf1e24fc660a8353c43d2e12ec3b3cb3bb4f38ef04ac1e7686e619b9cda4667
2026-11-24T11:40:27Z example-org/widget #41 reviewed=8dc29fc58c0bd99068c2e5c752aa61521d4f11ce merged=8dc29fc58c0bd99068c2e5c752aa61521d4f11ce commit=555c3f9218ba41a596519c8f01708a0ec9ef821b review=https://github.com/example-org/widget/pull/41#issuecomment-5230 run=r-1122
LOG
