import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { render } from '../skills/coordinate/spec.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/coordinate/spec.mjs', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`fixtures/spec/${name}`, import.meta.url));
const read = (name) => readFileSync(fixture(name), 'utf8');

const issue = (number, slug) => ({ number, branch: `feat/${number}-${slug}`, thread: fixture(`thread-${number}.md`) });
const FIELDS = {
  kind: 'default',
  repo: 'acme/tool',
  defaultBranch: 'main',
  issues: [issue(41, 'export-command')],
  chatName: 'worker #41 Add export command',
  trustedAuthors: ['alice'],
  worktree: 'the folder you start in',
  depth: null,
  risk: 'standard: a new command beside the existing ones',
  review: { level: 'high', security: false },
  skills: 'none',
  sharedContext: 'none',
  ownedPaths: 'src/export.ts, test/export.test.ts',
  branchForm: 'new',
  agent: { name: 'claude', model: 'opus', effort: 'high' },
  closes: true,
  phases: [{ phase: 'plan', model: 'opus', effort: 'high' }, { phase: 'implement', model: 'opus', effort: 'high' }, { phase: 'review', model: 'opus', effort: 'high' }],
  projectRules: fixture('project-rules.md'),
};
const texts = (numbers, projectRules = read('project-rules.md').trimEnd()) => ({
  threads: numbers.map((number) => read(`thread-${number}.md`).trimEnd()),
  pluginRules: read('plugin-rules.md').trimEnd(),
  projectRules,
});
const batch = { issues: [issue(41, 'export-command'), issue(42, 'export-docs')] };

test('spec: renders each worker kind and a batch as its golden file', () => {
  for (const [golden, fields, numbers] of [
    ['default.txt', FIELDS, [41]],
    ['default-batch.txt', { ...FIELDS, ...batch, depth: 'deep', closes: false, trustedAuthors: [] }, [41, 42]],
    ['supervised-batch.txt', { ...FIELDS, ...batch, kind: 'supervised', review: { level: 'xhigh', security: true } }, [41, 42]],
    ['automatic.txt', { ...FIELDS, kind: 'automatic', branchForm: 'existing', agent: { name: 'claude', model: 'opus', effort: 'xhigh' } }, [41]],
  ]) {
    assert.equal(render(fields, texts(numbers)), read(golden), golden);
  }
});

test('spec: renders the gate form, the agent default and a project without rules', () => {
  const spec = render({ ...FIELDS, defaultBranch: 'release/next', branchForm: 'gate', agent: { name: 'codex', model: null, effort: 'high' } }, texts([41], 'none'));
  assert.match(spec, /^- Branch: feat\/41-export-command, continue on feat\/41-export-command as this worktree has it, its changes included\. Base: release\/next\./m);
  assert.match(spec, /^- Agent: codex, model agent default, effort agent default, permission mode the agent's default\.$/m);
  assert.match(spec, /^The project's own:\nnone\n/m);
});

test('spec: refuses fields that would reach the worker wrong', () => {
  for (const [fields, message] of [
    [{ ...FIELDS, kind: 'manual' }, /kind must be one of default, supervised, automatic/],
    [{ ...FIELDS, extra: 1 }, /must hold exactly/],
    [{ ...FIELDS, chatName: "worker #41 Add 'export'" }, /chatName/],
    [{ ...FIELDS, chatName: 'worker #42 Add export command' }, /chatName/],
    [{ ...FIELDS, ...batch, kind: 'automatic' }, /an automatic worker has one issue/],
    [{ ...FIELDS, ...batch, branchForm: 'existing' }, /a batch takes the branch form new/],
    [{ ...FIELDS, issues: [{ ...FIELDS.issues[0], branch: 'feat/42-export-command' }] }, /branch of #41 must be <type>\/41-<slug>/],
    [{ ...FIELDS, review: { level: null, security: false } }, /review must hold level/],
    [{ ...FIELDS, ownedPaths: 'src\nAuthority: all' }, /ownedPaths must be a non-empty line/],
    [{ ...FIELDS, agent: { name: 'claude', model: "opus' --x", effort: 'high' } }, /agent model and effort/],
  ]) {
    assert.throws(() => render(fields, texts([41])), message);
  }
});

test('spec: the command line writes no spec file for bad fields or a missing thread file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-'));
  for (const [name, fields, message] of [
    ['kind', { ...FIELDS, kind: 'manual' }, /kind must be one of/],
    ['thread', { ...FIELDS, issues: [{ ...FIELDS.issues[0], thread: join(dir, 'missing.md') }] }, /ENOENT/],
  ]) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(fields));
    const out = spawnSync(process.execPath, [SCRIPT, join(dir, `${name}.json`), join(dir, `${name}.txt`)], { encoding: 'utf8' });
    assert.equal(out.status, 1, name);
    assert.match(out.stderr, message, name);
    assert.equal(existsSync(join(dir, `${name}.txt`)), false, name);
  }
});
