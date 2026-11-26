#!/usr/bin/env bash
# Workspace: one supervised project with a policy, and the fake Orca's answers for the start condition, run-create
# and the worktree of issue 12, so the case grades the exact argv of each call in .fake/orca-calls.jsonl.
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
mkdir -p project/docs/agents project/src
cat > project/AGENTS.md <<'EOF'
# AGENTS.md

Widget is a small Node.js web service.

Tests: `node --test`. Commits follow Conventional Commits.
EOF
cat > project/cedarloom.json <<'EOF'
{
  "schemaVersion": 3,
  "startLabel": "cl:ready-for-agent",
  "workersPerProject": 1,
  "hostWorkerLimit": 2
}
EOF
cat > project/src/session.js <<'EOF'
export const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
EOF
git -C project add .
git -C project commit -q -m "feat: widget service"

# The coordinator may name the project path relative, with ./, or absolute (logical or physical): each gets the same answer.
node - "$PWD" "$(pwd -P)" > .fake/orca.json <<'EOF'
const [logical, physical] = process.argv.slice(2);
const ok = (result) => `${JSON.stringify({ ok: true, result })}\n`;
const worktree = `${logical}/widget-worktrees/12-login-timeout`;
const answers = [
  [['skills', 'get', 'orchestration'], '# Orca orchestration\n\nRuns, workers, worktrees and terminals for coordinating agents. Every command takes --json.\n', 0],
  [['--version'], '1.4.262\n', 0],
  [['status', '--json'], ok({ runtime: { appVersion: '1.4.262' } }), 0],
  [['orchestration', 'run-list', '--json'], ok({ runs: [] }), 0],
  [['orchestration', 'worker-list', '--json'], ok({ workers: [] }), 0],
  [['terminal', 'list', '--json'], ok({ terminals: [] }), 0],
];
for (const name of ['project', 'widget', 'example-org/widget']) {
  answers.push([['orchestration', 'run-create', '--objective', `issue work: ${name}`, '--json'], ok({ run: { id: 'run_eval1' } }), 0]);
  answers.push([['chat', 'rename', '--name', `Coordinator: ${name}`], 'Missing required --session: this is not running inside a chat\n', 1]);
}
for (const path of new Set(['project', './project', `${logical}/project`, `${physical}/project`])) {
  answers.push([['worktree', 'create', '--name', '12-login-timeout', '--repo', `path:${path}`, '--base-branch', 'main', '--no-parent', '--setup', 'run', '--json'], ok({ worktree: { path: worktree, branch: '12-login-timeout' } }), 0]);
}
process.stdout.write(`${JSON.stringify(answers, null, 1)}\n`);
EOF
cat > .fake/gh.json <<'EOF'
[
 [["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "{\"defaultBranchRef\":{\"name\":\"main\"},\"nameWithOwner\":\"example-org/widget\"}\n", 0]
]
EOF
