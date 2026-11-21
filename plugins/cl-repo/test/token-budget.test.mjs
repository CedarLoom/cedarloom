import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { check, loadConfig, measure } from '../skills/debloat/token-budget.mjs';

// A file of exactly `tokens` estimated tokens (4 bytes each) that starts with `head`.
const sized = (head, tokens) => head + 'x'.repeat(tokens * 4 - Buffer.byteLength(head));
// "n: " plus a 37-character description: 40 bytes, 10 listed tokens.
const skill = (flags = '') => `---\nname: n\ndescription: ${'d'.repeat(37)}\n${flags}---\nBody.\n`;
const HIDDEN = 'disable-model-invocation: true\n';
const CODEX_OFF = 'interface:\n  display_name: "N"\npolicy:\n\n  # Codex lists it only on request.\n  allow_implicit_invocation: false\n';

function repo(config, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'token-budget-'));
  const files = {
    'AGENTS.md': sized('', 100),
    'CLAUDE.md': sized('@docs/imported.md\n`@docs/other.md`\n', 10),
    'docs/imported.md': sized('@second.md\n', 20),
    'docs/second.md': sized('', 30),
    'docs/other.md': sized('', 40),
    'sub/AGENTS.md': sized('', 50),
    '.claude/rules/all.md': sized('# Rule\n', 5),
    '.claude/rules/scoped.md': sized('---\npaths: src/**\n---\n', 6),
    'plugins/p/skills/claude-hidden/SKILL.md': skill(HIDDEN),
    'plugins/p/skills/both-hidden/SKILL.md': skill(HIDDEN),
    'plugins/p/skills/both-hidden/agents/openai.yaml': CODEX_OFF,
    'plugins/p/skills/codex-hidden/SKILL.md': skill(),
    'plugins/p/skills/codex-hidden/agents/openai.yaml': CODEX_OFF,
    '.claude/skills/local/SKILL.md': skill(HIDDEN),
    'plugins/p/agents/helper.md': skill(),
    'notes/outside.md': sized('', 60),
    ...(config ? { '.github/token-budget.json': JSON.stringify(config) } : {}),
    ...extra,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const always = (m) => Object.fromEntries(Object.entries(m.files).filter(([, f]) => f.always).map(([p, f]) => [p, f.always]));

test('token-budget: root instruction files, their imports and unscoped rules count whole, other files their listing text', () => {
  const root = repo();
  const m = measure(root, loadConfig(root));
  assert.deepEqual(always(m), {
    '.claude/rules/all.md': 5,
    'AGENTS.md': 100,
    'CLAUDE.md': 10,
    'docs/imported.md': 20,
    'docs/second.md': 30,
    'plugins/p/agents/helper.md': 10,
    'plugins/p/skills/claude-hidden/SKILL.md': 10,
    'plugins/p/skills/codex-hidden/SKILL.md': 10,
  });
  assert.equal(m.alwaysLoaded, 195);
});

test('token-budget: a CLAUDE.md that links to AGENTS.md counts once', () => {
  const root = mkdtempSync(join(tmpdir(), 'token-budget-'));
  writeFileSync(join(root, 'AGENTS.md'), sized('', 100));
  symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'));
  assert.equal(measure(root, loadConfig(root)).alwaysLoaded, 100);
});

test('token-budget: a skill is unlisted only when no host lists it', () => {
  const root = repo();
  const { files } = measure(root, loadConfig(root));
  assert.equal(files['plugins/p/skills/claude-hidden/SKILL.md'].listed, 10);
  assert.equal(files['plugins/p/skills/codex-hidden/SKILL.md'].listed, 10);
  assert.equal(files['plugins/p/skills/both-hidden/SKILL.md'].listed, 0);
  assert.equal(files['.claude/skills/local/SKILL.md'].listed, 0);
});

test('token-budget: alwaysLoadedFiles counts files in scope whole', () => {
  const root = repo({ alwaysLoadedFiles: ['docs/other.md', 'notes/*.md'] });
  const m = measure(root, loadConfig(root));
  assert.equal(m.files['docs/other.md'].always, 40);
  assert.equal(m.files['notes/outside.md'], undefined);
  assert.equal(m.alwaysLoaded, 235);
});

test('token-budget: a config without the new keys reports the always-loaded sum and gates only the total', () => {
  const root = repo({ budget: { total: 376 } });
  const c = check(root, loadConfig(root), undefined, true);
  assert.deepEqual(c.failures, ['total 377 is above the budget 376']);
  assert.match(c.text, /: 195 now\b/);
});

test('token-budget: an --against file without the new fields reads, with no earlier always-loaded sum', () => {
  const root = repo();
  const against = { files: { 'AGENTS.md': { tokens: 90 } }, total: 90, listed: 7 };
  const c = check(root, loadConfig(root), against, true);
  assert.equal(c.ok, true);
  assert.match(c.text, /: 195 now\b/);
  assert.doesNotMatch(c.text, /before, 195 now/);
  assert.match(c.text, /: 7 before, 30 now\b/);
  const newer = check(root, loadConfig(root), { ...against, alwaysLoaded: 180 }, true);
  assert.match(newer.text, /: 180 before, 195 now\b/);
});

test('token-budget: check fails with one line above budget.alwaysLoaded', () => {
  const over = repo({ budget: { alwaysLoaded: 194 } });
  assert.deepEqual(check(over, loadConfig(over), undefined, true).failures, ['always loaded 195 is above the budget 194']);
  const at = repo({ budget: { alwaysLoaded: 195 } });
  assert.deepEqual(check(at, loadConfig(at), undefined, true).failures, []);
});

test('token-budget: check fails for an imported file in the repository that is not measured', () => {
  const root = repo(undefined, { 'CLAUDE.md': '@docs/imported.md\n@notes/outside.md\n@notes/missing.md\n@../away.md\n' });
  assert.deepEqual(check(root, loadConfig(root), undefined, true).failures, ['notes/outside.md: loads every session (imported by CLAUDE.md) but is not measured (include, exclude)']);
});

test('token-budget: check passes for an imported file git ignores', () => {
  const root = repo(undefined, { 'CLAUDE.md': '@notes/outside.md\n', '.gitignore': 'notes/\n' });
  execFileSync('git', ['init', '-q'], { cwd: root });
  assert.deepEqual(check(root, loadConfig(root), undefined, true).failures, []);
});

test('token-budget: check fails for an import through a symlinked directory', () => {
  const root = repo(undefined, { 'CLAUDE.md': '@shared/rules.md\n', 'real/rules.md': sized('', 70) });
  symlinkSync('real', join(root, 'shared'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  assert.deepEqual(check(root, loadConfig(root), undefined, true).failures, ['shared/rules.md: loads every session (imported by CLAUDE.md) but is not measured (include, exclude)']);
});

test('token-budget: check fails for an alwaysLoadedFiles pattern that matches no measured file', () => {
  const root = repo({ alwaysLoadedFiles: ['docs/other.md', 'notes/*.md'] });
  assert.deepEqual(check(root, loadConfig(root), undefined, true).failures, ['alwaysLoadedFiles notes/*.md matches no measured file']);
});

test('token-budget: check fails for a budget it cannot read', () => {
  const failures = (budget) => {
    const root = repo({ budget });
    return check(root, loadConfig(root), undefined, true).failures;
  };
  assert.deepEqual(failures(1200), ['budget is not an object']);
  assert.deepEqual(failures(null), ['budget is not an object']);
  assert.deepEqual(failures({ alwaysloaded: 50 }), ['budget.alwaysloaded is not a budget key (total, alwaysLoaded, files)']);
  assert.deepEqual(failures({ alwaysLoaded: 'abc' }), ['budget.alwaysLoaded is not a number']);
  assert.deepEqual(failures({ total: null }), ['budget.total is not a number']);
  assert.deepEqual(failures({ files: 3 }), ['budget.files is not an object']);
  assert.deepEqual(failures({ files: { 'AGENTS.md': 'abc' } }), ['budget.files AGENTS.md is not a number']);
  assert.deepEqual(failures({ files: { 'CLAUDE2.md': 5 } }), ['budget.files CLAUDE2.md is not a measured file']);
  assert.deepEqual(failures({ total: 377, alwaysLoaded: 195, files: { 'AGENTS.md': 100 } }), []);
});

test('token-budget: a command description is listed unless the model cannot invoke it', () => {
  const root = repo(undefined, {
    '.claude/commands/ops/deploy.md': `---\ndescription: ${'d'.repeat(2000)}\n---\nBody.\n`,
    '.claude/commands/hidden.md': `---\ndescription: ${'d'.repeat(32)}\n${HIDDEN}---\nBody.\n`,
  });
  const { files } = measure(root, loadConfig(root));
  // "deploy: " plus the first 1,536 characters: 1,544 bytes.
  assert.equal(files['.claude/commands/ops/deploy.md'].listed, 386);
  assert.equal(files['.claude/commands/hidden.md'].listed, 0);
});
