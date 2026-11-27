#!/usr/bin/env bash
# Workspace: src/format.js exports padLeft, which no file imports; the local
# knowledge base holds a `kept` verdict for it (a public API) whose sha256 and tree
# match the current state, so the pass reuses it instead of reporting it again.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src test
cat > package.json <<'EOF'
{ "name": "tally-cli", "version": "1.0.0", "type": "module", "exports": "./src/format.js", "scripts": { "test": "node --test test/" } }
EOF
cat > src/format.js <<'EOF'
export function formatShare(share) {
  return `${share.toFixed(1)}%`;
}

export function padLeft(text, width) {
  return text.padStart(width);
}
EOF
cat > src/report.js <<'EOF'
import { formatShare } from './format.js';

export function report(rows) {
  return rows.map((r) => `${r.language} ${formatShare(r.share)}`).join('\n');
}
EOF
cat > test/report.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { report } from '../src/report.js';
test('report', () => assert.equal(report([{ language: 'Go', share: 50 }]), 'Go 50.0%'));
EOF
git add .
git commit -q -m "feat: report"
sha=$( (sha256sum src/format.js 2>/dev/null || shasum -a 256 src/format.js) | cut -d' ' -f1)
mkdir -p .cedarloom/knowledge
printf '.cedarloom/knowledge/\n' >> "$(git rev-parse --git-path info/exclude)"
cat > .cedarloom/knowledge/verdicts.json <<EOF
{ "entries": [ {
  "id": "cleanup:src/format.js:padLeft",
  "part": "cleanup",
  "file": "src/format.js",
  "name": "padLeft",
  "verdict": "kept",
  "reason": "public API: package.json exports src/format.js",
  "revisit": "package.json no longer exports src/format.js",
  "commit": "$(git rev-parse HEAD)",
  "date": "$(date -u +%Y-%m-%d)",
  "tree": "$(git rev-parse 'HEAD^{tree}')",
  "files": { "src/format.js": "$sha" }
} ] }
EOF
chmod 700 .cedarloom/knowledge
chmod 600 .cedarloom/knowledge/verdicts.json
