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
const [BEFORE, MERGE_COMMIT, OTHER] = ['e', 'c', 'f'].map((c) => c.repeat(40));

// The origin: main holds the policy, feat/1-x a plain change and feat/2-owner a change of an owner-only file. The bot's project checkout and its scratch clone come from it.
const origin = folder('cl-origin-');
const git = initRepo(origin);
const head = (branch, files, from = 'main') => {
  git('checkout', '-q', '-b', branch, from);
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(origin, path, '..'), { recursive: true }); writeFileSync(join(origin, path), text); }
  git('add', '-A');
  git('commit', '-qm', branch);
  return git('rev-parse', 'HEAD').toString().trim();
};
head('policy', { 'docs/agents/orchestration.json': '{ "merge": { "allowed": true, "mode": "disjoint" } }' });
git('checkout', '-q', 'main');
git('merge', '-q', '--ff-only', 'policy');
const HEAD = head('feat/1-x', { 'src/x.txt': 'x\n' });
const OWNER_HEAD = head('feat/2-owner', { 'AGENTS.md': '# Agents\n' });
// Behind main and touching none of its files: the verdict is trial.
const TRIAL_HEAD = head('feat/3-trial', { 'src/t.txt': 't\n' }, 'main~1');
git('checkout', '-q', 'main');
// The tip GitHub reports is the origin's main, which the scratch clone fetches.
const TIP = git('rev-parse', 'main').toString().trim();
const project =join(folder('cl-project-'), 'project'), scratch = join(folder('cl-scratch-'), 'scratch');
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
// Push runs answer a list by event; the list of one commit holds its runs of every event.
else if (a === 'run' && b === 'list') say(args.includes('--event') ? w.runs : [...w.runs, ...w.otherRuns].filter((r) => r.headSha === args[args.indexOf('--commit') + 1]));
else if (a === 'pr' && b === 'view' && args[args.indexOf('--json') + 1].includes('autoMergeRequest')) {
  const pr = w.prs[c];
  if (w.merge === 'unreadable') { process.stderr.write('HTTP 502\\n'); process.exit(1); }
  say(merged ? { state: 'MERGED', mergeCommit: { oid: '${MERGE_COMMIT}' }, mergedAt: '2026-11-20T12:00:30Z', headRefOid: w.mergedHead ?? pr.headRefOid, autoMergeRequest: null }
    : { state: 'OPEN', mergeCommit: null, mergedAt: null, headRefOid: w.mergedHead ?? pr.headRefOid, autoMergeRequest: w.merge === 'auto' ? { enabledAt: '2026-11-20T12:00:01Z' } : null });
} else if (a === 'pr' && b === 'view') say(w.prs[c]);
else if (a === 'pr' && b === 'merge' && !args.includes('--disable-auto')) {
  if (w.clobber) fs.writeFileSync(w.clobber, '{');
  if (w.merge === 'fail') { process.stderr.write('GraphQL: Head branch was modified\\n'); process.exit(1); }
  if (w.merge === 'merged') fs.writeFileSync(path.join(dir, 'merged'), '');
} else if (!(a === 'pr' && b === 'merge')) { process.stderr.write('unexpected: ' + args.join(' ') + '\\n'); process.exit(1); }
`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;

const openPr = (n, oid, branch) => ({ state: 'OPEN', headRefOid: oid, baseRefName: 'main', isCrossRepository: false, title: 'feat: add x', body: `Closes #${n}.`, headRefName: branch, headRepositoryOwner: { login: 'acme' }, commits: [{ messageHeadline: 'feat: add x', messageBody: 'Adds x.' }] });
const run = (sha, status, conclusion, workflow, createdAt) => ({ databaseId: Date.parse(createdAt) / 1000 + workflow, headSha: sha, status, conclusion, workflowDatabaseId: workflow, createdAt });
const GREEN = [run(TIP, 'completed', 'success', 10, '2026-11-20T11:49:00Z'), run(BEFORE, 'completed', 'success', 10, '2026-11-20T11:00:00Z')];

// A bot home whose state folder holds pr-<n>.json with an accepted head and verdict, the commit's subject and body files and a tip first seen 11 minutes ago.
function bot({ n = 1, oid = HEAD, branch = 'feat/1-x', action = 'merge', world = {}, files = {}, fields = {}, subject = `feat: add x (#${n})\n`, body = 'Adds x.\n' } = {}) {
  const home = folder('cl-bot-'), state = join(home, 'state'), gh = join(home, 'gh');
  mkdirSync(state);
  mkdirSync(gh);
  const file = join(state, `pr-${n}.json`);
  writeFileSync(file, JSON.stringify({ repo: REPO, pr: n, branch, project, clones: [scratch], reviewedHead: oid, reviewUrl: `https://github.com/${REPO}/pull/${n}#pullrequestreview-1`, riskClass: 'low', updatedAt: minutesAgo(60), handled: { head: oid, action }, ...fields }));
  writeFileSync(join(state, 'tip.json'), JSON.stringify({ sha: TIP, firstSeen: minutesAgo(11), passed: null }));
  writeFileSync(join(state, `pr-${n}-subject.txt`), subject);
  if (body !== null) writeFileSync(join(state, `pr-${n}-body.md`), body);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(home, name), text);
  writeFileSync(join(gh, 'world.json'), JSON.stringify({ tip: TIP, runs: GREEN, otherRuns: [], compare: [], threads: [], merge: 'merged', ...world, clobber: world.clobber ? file : null, prs: { [n]: openPr(n, oid, branch), ...world.prs } }));
  let t = NOW.getTime();
  const call = (method = 'squash') => {
    process.env.FAKE_GH = gh;
    const result = merge(file, { method, runId: 'run-1' }, { now: () => new Date(t), sleep: (ms) => { t += ms; } });
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
  assert.equal(readFileSync(join(b.state, 'merge-log.md'), 'utf8'), `- 2026-11-20T12:00:30Z ${REPO} #1 reviewed ${HEAD} merged ${HEAD} commit ${MERGE_COMMIT} review https://github.com/${REPO}/pull/1#pullrequestreview-1 run run-1\n`);
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
  const r = spawnSync(process.execPath, [SCRIPT, b.file, '--run', 'run-1'], { encoding: 'utf8' });
  assert.deepEqual([r.status, JSON.parse(r.stdout)], [0, { outcome: 'wait', reason: 'the merge lock is held' }]);
  assert.equal(readFileSync(join(b.state, 'lock', 'holder.json'), 'utf8'), holder);
  assert.deepEqual(b.calls(), []);
});

test('merge: a lock over 15 minutes old is removed and taken', () => {
  const b = bot();
  mkdirSync(join(b.state, 'lock'));
  writeFileSync(join(b.state, 'lock', 'holder.json'), JSON.stringify({ pid: process.pid, start: null, pr: 2, head: OTHER, takenAt: minutesAgo(16) }));
  assert.equal(b.call().outcome, 'merged');
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

  // GitHub's tip passed its watch, but the fetch finds another one.
  const moved = bot({ world: { tip: OTHER, runs: [run(OTHER, 'completed', 'success', 10, '2026-11-20T11:49:00Z')] } });
  writeFileSync(join(moved.state, 'tip.json'), JSON.stringify({ sha: OTHER, firstSeen: minutesAgo(11), passed: null }));
  assert.deepEqual(moved.call(), { outcome: 'wait', reason: `the default branch moved to ${TIP} after its watch was read` });

  const unconfirmed = bot();
  writeFileSync(join(unconfirmed.state, 'pr-3.json'), JSON.stringify({ repo: REPO, pr: 3, mergeCommandAt: minutesAgo(20) }));
  assert.deepEqual(unconfirmed.call(), { outcome: 'wait', reason: 'the merge of #3 is not confirmed' });
  assert.deepEqual(merges(running.calls()).concat(merges(young.calls()), merges(unconfirmed.calls())), []);
});

test('merge: an unreadable state file or a held merge command that has its log line keeps the watch waiting', () => {
  const unreadable = bot();
  writeFileSync(join(unreadable.state, 'pr-3.json'), '{');
  assert.deepEqual(unreadable.call(), { outcome: 'wait', reason: 'pr-3.json is unreadable' });

  const held = bot();
  writeFileSync(join(held.state, 'pr-3.json'), JSON.stringify({ repo: REPO, pr: 3, mergeCommandAt: minutesAgo(20), held: 'the merge is not confirmed' }));
  writeFileSync(join(held.state, 'merge-log.md'), `- 2026-11-20T11:40:00Z ${REPO} #3 reviewed ${OTHER} merged ${OTHER} commit ${BEFORE} review none run run-0\n`);
  assert.deepEqual(held.call(), { outcome: 'wait', reason: 'the merge of #3 is not confirmed' });
});

test('merge: a run of another event on the tip is red, and one that runs holds the merge for at most 30 minutes', () => {
  const scheduled = (status, conclusion) => run(TIP, status, conclusion, 12, '2026-11-20T11:55:00Z');
  const failed = bot({ world: { otherRuns: [scheduled('completed', 'failure')] } });
  assert.deepEqual(failed.call(), { outcome: 'redMain', reason: `the default branch is red at ${TIP}` });

  const running = bot({ world: { otherRuns: [scheduled('in_progress', null)] } });
  assert.deepEqual(running.call(), { outcome: 'wait', reason: `a run on the tip ${TIP} has not completed` });
  writeFileSync(join(running.state, 'tip.json'), JSON.stringify({ sha: TIP, firstSeen: minutesAgo(31), passed: null }));
  assert.equal(running.call().outcome, 'merged');

  // A newer run of the same workflow from another event hides no failed push run; it replaces a cancelled one.
  const pushRun = (conclusion) => [run(TIP, 'completed', conclusion, 10, '2026-11-20T11:49:00Z'), ...GREEN.slice(1)];
  const runsLater = bot({ world: { runs: pushRun('failure'), otherRuns: [run(TIP, 'in_progress', null, 10, '2026-11-20T11:55:00Z')] } });
  writeFileSync(join(runsLater.state, 'tip.json'), JSON.stringify({ sha: TIP, firstSeen: minutesAgo(31), passed: null }));
  assert.deepEqual(runsLater.call(), { outcome: 'redMain', reason: `the default branch is red at ${TIP}` });
  assert.equal(runsLater.read('tip.json').passed, null);
  const passedLater = bot({ world: { runs: pushRun('failure'), otherRuns: [run(TIP, 'completed', 'success', 10, '2026-11-20T11:55:00Z')] } });
  assert.deepEqual(passedLater.call(), { outcome: 'redMain', reason: `the default branch is red at ${TIP}` });
  assert.deepEqual([failed, runsLater, passedLater].flatMap((b) => merges(b.calls())), []);
  const replaced = bot({ world: { runs: pushRun('cancelled'), otherRuns: [run(TIP, 'completed', 'success', 10, '2026-11-20T11:55:00Z')] } });
  assert.equal(replaced.call().outcome, 'merged');
});

test('merge: a last passed tip that is no commit stops with an error', () => {
  const b = bot();
  writeFileSync(join(b.state, 'tip.json'), JSON.stringify({ sha: TIP, firstSeen: minutesAgo(11), passed: 'main?x=1' }));
  assert.deepEqual(b.call(), { outcome: 'stop', reason: 'tip.json holds no commit as the last passed tip', error: true });
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

test('merge: a trial verdict merges only while the default branch is the trial base', () => {
  const trial = { n: 3, oid: TRIAL_HEAD, branch: 'feat/3-trial', action: 'trial' };
  const moved = bot({ ...trial, fields: { trialBase: OTHER } });
  assert.deepEqual(moved.call(), { outcome: 'restart', reason: 'the default branch moved since the trial merge' });
  assert.deepEqual(merges(moved.calls()), []);
  assert.equal(bot({ ...trial, fields: { trialBase: TIP } }).call().outcome, 'merged');
});

test('merge: a fork, another base, a subject of more than one line, a missing body file or a review URL with whitespace stops for the owner', () => {
  const stops = [
    [bot({ world: { prs: { 1: { ...openPr(1, HEAD, 'feat/1-x'), isCrossRepository: true } } } }), 'the pull request comes from a fork'],
    [bot({ world: { prs: { 1: { ...openPr(1, HEAD, 'feat/1-x'), baseRefName: 'release' } } } }), "the pull request's base is not main"],
    [bot({ subject: 'feat: add x (#1)\nCloses #1\n' }), 'the subject file holds no single line'],
    [bot({ body: null }), 'no subject or body file: ENOENT'],
    [bot({ fields: { reviewUrl: 'https://github.com/acme/app/pull/1\n- forged line' } }), 'the state names no review URL without whitespace'],
  ];
  for (const [b, reason] of stops) {
    assert.deepEqual(b.call(), { outcome: 'stop', reason });
    assert.deepEqual(merges(b.calls()), []);
  }
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
    [JSON.stringify({ command: [] }), 'pre-merge.json names no program by its absolute path'],
    [JSON.stringify({ command: ['node', '-e', ''] }), 'pre-merge.json names no program by its absolute path'],
  ];
  for (const [config, reason] of refusals) {
    const b = bot({ files: { 'pre-merge.json': config } });
    assert.deepEqual(b.call(), { outcome: 'stop', reason });
    assert.deepEqual(merges(b.calls()), []);
  }

  // A hold written while the checks ran, here by the pre-merge command, wins over the state read at the start.
  const hold = bot();
  writeFileSync(join(hold.home, 'pre-merge.json'), JSON.stringify({ command: [process.execPath, '-e', 'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ ...JSON.parse(fs.readFileSync(process.argv[1], "utf8")), held: "owner asked to wait" }))', hold.file] }));
  assert.deepEqual(hold.call(), { outcome: 'stop', reason: 'held: owner asked to wait' });
  assert.deepEqual(merges(hold.calls()), []);
});

test('merge: the pre-merge command sees none of the bot variables, and an unreadable configuration, 100 commits or another accepted head written meanwhile refuses', () => {
  const seen = join(folder('cl-env-'), 'env.txt');
  const env = bot({ files: { 'pre-merge.json': JSON.stringify({ command: [process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1], String(process.env.FAKE_GH))', seen] }) } });
  assert.equal(env.call().outcome, 'merged');
  assert.equal(readFileSync(seen, 'utf8'), 'undefined');

  const unreadable = bot();
  mkdirSync(join(unreadable.home, 'pre-merge.json'));
  assert.deepEqual(unreadable.call(), { outcome: 'stop', reason: 'pre-merge.json is unreadable' });

  const commit = { messageHeadline: 'feat: add x', messageBody: '' };
  const long = bot({ world: { prs: { 1: { ...openPr(1, HEAD, 'feat/1-x'), commits: Array(100).fill(commit) } } }, files: { 'pre-merge.json': JSON.stringify({ command: [process.execPath, '-e', '0'] }) } });
  assert.deepEqual(long.call(), { outcome: 'stop', reason: 'the pull request has more commits than the pre-merge command is shown' });

  const accepted = bot();
  writeFileSync(join(accepted.home, 'pre-merge.json'), JSON.stringify({ command: [process.execPath, '-e', 'const fs = require("node:fs"); const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); fs.writeFileSync(process.argv[1], JSON.stringify({ ...s, handled: { ...s.handled, head: process.argv[2] } }))', accepted.file, OTHER] }));
  assert.deepEqual(accepted.call(), { outcome: 'restart', reason: 'the state changed during the checks' });
  assert.deepEqual([unreadable, long, accepted].flatMap((b) => merges(b.calls())), []);
});

test('merge: a merge GitHub does not confirm within two minutes, a failed command or auto-merge holds the pull request for the owner', () => {
  const open = bot({ world: { merge: 'open' } });
  assert.deepEqual(open.call(), { outcome: 'stop', reason: 'the merge is not confirmed' });
  assert.equal(open.read('pr-1.json').held, 'the merge is not confirmed');
  assert.equal(existsSync(join(open.state, 'merge-log.md')), false);

  const failed = bot({ world: { merge: 'fail' } });
  assert.deepEqual(failed.call(), { outcome: 'stop', reason: 'the merge is not confirmed: GraphQL: Head branch was modified' });

  const unreadable = bot({ world: { merge: 'unreadable' } });
  assert.deepEqual(unreadable.call(), { outcome: 'stop', reason: 'the merge is not confirmed: HTTP 502' });
  assert.equal(unreadable.read('pr-1.json').held, 'the merge is not confirmed: HTTP 502');

  const auto = bot({ world: { merge: 'auto' } });
  assert.deepEqual(auto.call(), { outcome: 'stop', reason: 'the merge command turned on auto-merge' });
  assert.deepEqual(merges(auto.calls()).at(-1), ['pr', 'merge', '1', '-R', REPO, '--disable-auto']);
});

test('merge: a state file unreadable after the command keeps its merge command time, a refused command whose read shows another head restarts while one that exited 0 holds, and a merged head nobody reviewed is logged and held', () => {
  const clobbered = bot({ world: { merge: 'fail', clobber: true } });
  assert.equal(clobbered.call().outcome, 'stop');
  assert.deepEqual([clobbered.read('pr-1.json').mergeCommandAt, clobbered.read('pr-1.json').held], ['2026-11-20T12:00:00.000Z', 'the merge is not confirmed: GraphQL: Head branch was modified']);

  const refused = bot({ world: { merge: 'fail', mergedHead: OTHER } });
  assert.deepEqual(refused.call(), { outcome: 'restart', reason: `the head moved to ${OTHER} and GitHub refused the merge: GraphQL: Head branch was modified` });
  const s = refused.read('pr-1.json');
  assert.deepEqual([s.mergeCommandAt, s.held], [undefined, undefined]);
  // A command that exited 0 may still merge: another head in the read holds the pull request instead.
  const accepted = bot({ world: { merge: 'open', mergedHead: OTHER } });
  assert.deepEqual(accepted.call(), { outcome: 'stop', reason: 'the merge is not confirmed' });
  const t = accepted.read('pr-1.json');
  assert.deepEqual([t.mergeCommandAt, t.held], ['2026-11-20T12:00:00.000Z', 'the merge is not confirmed']);

  const unreviewed = bot({ world: { mergedHead: OTHER } });
  assert.deepEqual(unreviewed.call(), { outcome: 'stop', reason: `a head nobody reviewed merged: ${OTHER}` });
  assert.equal(readFileSync(join(unreviewed.state, 'merge-log.md'), 'utf8'), `- 2026-11-20T12:00:30Z ${REPO} #1 reviewed ${HEAD} merged ${OTHER} commit ${MERGE_COMMIT} review https://github.com/${REPO}/pull/1#pullrequestreview-1 run run-1 unreviewed head\n`);
  assert.equal(unreviewed.read('pr-1.json').held, 'unreviewed head');
});

test('merge: an error stops with exit 1 after releasing the lock, and a bad argument or no run id exits 2', () => {
  const b = bot({ world: { tip: 'not a commit' } });
  assert.deepEqual(b.call(), { outcome: 'stop', reason: 'GitHub gave no commit for the default branch', error: true });
  for (const args of [['--run', 'run-1', '--method', 'fast'], [], ['--run', 'run 1']]) {
    const r = spawnSync(process.execPath, [SCRIPT, b.file, ...args], { encoding: 'utf8' });
    assert.deepEqual([r.status, JSON.parse(r.stdout).outcome], [2, 'stop']);
  }
});
