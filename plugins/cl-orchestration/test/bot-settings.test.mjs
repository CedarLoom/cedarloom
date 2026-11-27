import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../skills/coordinate/bot-settings.mjs', import.meta.url));
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const folder = () => realpathSync(mkdtempSync(join(tmpdir(), 'cl-bot-settings-')));

test('bot settings: a role bot denies each other home and the lock folder, and --check passes only for the same arguments', () => {
  const dir = folder(), home = join(dir, 'reviewer'), args = ['reviewer', home, '--other', join(dir, 'p'), '--other', join(dir, 'b'), '--lock', join(dir, 'lock')];
  assert.equal(run(args).status, 0);
  const deny = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).permissions.deny;
  assert.deepEqual(deny.slice(-3), [`Edit(/${dir}/p/**)`, `Edit(/${dir}/b/**)`, `Edit(/${dir}/lock/**)`]);
  assert.ok(deny.includes(`Edit(/${home}/state/**)`));
  assert.equal(run(['--check', ...args]).status, 0);
  const other = run(['--check', ...args.slice(0, 4), '--lock', join(dir, 'lock')]);
  assert.equal(other.status, 1);
  assert.match(other.stderr, /is not the settings file this script writes for those arguments/);
});

test('bot settings: a path with a pattern character, a role bot without other homes and a project bot with a lock write nothing', () => {
  const dir = folder();
  for (const args of [['builder', join(dir, 'b*'), '--other', join(dir, 'p'), '--lock', join(dir, 'l')], ['builder', join(dir, 'b'), '--lock', join(dir, 'l')], ['project', join(dir, 'p'), '--lock', join(dir, 'l')]]) {
    assert.equal(run(args).status, 1);
  }
  assert.equal(existsSync(join(dir, 'b')) || existsSync(join(dir, 'p')) || existsSync(join(dir, 'b*')), false);
});
