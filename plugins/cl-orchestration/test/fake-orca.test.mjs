import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FAKE = fileURLToPath(new URL('fake-orca.mjs', import.meta.url));
const BIN = fileURLToPath(new URL('../evals/bin/', import.meta.url));

// A workspace with .fake/orca.json at its root and a sub folder to call from.
function workspace(answers) {
  const root = mkdtempSync(join(tmpdir(), 'fake-orca-'));
  mkdirSync(join(root, '.fake'));
  mkdirSync(join(root, 'repo'));
  if (answers) writeFileSync(join(root, '.fake', 'orca.json'), JSON.stringify(answers));
  return root;
}

const run = (cwd, args) => spawnSync(process.execPath, [FAKE, 'orca', ...args], { cwd, encoding: 'utf8' });
const calls = (root) => readFileSync(join(root, '.fake', 'orca-calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).args);

test('an argv listed exactly gets its stdout and exit code', () => {
  const root = workspace([[['status', '--json'], '{"result":{}}\n'], [['worker-show', '--worker', 'w1', '--json'], 'gone\n', 3]]);
  const ok = run(join(root, 'repo'), ['status', '--json']);
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, '{"result":{}}\n');
  const failed = run(root, ['worker-show', '--worker', 'w1', '--json']);
  assert.equal(failed.status, 3);
  assert.equal(failed.stdout, 'gone\n');
});

test('an argv that differs in order, a flag or a value fails as not faked, and every call is logged', () => {
  const root = workspace([[['orchestration', 'send', '--to', 'term_1', '--subject', 'go'], '']]);
  for (const args of [
    ['orchestration', 'send', '--subject', 'go', '--to', 'term_1'],
    ['orchestration', 'send', '--to', 'term_1', '--subject', 'go', '--json'],
    ['orchestration', 'send', '--to', 'term_2', '--subject', 'go'],
  ]) {
    const result = run(root, args);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, `not faked: orca ${args.join(' ')}\n`);
  }
  assert.deepEqual(calls(root), [
    ['orchestration', 'send', '--subject', 'go', '--to', 'term_1'],
    ['orchestration', 'send', '--to', 'term_1', '--subject', 'go', '--json'],
    ['orchestration', 'send', '--to', 'term_2', '--subject', 'go'],
  ]);
});

test('without an answers file every call fails', () => {
  const root = workspace();
  const result = run(root, ['status', '--json']);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'not faked: orca status --json\n');
});

test('without a .fake folder above the working folder nothing runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'no-fake-'));
  const result = run(dir, ['status', '--json']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^orca is faked here, and no \.fake folder is above /);
});

test('the evals bin folder runs the fake as orca and as gh', () => {
  const root = workspace([[['status', '--json'], 'orca\n']]);
  writeFileSync(join(root, '.fake', 'gh.json'), JSON.stringify([[['pr', 'view', '7'], 'gh\n']]));
  const env = { ...process.env, PATH: `${BIN}:${process.env.PATH}` };
  assert.equal(spawnSync('orca', ['status', '--json'], { cwd: root, env, encoding: 'utf8' }).stdout, 'orca\n');
  assert.equal(spawnSync('gh', ['pr', 'view', '7'], { cwd: root, env, encoding: 'utf8' }).stdout, 'gh\n');
});
