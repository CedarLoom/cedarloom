#!/usr/bin/env bash
# Workspace: project/, a minimal widget repository with its origin remote; the pull request facts are in the prompt,
# so the case decides the text the reviewer gives /code-review without running a command.
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
cat > project/AGENTS.md <<'EOF'
# AGENTS.md

Widget is a small Node.js session library. Tests: `node --test`. Commits follow Conventional Commits.
EOF
mkdir -p project/src
echo 'export const version = "1.0.0";' > project/src/index.js
git -C project remote add origin https://github.com/example-org/widget.git
git -C project add .
git -C project commit -q -m "feat: widget"
