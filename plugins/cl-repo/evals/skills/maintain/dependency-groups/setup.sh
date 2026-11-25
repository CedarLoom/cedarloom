#!/usr/bin/env bash
# Workspace: a Node.js CLI with five outdated dependencies, one advisory, one major
# with a breaking change it uses, two packages released together and two minor or
# patch updates, one with a deprecation it uses. The registry answers are recorded
# in registry/, so the case runs offline and its expected groups never move.
set -eu
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
git init -q -b main
mkdir -p src registry/changelogs
cat > AGENTS.md <<'EOF'
# AGENTS.md

The registry is not reachable from this workspace. `registry/` holds its recorded answers: `audit.json` is the output of `npm audit --json`, `outdated.json` of `npm outdated --json` with each package's repository and publish dates, and `changelogs/<package>.md` each package's changelog (a scoped name uses `__` for `/`). Read them instead of running npm.

Tests: `node --test`.
EOF
cat > package.json <<'EOF'
{
  "name": "tally-cli",
  "version": "1.0.0",
  "type": "module",
  "bin": { "tally": "src/cli.js" },
  "dependencies": {
    "@lumen/core": "3.2.0",
    "@lumen/render": "3.2.0",
    "hue-text": "2.3.0",
    "quill-args": "4.1.0",
    "tinydate": "1.4.2",
    "yaml-lite": "0.9.1"
  }
}
EOF
cat > src/cli.js <<'EOF'
#!/usr/bin/env node
import { parse } from 'quill-args';
import { load } from 'yaml-lite';
import { readFileSync } from 'node:fs';
import { report } from './report.js';

const args = parse(process.argv.slice(2).join(' '));
const config = load(readFileSync(args.config ?? 'tally.yml', 'utf8'));
process.stdout.write(report(config));
EOF
cat > src/report.js <<'EOF'
import hue from 'hue-text';
import { format } from 'tinydate';
import { createView } from '@lumen/core';
import { renderText } from '@lumen/render';

export function report(config) {
  const view = createView(config.items);
  return `${hue.bold(config.title)} ${format(new Date(), 'YYYY-MM-DD')}\n${renderText(view)}\n`;
}
EOF
cat > registry/audit.json <<'EOF'
{
  "vulnerabilities": {
    "yaml-lite": {
      "name": "yaml-lite",
      "severity": "high",
      "via": [{ "source": 1104221, "title": "Prototype pollution in load() through merge keys", "url": "https://github.com/advisories/GHSA-7x2q-yl4m-9c3p", "severity": "high", "range": "<0.9.3" }],
      "fixAvailable": { "name": "yaml-lite", "version": "0.9.4", "isSemVerMajor": false }
    }
  },
  "metadata": { "vulnerabilities": { "low": 0, "moderate": 0, "high": 1, "critical": 0, "total": 1 } }
}
EOF
cat > registry/outdated.json <<'EOF'
{
  "@lumen/core": { "current": "3.2.0", "latest": "3.3.0", "repository": "github:lumen-ui/lumen (packages/core)", "published": "2026-10-02" },
  "@lumen/render": { "current": "3.2.0", "latest": "3.3.0", "repository": "github:lumen-ui/lumen (packages/render)", "published": "2026-10-02" },
  "hue-text": { "current": "2.3.0", "latest": "2.4.0", "repository": "github:hue-text/hue-text", "published": "2026-09-14" },
  "quill-args": { "current": "4.1.0", "latest": "5.0.0", "repository": "github:quill/quill-args", "published": "2026-09-30" },
  "tinydate": { "current": "1.4.2", "latest": "1.4.3", "repository": "github:tinydate/tinydate", "published": "2026-08-21" },
  "yaml-lite": { "current": "0.9.1", "latest": "0.9.4", "repository": "github:yaml-lite/yaml-lite", "published": "2026-10-11" }
}
EOF
cat > registry/changelogs/quill-args.md <<'EOF'
# Changelog

## 5.0.0

- Breaking: `parse()` no longer accepts a string. Pass the argument array, as in `parse(process.argv.slice(2))`.
- Breaking: Node.js 18 is no longer supported.

## 4.2.0

- `parse()` accepts `--no-<flag>` for boolean flags.

## 4.1.0

- Adds short flag groups (`-abc`).
EOF
cat > registry/changelogs/hue-text.md <<'EOF'
# Changelog

## 2.4.0

- Deprecated: the chained helpers `hue.bold()`, `hue.dim()` and `hue.italic()`. Use `hue.style('bold', text)`; the helpers are removed in 3.0.0.
- Adds `hue.style()`.

## 2.3.0

- Adds 256-color support.
EOF
cat > registry/changelogs/tinydate.md <<'EOF'
# Changelog

## 1.4.3

- Fixes `format()` for dates before 1970.

## 1.4.2

- Fixes the `ww` week token.
EOF
cat > registry/changelogs/yaml-lite.md <<'EOF'
# Changelog

## 0.9.4

- Fixes a crash on empty documents.

## 0.9.3

- Security: `load()` no longer merges `__proto__` through merge keys (GHSA-7x2q-yl4m-9c3p).

## 0.9.2

- Deprecated: `loadAll()` without a callback. Pass a callback or use `loadStream()`.
EOF
cat > registry/changelogs/@lumen__core.md <<'EOF'
# Changelog

All `@lumen/*` packages are released together from one repository, with one version.

## 3.3.0

- `createView()` accepts a `sort` option.
- Requires `@lumen/render` 3.3.0: the view format changed, and `@lumen/render` 3.2.x renders a 3.3.0 view blank.
EOF
cat > registry/changelogs/@lumen__render.md <<'EOF'
# Changelog

All `@lumen/*` packages are released together from one repository, with one version.

## 3.3.0

- Renders the 3.3.0 view format. Requires `@lumen/core` 3.3.0.
EOF
git add .
git commit -q -m "feat: tally cli"
