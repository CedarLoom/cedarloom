#!/usr/bin/env bash
# Workspace: a branch that switches to a new formatter and leaves the old one without callers.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src
cat > src/format.js <<'EOF'
export function formatVelocity(fps) {
  return `${fps} fps`;
}
EOF
cat > src/report.js <<'EOF'
import { formatVelocity } from './format.js';

export function shotLine(shot) {
  return `#${shot.n}: ${formatVelocity(shot.fps)}`;
}
EOF
printf '{ "type": "module" }\n' > package.json
git add . && git commit -q -m "feat: shot report lines"
git checkout -q -b feat/units
cat >> src/format.js <<'EOF'

export function formatVelocityIn(fps, unit) {
  return unit === 'm/s' ? `${(fps * 0.3048).toFixed(1)} m/s` : `${fps} fps`;
}
EOF
cat > src/report.js <<'EOF'
import { formatVelocityIn } from './format.js';

export function shotLine(shot, unit) {
  return `#${shot.n}: ${formatVelocityIn(shot.fps, unit)}`;
}
EOF
git commit -q -am "feat: velocity in the unit the user picks"
