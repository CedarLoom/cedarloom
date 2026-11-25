#!/usr/bin/env bash
# Workspace: a small CLI whose docs hold three planted problems: the install steps
# twice (README.md and docs/install.md), a default the code contradicts
# (docs/config.md:7 against src/config.js:1) and a link to a missing file (README.md:11).
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p docs src
cat > README.md <<'EOF'
# Tally

Tally counts the lines of code per language in a folder and prints a table.

## Install

1. Install Node.js 22.
2. Run `npm install -g tally-cli`.
3. Run `tally --version` to check the install.

See [configuration](docs/config.md) and [deployment](docs/deploy.md).
EOF
cat > docs/install.md <<'EOF'
# Install

1. Install Node.js 22.
2. Run `npm install -g tally-cli`.
3. Run `tally --version` to check the install.
EOF
cat > docs/config.md <<'EOF'
# Configuration

`tally.yml` in the working directory sets the options.

| Option | Default | Meaning |
|---|---|---|
| `maxDepth` | `8` | how many folder levels tally walks into |
| `ignore` | `[]` | globs it skips |
EOF
cat > src/config.js <<'EOF'
export const defaults = { maxDepth: 4, ignore: [] };

export function withDefaults(options) {
  return { ...defaults, ...options };
}
EOF
cat > package.json <<'EOF'
{ "name": "tally-cli", "version": "1.0.0", "type": "module", "bin": { "tally": "src/config.js" } }
EOF
git add .
git commit -q -m "feat: tally docs"
