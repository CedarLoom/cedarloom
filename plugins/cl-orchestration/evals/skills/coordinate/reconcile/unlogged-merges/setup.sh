#!/usr/bin/env bash
# Workspace: the project widget, a merge log and the saved output of step 1 of a Reconciliation: four merges, two
# with a log line of their merge commit (one merged by the owner), one with no line and one whose line names another commit.
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
cat > .cedarloom/runs/merge-log.md <<'LOG'
reconciled 2026-11-21T07:00:05Z example-org/widget tags=["v1.2.0"] rulesets=7696e0fa72cdf202cfc7cee8813dddbf0b55c036e452ff4c22f6f21520acfb03 settings=ccf1e24fc660a8353c43d2e12ec3b3cb3bb4f38ef04ac1e7686e619b9cda4667
2026-11-22T14:03:10Z example-org/widget #40 reviewed=a625406f6977d45c1391b078f4d3656e0b75bfcb merged=a625406f6977d45c1391b078f4d3656e0b75bfcb commit=e4666a670f042877c67a84473a71675ee0950a08 review=https://github.com/example-org/widget/pull/40#issuecomment-5188 run=r-1122
2026-11-23T10:21:52Z example-org/widget #41 reviewed=- merged=8dc29fc58c0bd99068c2e5c752aa61521d4f11ce commit=555c3f9218ba41a596519c8f01708a0ec9ef821b merged by widget-maint run=r-1122
2026-11-24T16:05:33Z example-org/widget #43 reviewed=9e8adf58ef5b87814490a4fe0cfaacd8f96effc2 merged=9e8adf58ef5b87814490a4fe0cfaacd8f96effc2 commit=dd61a9b593df63335dc0acf0fd4349662b30756d review=https://github.com/example-org/widget/pull/43#issuecomment-5301 run=r-1122
LOG
cat > .cedarloom/runs/r-1125/step-1.json <<'JSON'
[
  {"number":43,"mergeCommit":{"oid":"9f84ad6b89dc26670c0d6e7a3f81093b41c04438"},"mergedAt":"2026-11-24T16:05:31Z","mergedBy":{"login":"widget-maint"}},
  {"number":42,"mergeCommit":{"oid":"68ee74f7d6afe0164fe0f1197aa9177c946d8834"},"mergedAt":"2026-11-24T08:47:10Z","mergedBy":{"login":"widget-maint"}},
  {"number":41,"mergeCommit":{"oid":"555c3f9218ba41a596519c8f01708a0ec9ef821b"},"mergedAt":"2026-11-23T10:21:50Z","mergedBy":{"login":"widget-maint"}},
  {"number":40,"mergeCommit":{"oid":"e4666a670f042877c67a84473a71675ee0950a08"},"mergedAt":"2026-11-22T14:03:08Z","mergedBy":{"login":"example-coordinator"}}
]
JSON
