import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { count, decide, inspectLock, processStart, readState, removeLock, takeLock, writeState } from '../skills/coordinate/state.mjs';

const folder = () => mkdtempSync(join(tmpdir(), 'cl-state-'));
const NOW = new Date('2026-11-20T12:00:00Z');
const minutesAfter = (date, m) => new Date(date.getTime() + m * 60_000);
const holderAt = (state, holder) => { mkdirSync(join(state, 'lock')); writeFileSync(join(state, 'lock', 'holder.json'), JSON.stringify(holder)); };

test('state: a missing or unreadable file reads as null', () => {
  const dir = folder();
  writeFileSync(join(dir, 'cut.json'), '{ "pr": ');
  assert.equal(readState(join(dir, 'absent.json')), null);
  assert.equal(readState(join(dir, 'cut.json')), null);
  assert.equal(readState(dir), null);
});

test('state: a write replaces the file in one step, so a reader that holds the old file still reads it whole, and leaves no temporary file', () => {
  const dir = folder(), file = join(dir, 'pr-1.json'), held = join(dir, 'reader.json');
  writeState(file, { pr: 1, round: 1 });
  linkSync(file, held);
  writeState(file, { pr: 1, round: 2 });
  assert.deepEqual(readState(file), { pr: 1, round: 2 });
  assert.deepEqual(readState(held), { pr: 1, round: 1 });
  assert.deepEqual(readdirSync(dir).sort(), ['pr-1.json', 'reader.json']);
});

test('state: the lock is taken once, and its holder runs, so it is not stale', () => {
  const state = folder();
  const raw = takeLock(state, { pr: 1, head: 'a'.repeat(40) }, NOW);
  assert.equal(takeLock(state, { pr: 2, head: 'b'.repeat(40) }, NOW), null);
  const lock = inspectLock(state, minutesAfter(NOW, 1));
  assert.deepEqual({ ...lock.holder, start: undefined }, { pid: process.pid, start: undefined, pr: 1, head: 'a'.repeat(40), takenAt: NOW.toISOString() });
  assert.equal(lock.raw, raw);
  assert.equal(lock.stale, false);
  assert.equal(inspectLock(folder(), NOW), null);
});

test('state: a lock is stale once its holder is over 15 minutes old', () => {
  const state = folder();
  takeLock(state, { pr: 1, head: 'a'.repeat(40) }, NOW);
  assert.equal(inspectLock(state, minutesAfter(NOW, 14)).stale, false);
  assert.equal(inspectLock(state, minutesAfter(NOW, 16)).stale, true);
});

test('state: a lock is stale when its process is gone', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    await once(child, 'spawn');
    const alive = folder();
    holderAt(alive, { pid: child.pid, start: processStart(child.pid) ?? null, pr: 1, head: 'a'.repeat(40), takenAt: NOW.toISOString() });
    assert.equal(inspectLock(alive, NOW).stale, false);
    child.kill('SIGKILL');
    await once(child, 'exit');
    assert.equal(inspectLock(alive, NOW).stale, true);
  } finally {
    child.kill('SIGKILL');
  }
});

// ps and /proc both give start times in CI; where neither is readable, only the age ends the lock.
test('state: a lock is stale when its process id now names a process with another start time', { skip: typeof processStart(process.pid) !== 'string' && 'no process start time readable here' }, () => {
  const reused = folder();
  holderAt(reused, { pid: process.pid, start: 'Thu Jan  1 00:00:00 1970', pr: 1, head: 'a'.repeat(40), takenAt: NOW.toISOString() });
  assert.equal(inspectLock(reused, NOW).stale, true);
});

test('state: a lock without a readable holder is held until the folder is 15 minutes old', () => {
  const state = folder();
  mkdirSync(join(state, 'lock'));
  writeFileSync(join(state, 'lock', 'holder.json'), '{ "pid": 0, "start": "x", "takenAt": "2026-11-20T12:00:00Z" }');
  utimesSync(join(state, 'lock'), NOW, NOW);
  assert.deepEqual(inspectLock(state, minutesAfter(NOW, 14)), { holder: null, raw: '{ "pid": 0, "start": "x", "takenAt": "2026-11-20T12:00:00Z" }', stale: false });
  assert.equal(inspectLock(state, minutesAfter(NOW, 16)).stale, true);
});

test('state: a lock is removed only while its holder is the one read, else it is put back', () => {
  const state = folder();
  const raw = takeLock(state, { pr: 1, head: 'a'.repeat(40) }, NOW);
  // Taken again by another run since it was read.
  assert.equal(removeLock(state, raw.replace('"pr": 1', '"pr": 2')), false);
  assert.equal(readFileSync(join(state, 'lock', 'holder.json'), 'utf8'), raw);
  assert.equal(removeLock(state, raw), true);
  assert.deepEqual(readdirSync(state), []);
  assert.equal(removeLock(state, raw), false);
});

test('state: count adds to the counts of the UTC day, per pull request too, and refuses a file that holds no counts', () => {
  const dir = folder();
  count(dir, NOW, { runs: 1, workerStarts: 1, pr: 9 });
  assert.deepEqual(count(dir, new Date('2026-11-20T23:59:59Z'), { runs: 1, catchUp: 1, pr: 9 }), { runs: 2, workerStarts: 1, catchUp: 1, prs: { 9: 2 } });
  assert.deepEqual(readState(join(dir, 'counts-2026-11-20.json')), { runs: 2, workerStarts: 1, catchUp: 1, prs: { 9: 2 } });
  assert.deepEqual(count(dir, new Date('2026-11-21T00:00:00Z')), { runs: 0, workerStarts: 0, catchUp: 0, prs: {} });
  writeFileSync(join(dir, 'counts-2026-11-20.json'), JSON.stringify({ runs: -1, workerStarts: 0, catchUp: 0, prs: {} }));
  assert.throws(() => count(dir, NOW, { runs: 1 }), /counts-2026-11-20\.json holds no counts/);
});

test('state: count refuses to add what is no count, and writes nothing', () => {
  const dir = folder();
  count(dir, NOW, { runs: 320, pr: 9 });
  for (const add of [{ runs: 0.5 }, { runs: -320, pr: 9 }, { catchUp: '1' }, { runs: 1, pr: 0 }]) assert.throws(() => count(dir, NOW, add), /count: add holds no counts/);
  assert.deepEqual(count(dir, NOW), { runs: 320, workerStarts: 0, catchUp: 0, prs: { 9: 320 } });
});

test('state: a Hold decides no maintain finding, so each stays open; another answer decides each, keeping a filed issue number', () => {
  const dir = folder();
  const path = join(dir, 'maintain.json');
  assert.deepEqual(decide(dir, ['M1', 'M2'], null), []);
  assert.equal(readState(path), null);
  writeState(path, { M0: { approved: true, issue: 41 } });
  assert.deepEqual(decide(dir, ['M0', 'M1', 'M2'], ['M0', 'M2']), ['M0', 'M1', 'M2']);
  assert.deepEqual(readState(path), { M0: { approved: true, issue: 41 }, M1: { approved: false }, M2: { approved: true } });
});
