#!/usr/bin/env bash
# Workspace: the project widget, a closing run's handoff file with owner and on-behalf decisions, the last digest in
# .cedarloom/digests/ and a newer file in digests/, which is not the last digest while .cedarloom/digests/ holds one.
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
mkdir -p .cedarloom/runs .cedarloom/digests digests
cat > .cedarloom/runs/handoff.md <<'HANDOFF'
# Handoff
Run r-1125, projects project, started 2026-11-25
Mode: project supervised
Session: dry-run-placeholder
Models: opus = example-model-large-2

## Resume
Read Orca's mail, then the run's state.

## Decisions
- Took `npm test` as the check for issue 12, from AGENTS.md:3.
- Picked issue 31 before issue 33: both normal risk, 31 is older (pick order, policy.md).
- (owner) Merge of pull request #50 above autoMergeMax approved in approval issue #52.

## Open
none

## Next
Close the run.
HANDOFF
cat > .cedarloom/digests/2026-11-24.md <<'DIGEST'
2026-11-24

Decisions taken on the owner's behalf: `npm test` taken as the check for issue 12 (https://github.com/example-org/widget/issues/12), from AGENTS.md:3.
DIGEST
cat > digests/2026-11-25.md <<'DIGEST'
2026-11-25

Decisions taken on the owner's behalf: issue 31 picked before issue 33 (https://github.com/example-org/widget/issues/31), the older of two normal-risk issues.
DIGEST
