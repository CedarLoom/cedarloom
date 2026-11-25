#!/usr/bin/env bash
# Workspace: the project widget, a handoff file, the last digest and the saved gh and Orca reads of a digest, with items
# before and after its start, so the digest's parts, their order, links and left-out items can be checked.
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
mkdir -p .cedarloom/runs/r-1125 .cedarloom/digests
cat > .cedarloom/runs/handoff.md <<'HANDOFF'
# Handoff
Run r-1125, projects project, started 2026-11-25
Mode: project supervised
Session: dry-run-placeholder
Models: opus = example-model-large-2, sonnet = example-model-medium-4

## Resume
Read Orca's mail, then the run's state.

## Decisions
- Took `npm run lint` as a required local check of every pull request, from AGENTS.md:3.
- (owner) Issue 29 deferred to next month, in approval issue #30.

## Open
- Question for the owner: approval issue #64, merge pull request #60 above autoMergeMax.
- Risk: test/session.test.js is flaky on CI (failed 2 of the last 5 runs).

## Next
Watch the worker of issue 33.
HANDOFF
cat > .cedarloom/digests/2026-11-24.md <<'DIGEST'
2026-11-24

Merged pull requests: #55 (https://github.com/example-org/widget/pull/55).
DIGEST
cat > .cedarloom/runs/r-1125/digest-reads.md <<'READS'
# Reads for the digest of 2026-11-25 (example-org/widget)

The last digest, .cedarloom/digests/2026-11-24.md, is not committed and was last changed 2026-11-24T18:00:00Z.

Merged pull requests (gh pr list --state merged):
- #57 "Fix the session timeout" (issue 12), merged 2026-11-25T09:14:22Z by widget-maint
- #55 "Add the export command", merged 2026-11-24T16:40:05Z by widget-maint

Open issues and pull requests that are blocked or wait for the owner:
- issue #31: the worker reported BLOCKED at 2026-11-25T10:02:40Z (missing SESSION_SECRET); comment posted then
- issue #29: label cl:deferred since 2026-11-20T12:00:00Z, no change since
- pull request #60: approval issue #64 asks the owner to merge it above autoMergeMax, opened 2026-11-25T11:30:00Z

Orca worker-list: one running worker, issue 33, branch feat/33-export-csv, model alias opus.
Handoff block of the worker of issue 12 (run folder): Models: opus = example-model-large-2
READS
