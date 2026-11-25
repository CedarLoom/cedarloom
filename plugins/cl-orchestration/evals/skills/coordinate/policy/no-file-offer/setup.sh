#!/usr/bin/env bash
# Workspace: example-org/widget with no cedarloom.json, a private repository with issues on,
# so the case checks that the coordinator picks nothing and offers the policy file as an owner decision.
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
mkdir -p project/src
cat > project/AGENTS.md <<'EOF'
# AGENTS.md

widget: a small Node.js web library. Tests: `node --test`.
EOF
cat > project/src/index.js <<'EOF'
export const version = '1.4.0';
EOF
git -C project add .
git -C project commit -q -m "feat: widget"

cat > .fake/gh.json <<'EOF'
[
  [["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "{\"nameWithOwner\":\"example-org/widget\",\"defaultBranchRef\":{\"name\":\"main\"}}\n", 0],
  [["repo", "view", "example-org/widget", "--json", "visibility,hasIssuesEnabled"], "{\"hasIssuesEnabled\":true,\"visibility\":\"PRIVATE\"}\n", 0],
  [["pr", "list", "-R", "example-org/widget", "--head", "chore/agent-policy", "--state", "open", "--json", "number,isCrossRepository"], "[]\n", 0]
]
EOF
