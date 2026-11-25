#!/usr/bin/env bash
# Workspace: a usage doc that matches the code it describes, with nothing to find.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p docs src
cat > README.md <<'EOF'
# Tally

Tally counts the lines of code per language in a folder and prints a table.

## Install

Run `npm install -g tally-cli` (Node.js 22).

Usage: [docs/usage.md](docs/usage.md).
EOF
cat > docs/usage.md <<'EOF'
# Usage

`tally <folder>` prints one row per language: files, lines and the share of all lines.

| Option | Effect |
|---|---|
| `--json` | prints the rows as a JSON array instead of a table |
EOF
cat > src/cli.js <<'EOF'
#!/usr/bin/env node
import { count } from './count.js';

const [folder, flag] = process.argv.slice(2);
const rows = count(folder);
if (flag === '--json') process.stdout.write(`${JSON.stringify(rows)}\n`);
else for (const r of rows) process.stdout.write(`${r.language}\t${r.files}\t${r.lines}\t${r.share}%\n`);
EOF
cat > src/count.js <<'EOF'
export function count(folder) {
  return [{ language: 'JavaScript', files: 2, lines: 12, share: 100, folder }];
}
EOF
cat > package.json <<'EOF'
{ "name": "tally-cli", "version": "1.0.0", "type": "module", "bin": { "tally": "src/cli.js" } }
EOF
git add .
git commit -q -m "feat: tally"
