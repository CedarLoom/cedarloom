import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GIT } from '../skills/debloat/token-budget.mjs';
import { BadInput, Refused, readBase, writeBase } from '../skills/maintain/knowledge.mjs';

const A_SHA = '037ecd1db38c230c248787e60fd7bfc0cb0101b187b59535b6e7483be762d350';
const NOW = new Date('2026-03-31T12:00:00Z');

// A repository with a.js and b.js in one commit; returns its root and a git runner.
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-'));
  const git = (...a) => execFileSync(GIT, ['-C', root, ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(root, 'a.js'), 'export const a = 1;\n');
  writeFileSync(join(root, 'b.js'), 'export const b = 2;\n');
  git('add', 'a.js', 'b.js');
  git('commit', '-qm', 'init');
  return { root, git };
}

const store = (root, kind, data) => {
  mkdirSync(join(root, '.cedarloom/knowledge'), { recursive: true });
  writeFileSync(join(root, `.cedarloom/knowledge/${kind}.json`), typeof data === 'string' ? data : JSON.stringify(data));
};
const verdict = (fields) => ({ part: 'cleanup', file: 'a.js', name: 'a', commit: 'c'.repeat(40), date: '2026-03-30', files: { 'a.js': A_SHA }, ...fields });

test('read: reuses only entries whose files and tree still match, re-checks the rest, ignores broken files', () => {
  const { root, git } = repo();
  const tree = git('rev-parse', 'HEAD^{tree}');
  const reused = [
    verdict({ id: 'fresh', verdict: 'kept', reason: 'public API', revisit: 'package.json no longer exports a.js', tree }),
    verdict({ id: 'rejected-recently', verdict: 'rejected', date: '2026-03-02' }),
  ];
  store(root, 'verdicts', { entries: [
    ...reused,
    verdict({ id: 'changed', verdict: 'open', files: { 'a.js': '0'.repeat(64) } }),
    verdict({ id: 'missing', verdict: 'open', files: { 'gone.js': A_SHA } }),
    verdict({ id: 'tree', verdict: 'open', tree: '1'.repeat(40) }),
    verdict({ id: 'rejected-long-ago', verdict: 'rejected', date: '2026-03-01' }),
    verdict({ id: 'no-revisit', verdict: 'kept', reason: 'public API' }),
    verdict({ id: 'outside', verdict: 'open', files: { '../a.js': A_SHA } }),
    verdict({ id: 'no-proof', verdict: 'open', files: {} }),
    'not an entry',
  ] });
  store(root, 'tests', '{ "entries": [');
  store(root, 'architecture', JSON.stringify({ entries: [], pad: 'x'.repeat(1024 * 1024) }));
  store(root, 'tools', { list: [] });

  const out = readBase(root, NOW);
  assert.deepEqual(out.reuse.verdicts, reused);
  assert.deepEqual(out.recheck.verdicts, [
    { id: 'changed', why: 'a.js changed' },
    { id: 'missing', why: 'gone.js is missing or no regular file' },
    { id: 'tree', why: 'the tree changed' },
    { id: 'rejected-long-ago', why: 'rejected more than 30 days ago' },
    { id: 'no-revisit', why: 'invalid: a kept verdict needs reason and revisit' },
    { id: 'outside', why: 'invalid: files is not path to sha256' },
    { id: 'no-proof', why: 'invalid: neither files nor tree' },
    { id: null, why: 'invalid: no id' },
  ]);
  assert.deepEqual(out.ignored, ['tests.json does not parse', 'architecture.json is larger than 1 MiB', 'tools.json has no entries list']);
  assert.deepEqual(out.reuse.questions, []);
});

test('write: stores entries local-only with hashes, tree, commit and date, replaces by id, and reads back as reusable', () => {
  const { root, git } = repo();
  const head = git('rev-parse', 'HEAD');
  const first = writeBase(root, { verdicts: [{ id: 'cleanup:a.js:a', part: 'cleanup', file: 'a.js', name: 'a', verdict: 'open', files: ['a.js'], tree: true }] }, NOW);
  assert.deepEqual(first, { written: { verdicts: 1 }, dropped: { verdicts: 0 }, excluded: true });
  const second = writeBase(root, { verdicts: [{ id: 'cleanup:a.js:a', part: 'cleanup', file: 'a.js', name: 'a', verdict: 'kept', reason: 'public API', revisit: 'a.js leaves the exports', files: ['a.js'] }] }, NOW);
  assert.deepEqual(second, { written: { verdicts: 1 }, dropped: { verdicts: 0 }, excluded: false });

  const expected = { id: 'cleanup:a.js:a', part: 'cleanup', file: 'a.js', name: 'a', verdict: 'kept', reason: 'public API', revisit: 'a.js leaves the exports', commit: head, date: '2026-03-31', files: { 'a.js': A_SHA } };
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.cedarloom/knowledge/verdicts.json'), 'utf8')), { entries: [expected] });
  assert.equal(readFileSync(join(root, '.git/info/exclude'), 'utf8').split('\n').filter((l) => l === '.cedarloom/knowledge/').length, 1);
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(statSync(join(root, '.cedarloom/knowledge')).mode & 0o777, 0o700);
  assert.equal(statSync(join(root, '.cedarloom/knowledge/verdicts.json')).mode & 0o777, 0o600);
  assert.deepEqual(readBase(root, NOW).reuse.verdicts, [expected]);
});

test('read and write: a working tree that differs from HEAD proves no tree-backed entry', () => {
  const { root, git } = repo();
  writeBase(root, { tools: [{ id: 'knip', tree: true }], verdicts: [{ id: 'v', part: 'cleanup', file: 'a.js', name: 'a', verdict: 'open', files: ['a.js'] }] }, NOW);
  writeFileSync(join(root, 'b.js'), 'export const b = 3;\n');
  const out = readBase(root, NOW);
  assert.deepEqual(out.recheck.tools, [{ id: 'knip', why: 'the working tree differs from HEAD' }]);
  assert.deepEqual(out.reuse.verdicts.map((e) => e.id), ['v']);
  assert.throws(() => writeBase(root, { tools: [{ id: 'knip', tree: true }] }, NOW), BadInput);
  assert.equal(git('status', '--porcelain'), 'M b.js');
});

test('write: an ignore rule for one base file still gets the whole base excluded', () => {
  const { root } = repo();
  writeFileSync(join(root, '.git/info/exclude'), '.cedarloom/knowledge/verdicts.json');
  const out = writeBase(root, { tools: [{ id: 'knip', tree: true }] }, NOW);
  assert.equal(out.excluded, true);
  assert.equal(readFileSync(join(root, '.git/info/exclude'), 'utf8'), '.cedarloom/knowledge/verdicts.json\n.cedarloom/knowledge/\n');
});

test('write: drops the oldest entries until the file stays within 1 MiB', () => {
  const { root } = repo();
  const old = Array.from({ length: 3 }, (_, i) => ({ id: `q${i}`, text: 'x'.repeat(340 * 1024), commit: 'c'.repeat(40), date: `2026-01-0${i + 1}`, tree: '1'.repeat(40) }));
  store(root, 'questions', { entries: old });
  const out = writeBase(root, { questions: [{ id: 'new', text: 'y'.repeat(10 * 1024), tree: true }] }, NOW);
  assert.deepEqual(out.dropped, { questions: 1 });
  const path = join(root, '.cedarloom/knowledge/questions.json');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).entries.map((e) => e.id), ['q1', 'q2', 'new']);
  assert.ok(statSync(path).size <= 1024 * 1024);
});

test('write: refuses an entry larger than the file may be and keeps the stored entries', () => {
  const { root } = repo();
  const old = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, commit: 'c'.repeat(40), date: '2026-01-01', tree: '1'.repeat(40) }));
  store(root, 'questions', { entries: old });
  assert.throws(() => writeBase(root, { questions: [{ id: 'huge', text: 'x'.repeat(1100 * 1024), tree: true }] }, NOW), BadInput);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.cedarloom/knowledge/questions.json'), 'utf8')).entries.map((e) => e.id), ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9']);
});

test('write: an ignore rule for the base files only still gets their temporary files ignored', () => {
  const { root, git } = repo();
  writeFileSync(join(root, '.gitignore'), '.cedarloom/knowledge/*.json\n');
  git('add', '.gitignore');
  git('commit', '-qm', 'ignore');
  writeBase(root, { tools: [{ id: 'knip', tree: true }] }, NOW);
  assert.equal(git('check-ignore', '--', '.cedarloom/knowledge/tools.json.1234.tmp'), '.cedarloom/knowledge/tools.json.1234.tmp');
});

test('write: keeps the newest 500 entries of a file, dropping the oldest by date', () => {
  const { root } = repo();
  const old = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, commit: 'c'.repeat(40), date: i === 7 ? '2025-01-01' : '2026-01-01', tree: '1'.repeat(40) }));
  store(root, 'tools', { entries: old });
  const out = writeBase(root, { tools: [{ id: 'new', tool: 'knip', tree: true }] }, NOW);
  assert.deepEqual(out.dropped, { tools: 1 });
  const ids = JSON.parse(readFileSync(join(root, '.cedarloom/knowledge/tools.json'), 'utf8')).entries.map((e) => e.id);
  assert.equal(ids.length, 500);
  assert.equal(ids.includes('t7'), false);
  assert.equal(ids.at(-1), 'new');
});

test('write: refuses a link in the base path, a tracked base and a base git does not ignore; a proof path through a linked folder and bad input write nothing', () => {
  const linked = repo();
  const elsewhere = mkdtempSync(join(tmpdir(), 'elsewhere-'));
  symlinkSync(elsewhere, join(linked.root, '.cedarloom'));
  const entry = { id: 'x', part: 'cleanup', file: 'a.js', name: 'a', verdict: 'open', files: ['a.js'] };
  assert.throws(() => writeBase(linked.root, { verdicts: [entry] }, NOW), Refused);
  assert.throws(() => readBase(linked.root, NOW), Refused);
  assert.equal(existsSync(join(elsewhere, 'knowledge')), false);

  const tracked = repo();
  store(tracked.root, 'verdicts', { entries: [] });
  tracked.git('add', '-f', '.cedarloom/knowledge/verdicts.json');
  tracked.git('commit', '-qm', 'base');
  assert.throws(() => writeBase(tracked.root, { verdicts: [entry] }, NOW), Refused);

  const negated = repo();
  writeFileSync(join(negated.root, '.gitignore'), '!.cedarloom/knowledge/\n!.cedarloom/knowledge/*.json\n');
  assert.throws(() => writeBase(negated.root, { verdicts: [entry] }, NOW), Refused);
  assert.throws(() => writeBase(negated.root, { verdicts: [entry] }, NOW), Refused);
  assert.equal(existsSync(join(negated.root, '.cedarloom')), false);
  assert.equal(readFileSync(join(negated.root, '.git/info/exclude'), 'utf8').split('\n').filter((l) => l === '.cedarloom/knowledge/').length, 1);

  const outside = repo();
  writeFileSync(join(elsewhere, 'a.js'), 'export const a = 1;\n');
  symlinkSync(elsewhere, join(outside.root, 'linked'));
  assert.throws(() => writeBase(outside.root, { verdicts: [{ ...entry, files: ['linked/a.js'] }] }, NOW), BadInput);
  store(outside.root, 'verdicts', { entries: [verdict({ id: 'through-link', verdict: 'open', files: { 'linked/a.js': A_SHA } })] });
  assert.deepEqual(readBase(outside.root, NOW).recheck.verdicts, [{ id: 'through-link', why: 'linked/a.js is missing or no regular file' }]);

  const bad = repo();
  assert.throws(() => writeBase(bad.root, { verdicts: [entry, { ...entry, id: 'y', verdict: 'kept', reason: 'public API' }] }, NOW), BadInput);
  assert.throws(() => writeBase(bad.root, { verdicts: [{ ...entry, files: undefined }] }, NOW), BadInput);
  assert.throws(() => writeBase(bad.root, { notes: [] }, NOW), BadInput);
  assert.equal(existsSync(join(bad.root, '.cedarloom')), false);
  assert.equal(readFileSync(join(bad.root, '.git/info/exclude'), 'utf8').includes('.cedarloom'), false);
});
