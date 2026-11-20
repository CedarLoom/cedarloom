import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { merge } from '../skills/coordinate/merge.mjs';
import { initRepo } from './git-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/coordinate/merge.mjs', import.meta.url));
const folder = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const NOW = new Date('2026-11-20T12:00:00Z');
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();
const REPO = 'acme/app';
const [TIP, BEFORE, MERGE_COMMIT, OTHER] = ['d', 'e', 'c', 'f'].map((c) => c.repeat(40));

// The origin: main holds the policy, feat/1-x a plain change and feat/2-owner a change of an owner-only file. The bot's project checkout and its scratch clone come from it.
const origin = folder('cl-origin-');
const git = initRepo(origin);
const head = (branch, files) => {
  git('checkout', '-q', '-b', branch, 'main');
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(origin, path, '..'), { recursive: true }); writeFileSync(join(origin, path), text); }
  git('add', '-A');
  git('commit', '-qm', branch);
  return git('rev-parse', 'HEAD').toString().trim();
};
head('policy', { 'docs/agents/orchestration.json': '{ "merge": { "allowed": true } }' });
git('checkout', '-q', 'main');
git('merge', '-q', '--ff-only', 'policy');
const HEAD = head('feat/1-x', { 'src/x.txt': 'x\n' });
const OWNER_HEAD = head('feat/2-owner', { 'AGENTS.md': '# Agents\n' });
git('checkout', '-q', 'main');
const project = join(folder('cl-project-'), 'project'), scratch = join(folder('cl-scratch-'), 'scratch');
git('clone', '-q', origin, project);
git('clone', '-q', '--no-checkout', origin, scratch);

// A stand-in for gh: it logs each argument list to calls.jsonl and answers from world.json in the folder FAKE_GH names. pr merge writes the marker file merged when world.merge is 'merged'.
const bin = folder('cl-bin-');
writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const dir = process.env.FAKE_GH, args = process.argv.slice(2), [a, b, c] = args;
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify(args) + '\\n');
const w = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8')), merged = fs.existsSync(path.join(dir, 'merged'));
const say = (v) => process.stdout.write(JSON.stringify(v));
if (a === 'repo' && b === 'view') say({ defaultBranchRef: { name: 'main' } });
else if (a === 'api' && b === 'graphql') say([{ data: { repository: { pullRequest: { reviewThreads: { nodes: w.threads } } } } }]);
else if (a === 'api' && b.includes('/branches/')) say({ commit: { sha: w.tip } });
else if (a === 'api' && b.includes('/compare/')) say({ commits: w.compare.map((sha) => ({ sha })) });
else if (a === 'run' && b === 'list') say(w.runs);
else if (a === 'pr' && b === 'view' && args[args.indexOf('--json') + 1].includes('autoMergeRequest')) {
  const pr = w.prs[c];
  say(merged ? { state: 'MERGED', mergeCommit: { oid: '${MERGE_COMMIT}' }, mergedAt: '2026-11-20T12:00:30Z', headRefOid: pr.headRefOid, autoMergeRequest: null }
    : { state: 'OPEN', mergeCommit: null, mergedAt: null, headRefOid: pr.headRefOid, autoMergeRequest: w.merge === 'auto' ? { enabledAt: '2026-11-20T12:00:01Z' } : null });
} else if (a === 'pr' && b === 'view') say(w.prs[c]);
else if (a === 'pr' && b === 'merge' && !args.includes('--disable-auto')) {
  if (w.merge === 'fail') { process.stderr.write('GraphQL: Head branch was modified\\n'); process.exit(1); }
  if (w.merge === 'merged') fs.writeFileSync(path.join(dir, 'merged'), '');
} else if (!(a === 'pr' && b === 'merge')) { process.stderr.write('unexpected: ' + args.join(' ') + '\\n'); process.exit(1); }
`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;

const openPr = (n, oid, branch) => ({ state: 'OPEN', headRefOid: oid, baseRefName: 'main', isCrossRepository: false, title: 'feat: add x', body: `Closes #${n}.`, headRefName: branch, headRepositoryOwner: { login: 'acme' }, commits: [{ messageHeadline: 'feat: add x', messageBody: 'Adds x.' }] });
const run = (sha, status, conclusion, workflow, createdAt) => ({ databaseId: Date.parse(createdAt) / 1000 + workflow, headSha: sha, status, conclusion, workflowDatabaseId: workflow, createdAt });
const GREEN = [run(TIP, 'completed', 'success', 10, '2026-11-20T11:49:00Z'), run(BEFORE, 'completed', 'success', 10, '2026-11-20T11:00:00Z')];

// A bot home whose state folder holds pr-<n>.json with an accepted head and verdict, the commit's subject and body files and a tip first seen 11 minutes ago.
function bot({ n = 1, oid = HEAD, branch = 'feat/1-x', action = 'merge', world = {}, files = {} } = {}) {
  const home = folder('cl-bot-'), state = join(home, 'state'), gh = join(home, 'gh');
  mkdirSync(state);
  mkdirSync(gh);
  const file = join(state, `pr-${n}.json`);
  writeFileSync(file, JSON.stringify({ repo: REPO, pr: n, branch, project, clones: [scratch], reviewedHead: oid, reviewUrl: `https://github.com/${REPO}/pull/${n}#pullrequestreview-1`, riskClass: 'low', updatedAt: minutesAgo(60), handled: { head: oid, action } }));
  writeFileSync(join(state, 'tip.json'), JSON.stringify({ sha: TIP, firstSeen: minutesAgo(11), passed: null }));
  writeFileSync(join(state, `pr-${n}-subject.txt`), `feat: add x (#${n})\n`);
  writeFileSync(join(state, `pr-${n}-body.md`), 'Adds x.\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(home, name), text);
  writeFileSync(join(gh, 'world.json'), JSON.stringify({ tip: TIP, runs: GREEN, compare: [], threads: [], merge: 'merged', ...world, prs: { [n]: openPr(n, oid, branch), ...world.prs } }));
  let t = NOW.getTime();
  const call = (method = 'squash') => {
    process.env.FAKE_GH = gh;
    const result = merge(file, method, { now: () => new Date(t), sleep: (ms) => { t += ms; } });
    // Released on every path: no lock and no renamed one is left.
    assert.deepEqual(readdirSync(state).filter((name) => name.startsWith('lock')), []);
    return result;
  };
  const calls = () => (existsSync(join(gh, 'calls.jsonl')) ? readFileSync(join(gh, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);
  const read = (name) => JSON.parse(readFileSync(join(state, name), 'utf8'));
  return { home, state, file, call, calls, read };
}
const merges = (calls) => calls.filter(([a, b]) => a === 'pr' && b === 'merge');

test('merge: a pull request whose checks pass merges with one gh pr merge pinned to the accepted head, then the log, the state and the tip record it', () => {
  const b = bot();
  assert.deepEqual(b.call(), { outcome: 'merged', reason: `merged ${HEAD} as ${MERGE_COMMIT}` });
  assert.deepEqual(merges(b.calls()), [['pr', 'merge', '1', '-R', REPO, '--squash', '--match-head-commit', HEAD, '--subject', 'feat: add x (#1)', '--body-file', join(b.state, 'pr-1-body.md')]]);
  assert.equal(readFileSync(join(b.state, 'merge-log.md'), 'utf8'), `- 2026-11-20T12:00:30Z ${REPO} #1 reviewed ${HEAD} merged ${HEAD} commit ${MERGE_COMMIT} review https://github.com/${REPO}/pull/1#pullrequestreview-1\n`);
  const s = b.read('pr-1.json');
  assert.deepEqual([s.mergeCommandAt, s.mergedAt, s.held], ['2026-11-20T12:00:00.000Z', '2026-11-20T12:00:30Z', undefined]);
  assert.deepEqual(b.read('tip.json'), { sha: MERGE_COMMIT, firstSeen: '2026-11-20T12:00:30Z', passed: TIP });
});

test('merge: a rebase passes no subject or body', () => {
  const b = bot();
  assert.equal(b.call('rebase').outcome, 'merged');
  assert.deepEqual(merges(b.calls()), [['pr', 'merge', '1', '-R', REPO, '--rebase', '--match-head-commit', HEAD]]);
});

test('merge: a lock another run holds answers wait and stays, and nothing is read from GitHub', () => {
  const b = bot();
  mkdirSync(join(b.state, 'lock'));
  // The command line runs on the real clock.
  const holder = JSON.stringify({ pid: process.pid, start: null, pr: 2, head: OTHER, takenAt: new Date().toISOString() });
  writeFileSync(join(b.state, 'lock', 'holder.json'), holder);
  process.env.FAKE_GH = join(b.home, 'gh');
  const r = spawnSync(process.execPath, [SCRIPT, b.file], { encoding: 'utf8' });
  assert.deepEqual([r.status, JSON.parse(r.stdout)], [0, { outcome: 'wait', reason: 'the merge lock is held' }]);
  assert.equal(readFileSync(join(b.state, 'lock', 'holder.json'), 'utf8'), holder);
  assert.deepEqual(b.calls(), []);
});

test('merge: the watch waits for a young tip, a run on the tip, an expected workflow and an unconfirmed merge command', () => {
  const young = bot();
  writeFileSync(join(young.state, 'tip.json'), JSON.stringify({ sha: TIP, firstSeen: minutesAgo(9), passed: null }));
  assert.deepEqual(young.call(), { outcome: 'wait', reason: `the tip ${TIP} is younger than 10 minutes` });

  const running = bot({ world: { runs: [run(TIP, 'in_progress', null, 10, '2026-11-20T11:49:00Z'), ...GREEN.slice(1)] } });
  assert.deepEqual(running.call(), { outcome: 'wait', reason: `a run on the tip ${TIP} has not completed` });

  const expected = bot({ world: { runs: [...GREEN, run(BEFORE, 'completed', 'success', 11, '2026-11-20T11:00:01Z')] } });
  assert.deepEqual(expected.call(), { outcome: 'wait', reason: `1 expected workflow(s) have no run on the tip ${TIP} yet` });
  // After 30 minutes the workflow counts as not run.
  writeFileSync(join(expected.state, 'tip.json'), JSON.stringify({ sha: TIP, firstSeen: minutesAgo(31), passed: null }));
  assert.equal(expected.call().outcome, 'merged');

  const unconfirmed = bot();
  writeFileSync(join(unconfirmed.state, 'pr-3.json'), JSON.stringify({ repo: REPO, pr: 3, mergeCommandAt: minutesAgo(20) }));
  assert.deepEqual(unconfirmed.call(), { outcome: 'wait', reason: 'the merge of #3 is not confirmed' });
  assert.deepEqual(merges(running.calls()).concat(merges(young.calls()), merges(unconfirmed.calls())), []);
});

test('merge: on a red tip only the pull request the answered report names merges, and only while the tip is the red commit', () => {
  const red = { runs: [run(TIP, 'completed', 'failure', 10, '2026-11-20T11:49:00Z'), ...GREEN.slice(1)] };
  const none = bot({ world: red });
  assert.deepEqual(none.call(), { outcome: 'redMain', reason: `the default branch is red at ${TIP}` });

  const other = bot({ world: red });
  writeFileSync(join(other.state, 'red-main.json'), JSON.stringify({ sha: TIP, report: 'https://github.com/acme/app/issues/9', pr: 2 }));
  assert.deepEqual(other.call(), { outcome: 'redMain', reason: `the default branch is red at ${TIP}; its report names #2` });

  const moved = bot({ world: red });
  writeFileSync(join(moved.state, 'red-main.json'), JSON.stringify({ sha: OTHER, report: 'https://github.com/acme/app/issues/9', pr: 1 }));
  assert.deepEqual(moved.call(), { outcome: 'redMain', reason: `the default branch is red at ${TIP}` });

  const named = bot({ world: red });
  writeFileSync(join(named.state, 'red-main.json'), JSON.stringify({ sha: TIP, report: 'https://github.com/acme/app/issues/9', pr: 1 }));
  assert.equal(named.call().outcome, 'merged');
  // The red tip is not recorded as passed.
  assert.equal(named.read('tip.json').passed, null);

  // A workflow that failed on a commit since the last passed watch and ran no more keeps the branch red.
  const since = bot({ world: { compare: [BEFORE, TIP], runs: [GREEN[0], run(BEFORE, 'completed', 'failure', 11, '2026-11-20T11:00:00Z')] } });
  writeFileSync(join(since.state, 'tip.json'), JSON.stringify({ sha: TIP, firstSeen: minutesAgo(11), passed: OTHER }));
  assert.deepEqual(since.call(), { outcome: 'redMain', reason: `the default branch is red at ${TIP}` });
  assert.deepEqual([none, other, moved, since].flatMap((b) => merges(b.calls())), []);
});

test('merge: another pull request updated less than 30 minutes ago whose checks run holds the merge', () => {
  const b = bot({ world: { prs: { 2: { state: 'OPEN', statusCheckRollup: [{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }] } } } });
  writeFileSync(join(b.state, 'pr-2.json'), JSON.stringify({ repo: REPO, pr: 2, updatedAt: minutesAgo(5) }));
  assert.deepEqual(b.call(), { outcome: 'wait', reason: '#2 waits for its checks after an update' });
  writeFileSync(join(b.state, 'pr-2.json'), JSON.stringify({ repo: REPO, pr: 2, updatedAt: minutesAgo(31) }));
  assert.equal(b.call().outcome, 'merged');
});

test('merge: a new head, another verdict or an open review thread restarts the judgment', () => {
  assert.deepEqual(bot({ world: { prs: { 1: openPr(1, OTHER, 'feat/1-x') } } }).call(), { outcome: 'restart', reason: `the head is ${OTHER}, not the accepted ${HEAD}` });
  assert.deepEqual(bot({ action: 'trial' }).call(), { outcome: 'restart', reason: 'the verdict is merge, not trial' });
  const threads = bot({ world: { threads: [{ id: 'T1', isResolved: false, path: 'src/x.txt', line: 1, comments: { totalCount: 0, nodes: [] } }, { id: 'T2', isResolved: true }] } });
  assert.deepEqual(threads.call(), { outcome: 'restart', reason: '1 review thread(s) are unresolved' });
  assert.deepEqual(merges(threads.calls()), []);
});

test('merge: an owner-only file or a held state stops for the owner', () => {
  const owner = bot({ n: 2, oid: OWNER_HEAD, branch: 'feat/2-owner' });
  assert.deepEqual(owner.call(), { outcome: 'stop', reason: 'the verdict is owner' });
  assert.deepEqual(merges(owner.calls()), []);
  const held = bot();
  writeFileSync(held.file, JSON.stringify({ ...held.read('pr-1.json'), held: 'unreviewed head' }));
  assert.deepEqual(held.call(), { outcome: 'stop', reason: 'held: unreviewed head' });
});

test('merge: the pre-merge command reads the pull request text and the commit message, and anything but exit 0 refuses the merge', () => {
  const seen = join(folder('cl-seen-'), 'stdin.txt');
  const pass = bot({ files: { 'pre-merge.json': JSON.stringify({ command: [process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1], require("node:fs").readFileSync(0))', seen] }) } });
  assert.equal(pass.call().outcome, 'merged');
  assert.equal(readFileSync(seen, 'utf8'), 'feat: add x\n\nCloses #1.\n\nfeat/1-x\n\nacme/feat/1-x\n\nfeat: add x\nAdds x.\n\nfeat: add x (#1)\n\nAdds x.\n');

  const refusals = [
    [JSON.stringify({ command: [process.execPath, '-e', 'process.exit(3)'] }), 'the pre-merge command refused the merge (exit 3)'],
    [JSON.stringify({ command: [join(bin, 'absent')] }), 'the pre-merge command did not run: ENOENT'],
    ['{ "command": ', 'pre-merge.json is no JSON'],
    [JSON.stringify({ command: [] }), 'pre-merge.json names no command'],
  ];
  for (const [config, reason] of refusals) {
    const b = bot({ files: { 'pre-merge.json': config } });
    assert.deepEqual(b.call(), { outcome: 'stop', reason });
    assert.deepEqual(merges(b.calls()), []);
  }
});

test('merge: a merge GitHub does not confirm within two minutes, a failed command or auto-merge holds the pull request for the owner', () => {
  const open = bot({ world: { merge: 'open' } });
  assert.deepEqual(open.call(), { outcome: 'stop', reason: 'the merge is not confirmed' });
  assert.equal(open.read('pr-1.json').held, 'the merge is not confirmed');
  assert.equal(existsSync(join(open.state, 'merge-log.md')), false);

  const failed = bot({ world: { merge: 'fail' } });
  assert.deepEqual(failed.call(), { outcome: 'stop', reason: 'the merge is not confirmed: GraphQL: Head branch was modified' });

  const auto = bot({ world: { merge: 'auto' } });
  assert.deepEqual(auto.call(), { outcome: 'stop', reason: 'the merge command turned on auto-merge' });
  assert.deepEqual(merges(auto.calls()).at(-1), ['pr', 'merge', '1', '-R', REPO, '--disable-auto']);
});

test('merge: an error stops with exit 1 after releasing the lock, and a bad argument exits 2', () => {
  const b = bot({ world: { tip: 'not a commit' } });
  assert.deepEqual(b.call(), { outcome: 'stop', reason: 'GitHub gave no commit for the default branch', error: true });
  const r = spawnSync(process.execPath, [SCRIPT, b.file, '--method', 'fast'], { encoding: 'utf8' });
  assert.deepEqual([r.status, JSON.parse(r.stdout).outcome], [2, 'stop']);
});
