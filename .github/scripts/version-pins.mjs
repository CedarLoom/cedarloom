// Writes the plugins' version (the bundle's .claude-plugin/plugin.json) into the plugin install lines of the docs that name a release tag:
// the marketplace ref `#cedarloom-v<version>` (Claude Code) or `@cedarloom-v<version>` (Codex). Other version mentions stay as written.
// It also fails when an Orca file of the coordinate skill names an Orca or Claude Code version, or marks a claim unverified or observed, outside the pin lines at the top of orca.md.
// Usage: node .github/scripts/version-pins.mjs [--check]   (--check: changes nothing; exit 1 when a file differs)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './main.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Text under plugins/ ships inside the release it would name.
export const SKIP = /^plugins\/|package-lock\.json$/;

// The Orca files of the coordinate skill: they name the versions they were checked with once, in orca.md's pin lines; an open check is an issue, not a note.
export const ORCA_FILES = /^plugins\/cl-orchestration\/skills\/coordinate\/(orca[^/]*|automatic-start|recurring-runs|bot-catch-up)\.md$/;

// The 1-based numbers of the lines that cite a version or mark a claim unverified or observed. With pinned (orca.md), the pin lines
// in the head of the file (the title, blank lines and pin lines before any other line) are exempt; a pin line anywhere else counts.
export function provenance(text, pinned = false) {
  let head = pinned;
  return text.split('\n').flatMap((line, i) => {
    const pin = /^Checked with (Orca|Claude Code) \d+\.\d+\.\d+( to \d+\.\d+\.\d+)?\.$/.test(line);
    head &&= pin || line === '' || /^# /.test(line);
    if (head && pin) return [];
    return /\b(Orca|Claude Code) v?\d+\.\d+\.\d+|\b(unverified|observed)\b/i.test(line) ? [i + 1] : [];
  });
}

export function pins(text, version) {
  return text.replace(/([#@])cedarloom-v\d+\.\d+\.\d+/g, `$1cedarloom-v${version}`);
}

if (isMain(import.meta.url)) {
  // The release tag cedarloom-v<version> is the bundle's (component cedarloom), as in release.yml.
  const { packages } = JSON.parse(readFileSync(`${root}/release-please-config.json`, 'utf8'));
  const bundle = Object.keys(packages).find((path) => packages[path].component === 'cedarloom');
  const { version } = JSON.parse(readFileSync(`${root}/${bundle}/.claude-plugin/plugin.json`, 'utf8'));
  const files = execFileSync('/usr/bin/git', ['ls-files', '*.md', '*.json'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => f && !SKIP.test(f));
  const stale = [];
  for (const f of files) {
    const text = readFileSync(`${root}/${f}`, 'utf8');
    const next = pins(text, version);
    if (next === text) continue;
    stale.push(f);
    if (process.argv[2] !== '--check') writeFileSync(`${root}/${f}`, next);
  }
  const cites = execFileSync('/usr/bin/git', ['ls-files', 'plugins/cl-orchestration/skills/coordinate/*.md'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => ORCA_FILES.test(f))
    .flatMap((f) => provenance(readFileSync(`${root}/${f}`, 'utf8'), f.endsWith('/orca.md')).map((line) => `${f}:${line}`));
  if (cites.length) {
    console.log(`::error::a version cite or an unverified or observed note outside orca.md's pin lines in ${cites.join(', ')}: move it to an issue`);
    process.exitCode = 1;
  }
  if (process.argv[2] === '--check' && stale.length) {
    console.log(`::error::plugin install lines name another release than the plugins (${version}) in ${stale.join(', ')}: run node .github/scripts/version-pins.mjs`);
    process.exit(1);
  }
}
