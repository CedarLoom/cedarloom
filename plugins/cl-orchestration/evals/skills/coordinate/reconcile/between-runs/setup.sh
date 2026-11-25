#!/usr/bin/env bash
# Workspace: the project widget, the merge log and config listing of an earlier run, and the reads of a new run's first
# Reconciliation, so changes made between the runs (a tag, a config key, the settings hash) show as findings.
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
2026-11-09T15:30:12Z example-org/widget #36 reviewed=48c7489aa2e8309a658e9b785074e360a5eff369 merged=48c7489aa2e8309a658e9b785074e360a5eff369 commit=9e8adf58ef5b87814490a4fe0cfaacd8f96effc2 review=https://github.com/example-org/widget/pull/36#issuecomment-4870 run=r-1109
reconciled 2026-11-10T18:02:44Z example-org/widget tags=["v1.2.0"] rulesets=7696e0fa72cdf202cfc7cee8813dddbf0b55c036e452ff4c22f6f21520acfb03 settings=ccf1e24fc660a8353c43d2e12ec3b3cb3bb4f38ef04ac1e7686e619b9cda4667
LOG
cat > .cedarloom/runs/git-config-example-org-widget.txt <<'CFG'
core.repositoryformatversion=0
core.filemode=true
core.bare=false
core.logallrefupdates=true
remote.origin.url=https://github.com/example-org/widget.git
remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*
CFG
cat > .cedarloom/runs/r-1125/reads.md <<'READS'
# Reads of the Reconciliation of example-org/widget, 2026-11-25T08:10Z

Step 1, merged pull requests since 2026-11-10: []

Step 2, `gh api repos/example-org/widget/tags --paginate --jq '.[].name'`:
v1.3.0
v1.2.0

Step 3, `gh api repos/example-org/widget/rulesets`: its SHA-256 is 7696e0fa72cdf202cfc7cee8813dddbf0b55c036e452ff4c22f6f21520acfb03

Step 4, `git -C project config --local --list | grep -v '^branch\.'`:
core.repositoryformatversion=0
core.filemode=true
core.bare=false
core.logallrefupdates=true
core.hookspath=.githooks
remote.origin.url=https://github.com/example-org/widget.git
remote.origin.fetch=+refs/heads/*:refs/remotes/origin/*

Step 4, `shasum -a 256 ~/.claude/settings.json`: 075aa00ea75b72fcbebdfd996f41b1563ffb0d22152477273e43ea10045de51d
READS
