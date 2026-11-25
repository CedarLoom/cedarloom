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

`tally <folder>` prints one row per language: files, lines and the share of all lines, as a whole percent. It counts `.go`, `.js` and `.py` files in the folder and every folder below it.

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
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const LANGUAGES = { '.go': 'Go', '.js': 'JavaScript', '.py': 'Python' };

export function count(folder) {
  const totals = new Map();
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    const language = LANGUAGES[extname(entry.name)];
    if (!entry.isFile() || !language) continue;
    const lines = readFileSync(join(entry.parentPath, entry.name), 'utf8').split('\n').length - 1;
    const total = totals.get(language) ?? { language, files: 0, lines: 0 };
    total.files += 1;
    total.lines += lines;
    totals.set(language, total);
  }
  const all = [...totals.values()].reduce((n, t) => n + t.lines, 0);
  return [...totals.values()].map((t) => ({ ...t, share: all ? Math.round((t.lines / all) * 100) : 0 }));
}
EOF
cat > package.json <<'EOF'
{ "name": "tally-cli", "version": "1.0.0", "type": "module", "bin": { "tally": "src/cli.js" } }
EOF
git add .
git commit -q -m "feat: tally"
