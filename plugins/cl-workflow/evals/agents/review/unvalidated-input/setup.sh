#!/usr/bin/env bash
# Workspace: a branch that adds a CSV importer without checking the values it reads.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src
cat > src/sessions.js <<'EOF'
export const sessions = [];

export function addSession(session) {
  sessions.push(session);
}
EOF
printf '{ "type": "module" }\n' > package.json
git add . && git commit -q -m "feat: chronograph sessions"
git checkout -q -b feat/labradar-import
cat > src/import.js <<'EOF'
import { addSession } from './sessions.js';

export function importLabradar(csv) {
  const rows = csv.trim().split('\n').slice(1);
  const shots = rows.map((row) => {
    const cols = row.split(',');
    return { shot: Number(cols[0]), velocity: Number(cols[1]) };
  });
  addSession({ source: 'labradar', shots });
  return shots.length;
}
EOF
git add . && git commit -q -m "feat: import LabRadar CSV exports"
