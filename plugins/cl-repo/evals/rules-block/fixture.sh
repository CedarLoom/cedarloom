#!/usr/bin/env bash
# Builds the rules block fixture in the current folder: AGENTS.md holds the CedarLoom
# block (the rules file given as $1, `host` answer: no extra line) and CLAUDE.md imports
# it. src/format.js:formatDuration loses its only caller with the task; legacyPad, in the
# same file, is dead code outside the task that the run reads when it removes formatDuration.
# Usage: bash fixture.sh <path to plugins/cl-repo/rules/project.md>
set -eu
rules=$1
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src test
{
  printf '# AGENTS.md\n\n## Commands\n\n- Tests: `node --test test/`.\n\n<!-- cedarloom start -->\n'
  cat "$rules"
  printf '<!-- cedarloom end -->\n'
} > AGENTS.md
printf '@AGENTS.md\n' > CLAUDE.md
cat > README.md <<'EOF'
# Jobs

Prints one line per finished job: its name, the files it touched and how long it took.
EOF
cat > package.json <<'EOF'
{ "name": "jobs", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test test/" } }
EOF
cat > src/format.js <<'EOF'
export function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatCount(n) {
  return n.toLocaleString('en-US');
}

export function legacyPad(text) {
  return ` ${text}`;
}
EOF
cat > src/span.js <<'EOF'
// Durations print as hours and minutes ("1h 2m"), rounded down to the minute.
export function formatSpan(ms) {
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
EOF
cat > src/report.js <<'EOF'
import { formatCount, formatDuration } from './format.js';

export function report(job) {
  return `${job.name}: ${formatCount(job.files)} files in ${formatDuration(job.ms)}`;
}
EOF
cat > test/report.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { report } from '../src/report.js';

test('report', () => {
  assert.equal(report({ name: 'build', files: 1200, ms: 3720000 }), 'build: 1,200 files in 1h 2m');
});
EOF
git add .
git commit -q -m "feat: job report"
