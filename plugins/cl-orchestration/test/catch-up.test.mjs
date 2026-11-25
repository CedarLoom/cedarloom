import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { catchUp } from '../skills/coordinate/catch-up.mjs';
import { sh } from '../skills/coordinate/policy.mjs';
import { fakeGh } from './fake-gh.mjs';

const gh = fakeGh(mkdtempSync(join(tmpdir(), 'cl-catch-up-gh-')));
// The fake answers as github.com: a caller's GH_HOST would refuse the origin.
delete process.env.GH_HOST;
process.env.PATH = `${gh.bin}${delimiter}${process.env.PATH}`;

const NOW = new Date('2026-11-20T12:00:00Z');
const ago = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();
const TIP = 'a'.repeat(40), HEAD = 'b'.repeat(40);
const GREEN = [{ status: 'COMPLETED', conclusion: 'SUCCESS' }];
const run = (conclusion, status = 'completed') => ({ databaseId: 1, headSha: TIP, status, conclusion, workflowDatabaseId: 7, createdAt: ago(30) });
// Pull request 9 on feat/5-x, issue 5 by the repository owner: a bot pull request.
const pr = (extra = {}) => ({ number: 9, headRefName: 'feat/5-x', headRefOid: HEAD, isCrossRepository: false, mergeable: 'MERGEABLE', statusCheckRollup: GREEN, ...extra });
const OWNER_ANSWER = { number: 3, labels: [], body: '', url: 'u', author: { login: 'owner' }, comments: [{ author: { login: 'owner' }, authorAssociation: 'OWNER', body: 'Owner answer (2026-11-20): Yes.', createdAt: ago(5) }] };

// The GitHub of acme/app: the tip's runs, the open needs-human issues and the open pull requests; skip leaves one read unanswered.
// recent: the open issues updated in the last 7 days, where an answer through the question queue took cl:needs-human off.
function github({ runs = [run('success')], asked = [], recent = [], prs = [], skip } = {}) {
  const answers = [
    [['repo', 'view', 'acme/app', '--json', 'defaultBranchRef'], { defaultBranchRef: { name: 'main' } }],
    [['api', 'repos/acme/app/branches/main'], { commit: { sha: TIP } }],
    [['run', 'list', '-R', 'acme/app', '--branch', 'main', '--commit', TIP, '--limit', '100', '--json', 'databaseId,headSha,status,conclusion,workflowDatabaseId,createdAt'], runs],
    [['issue', 'list', '-R', 'acme/app', '--label', 'cl:needs-human', '--state', 'open', '--limit', '1000', '--json', 'number,labels,comments,author,body,url'], asked],
    // The window of NOW, and of a run on the next day.
    ...['2026-11-13', '2026-11-14'].map((day) => [['issue', 'list', '-R', 'acme/app', '--search', `updated:>=${day}`, '--state', 'open', '--limit', '1000', '--json', 'number,labels,comments,author,body,url'], recent]),
    [['pr', 'list', '-R', 'acme/app', '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,headRefOid,isCrossRepository,mergeable,statusCheckRollup'], prs],
    [['api', 'repos/acme/app/issues/5'], { number: 5, author_association: 'OWNER', user: { login: 'owner' } }],
    [['api', 'repos/acme/app/issues/6'], { number: 6, author_association: 'OWNER', user: { login: 'owner' }, pull_request: { url: 'https://api.github.com/repos/acme/app/pulls/6' } }],
    [['api', 'repos/acme/app/issues/8'], { number: 8, author_association: 'NONE', user: { login: 'stranger' } }],
    ...['owner', 'stranger'].map((login) => [['api', `repos/acme/app/collaborators/${login}/permission`], { permission: login === 'owner' ? 'admin' : 'read' }]),
  ];
  gh.answer(answers.filter(([args]) => args[0] !== skip).map(([args, out]) => [args, JSON.stringify(out)]));
}

// git answers as a clone of acme/app whose default branch holds the policy file text, or none (the defaults: stallMinutes 20); gh runs the fake, and issue 77 does not exist.
const gitWith = (policy) => (cwd, cmd, args, timeout) => {
  if (args[1] === 'repos/acme/app/issues/77') throw Object.assign(new Error('Command failed: gh'), { stderr: 'gh: Not Found (HTTP 404)\n' });
  if (cmd !== 'git') return sh(cwd, cmd, args, timeout);
  const plain = args.filter((a, i) => a !== '-c' && args[i - 1] !== '-c');
  if (plain[0] === 'ls-remote') return `${'c'.repeat(40)}\tHEAD\n`;
  if (plain[0] === 'remote') return 'https://github.com/acme/app.git\n';
  if (plain[0] === 'ls-tree' && policy) return 'docs/agents/orchestration.json\n';
  if (plain[0] === 'show' && policy) return policy;
  return '';
};
const git = gitWith(null);

// A state folder with files { name: value } and today's counts; a catch-up run started today unless counts say otherwise.
function stateWith(files = {}, counts = { runs: 1, workerStarts: 0, catchUp: 1, prs: {} }) {
  const state = mkdtempSync(join(tmpdir(), 'cl-catch-up-'));
  if (counts) writeFileSync(join(state, 'counts-2026-11-20.json'), JSON.stringify(counts));
  for (const [name, value] of Object.entries(files)) writeFileSync(join(state, name), JSON.stringify(value));
  return state;
}
const CLONE = mkdtempSync(join(tmpdir(), 'cl-catch-up-clone-'));
const check = (state, { now = NOW, queue = () => [], run = git } = {}) => catchUp({ clone: CLONE, state, now, run, queue });
const holds = (condition, probe = false) => (r) => r.start === true && r.condition === condition && r.probe === probe;
const NOTHING = { start: false, condition: null, reason: 'nothing pending', probe: false };
const SPENT = { ...NOTHING, reason: 'nothing pending; at the daily limit of 12 runs: #9' };

test('catch-up: nothing pending starts no run', () => {
  github({ prs: [pr()] });
  assert.deepEqual(check(stateWith({ 'pr-9.json': { repo: 'acme/app', pr: 9, reviewedHead: HEAD, handled: { head: HEAD, action: 'update' } } })), NOTHING);
});

test('catch-up 1: a stale merge lock, or a merge command time without a merge log line, starts a run', () => {
  github();
  const locked = stateWith();
  mkdirSync(join(locked, 'lock'));
  writeFileSync(join(locked, 'lock', 'holder.json'), JSON.stringify({ pid: process.pid, start: null, pr: 9, head: HEAD, takenAt: ago(20) }));
  assert.deepEqual(check(locked), { start: true, condition: 1, reason: 'the merge lock is stale', probe: false });
  const merged = stateWith({ 'pr-9.json': { repo: 'acme/app', pr: 9, mergeCommandAt: ago(3) } });
  assert.deepEqual(check(merged), { start: true, condition: 1, reason: 'the merge of #9 is not confirmed', probe: false });
  writeFileSync(join(merged, 'merge-log.md'), `- ${ago(2)} acme/app #9 merged\n`);
  assert.deepEqual(check(merged), NOTHING);
  // The merge that holds a live lock confirms its own command; a held merge is the owner's to clear.
  const merging = stateWith({ 'pr-9.json': { repo: 'acme/app', pr: 9, mergeCommandAt: ago(0.2) } });
  mkdirSync(join(merging, 'lock'));
  writeFileSync(join(merging, 'lock', 'holder.json'), JSON.stringify({ pid: process.pid, start: null, pr: 9, head: HEAD, takenAt: ago(0.5) }));
  assert.deepEqual(check(merging), NOTHING);
  assert.deepEqual(check(stateWith({ 'pr-9.json': { repo: 'acme/app', pr: 9, mergeCommandAt: ago(600), held: 'the merge is not confirmed' } })), NOTHING);
});

test('catch-up 2: a red tip without a report for that tip starts a run', () => {
  github({ runs: [run('failure')] });
  assert.ok(holds(2)(check(stateWith())));
  assert.ok(holds(2)(check(stateWith({ 'red-main.json': { sha: 'd'.repeat(40), report: 'https://github.com/acme/app/issues/4' } }))));
  assert.deepEqual(check(stateWith({ 'red-main.json': { sha: TIP, report: 'https://github.com/acme/app/issues/4' } })), NOTHING);
});

test('catch-up 3: each owner answer not acted on starts a run, whether or not its label is off; a local one too', () => {
  const ANSWERED = { start: true, condition: 3, reason: '#3 has an answer', probe: false };
  // A plain comment keeps cl:needs-human; the question queue takes it off at once.
  github({ asked: [OWNER_ANSWER] });
  assert.deepEqual(check(stateWith()), ANSWERED);
  github({ recent: [OWNER_ANSWER] });
  assert.deepEqual(check(stateWith()), ANSWERED);
  // Without the label, a stranger's issue is no question, and a label alone answers none.
  github({ recent: [{ ...OWNER_ANSWER, author: { login: 'stranger' } }] });
  assert.deepEqual(check(stateWith()), NOTHING);
  github({ recent: [{ ...OWNER_ANSWER, body: '| Option | Impact |\n|---|---|\n| (a) Go | x |\n| (b) Hold | y |\n', comments: [{ ...OWNER_ANSWER.comments[0], body: 'a' }] }] });
  assert.deepEqual(check(stateWith()), NOTHING);
  // A repeated pass over an answer acted on starts none, in either form; a newer answer on that issue starts one.
  const acted = stateWith({ 'answered.json': [`#3 ${ago(5)}`] });
  github({ asked: [OWNER_ANSWER], recent: [OWNER_ANSWER] });
  assert.deepEqual(check(acted), NOTHING);
  github({ recent: [{ ...OWNER_ANSWER, comments: [...OWNER_ANSWER.comments, { ...OWNER_ANSWER.comments[0], body: 'Owner answer (2026-11-20): No.', createdAt: ago(1) }] }] });
  assert.deepEqual(check(acted), ANSWERED);
  // An answer without a time has no key: it is reported, never acted on at every pass.
  github({ asked: [{ ...OWNER_ANSWER, comments: [{ ...OWNER_ANSWER.comments[0], body: 'Owner answer (soon): Yes.', createdAt: undefined }] }] });
  assert.deepEqual(check(stateWith()), { start: true, condition: 'failed', reason: 'the answer on #3 has no time', probe: false });
  github({ asked: [{ ...OWNER_ANSWER, comments: [{ ...OWNER_ANSWER.comments[0], authorAssociation: 'NONE' }] }] });
  assert.deepEqual(check(stateWith()), NOTHING);
  const queue = () => [{ file: 'q1.md', status: 'answered', option: 'Yes', text: '', at: '2026-11-20' }, { file: 'q2.md', status: 'open' }];
  assert.ok(holds(3)(check(stateWith(), { queue })));
  assert.deepEqual(check(stateWith({ 'answered.json': ['q1.md 2026-11-20'] }), { queue }), NOTHING);
});

test('catch-up 4: a merge-ready pull request starts a run once the lock is free and the tip\'s watch ended', () => {
  const ready = { repo: 'acme/app', pr: 9, reviewedHead: HEAD, handled: { head: HEAD, action: 'merge' } };
  github({ prs: [pr()] });
  assert.ok(holds(4)(check(stateWith({ 'pr-9.json': ready, 'tip.json': { sha: TIP, firstSeen: ago(11) } }))));
  assert.ok(holds(4)(check(stateWith({ 'pr-9.json': { ...ready, handled: { head: HEAD, action: 'trial' } } }))));
  // The verdict must name the head, which needs a review; a merged pull request waits for nothing.
  assert.deepEqual(check(stateWith({ 'pr-9.json': { ...ready, handled: { head: 'e'.repeat(40), action: 'merge' } } })), NOTHING);
  assert.deepEqual(check(stateWith({ 'pr-9.json': { ...ready, reviewedHead: undefined } })), NOTHING);
  assert.deepEqual(check(stateWith({ 'pr-9.json': { ...ready, mergedAt: ago(1) } })), NOTHING);
  // A merge held for the owner pauses every merge, as merge.mjs does, also once it is logged.
  const paused = stateWith({ 'pr-9.json': ready, 'pr-8.json': { repo: 'acme/app', pr: 8, mergeCommandAt: ago(60), held: 'the merged head was not reviewed' } });
  writeFileSync(join(paused, 'merge-log.md'), `- ${ago(59)} acme/app #8 merged\n`);
  assert.deepEqual(check(paused), NOTHING);
  // The watch runs 10 minutes from the tip's first sight.
  assert.deepEqual(check(stateWith({ 'pr-9.json': ready, 'tip.json': { sha: TIP, firstSeen: ago(5) } })), NOTHING);
  const locked = stateWith({ 'pr-9.json': ready });
  mkdirSync(join(locked, 'lock'));
  writeFileSync(join(locked, 'lock', 'holder.json'), JSON.stringify({ pid: process.pid, start: null, pr: 8, head: TIP, takenAt: ago(1) }));
  assert.deepEqual(check(locked), NOTHING);
  github({ prs: [pr()], runs: [run(null, 'in_progress')] });
  assert.deepEqual(check(stateWith({ 'pr-9.json': ready })), NOTHING);
  // A red tip merges only the pull request the answered report names.
  github({ prs: [pr()], runs: [run('failure')] });
  assert.ok(holds(4)(check(stateWith({ 'pr-9.json': ready, 'red-main.json': { sha: TIP, report: 'r', pr: 9 } }))));
  assert.deepEqual(check(stateWith({ 'pr-9.json': ready, 'red-main.json': { sha: TIP, report: 'r', pr: 8 } })), NOTHING);
  // A report for the tip holds it red also where the tip's own runs are green: the watch found red on an earlier commit.
  github({ prs: [pr()] });
  assert.deepEqual(check(stateWith({ 'pr-9.json': ready, 'red-main.json': { sha: TIP, report: 'r' } })), NOTHING);
});

test('catch-up 5: a bot pull request whose head is red or in conflict and not handled starts a run', () => {
  github({ prs: [pr({ statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })] });
  assert.deepEqual(check(stateWith()), { start: true, condition: 5, reason: `#9 is red or in conflict at ${HEAD}`, probe: false });
  assert.deepEqual(check(stateWith({ 'pr-9.json': { repo: 'acme/app', pr: 9, handled: { head: HEAD, action: 'update' } } })), NOTHING);
  github({ prs: [pr({ mergeable: 'CONFLICTING', statusCheckRollup: [{ state: 'PENDING' }] })] });
  assert.ok(holds(5)(check(stateWith())));
  // A fork's pull request is no bot pull request.
  github({ prs: [pr({ mergeable: 'CONFLICTING', isCrossRepository: true })] });
  assert.deepEqual(check(stateWith()), NOTHING);
  // Nor is one whose branch names an issue that does not exist, a pull request, or an issue of an untrusted author.
  for (const headRefName of ['fix/77-typo', 'fix/6-x', 'fix/8-x']) {
    github({ prs: [pr({ mergeable: 'CONFLICTING', headRefName })] });
    assert.deepEqual(check(stateWith()), NOTHING);
  }
  // As gh pr checks reads them, only the newest run of a check counts: a failed run that ran again and passed is green.
  const ci = (conclusion, startedAt) => ({ __typename: 'CheckRun', name: 'test', workflowName: 'CI', status: 'COMPLETED', conclusion, startedAt });
  github({ prs: [pr({ statusCheckRollup: [ci('FAILURE', ago(20)), ci('SUCCESS', ago(10))] })] });
  assert.ok(holds(6)(check(stateWith())));
  github({ prs: [pr({ statusCheckRollup: [ci('SUCCESS', ago(20)), ci('FAILURE', ago(10))] })] });
  assert.ok(holds(5)(check(stateWith())));
});

test('catch-up 6: a green bot pull request without a review, verdict or recent claim for its head starts a run', () => {
  github({ prs: [pr()] });
  assert.deepEqual(check(stateWith()), { start: true, condition: 6, reason: `#9 has no review for ${HEAD}`, probe: false });
  assert.deepEqual(check(stateWith({ 'pr-9.json': { repo: 'acme/app', pr: 9, reviewedHead: HEAD } })), NOTHING);
  assert.deepEqual(check(stateWith({ 'pr-9.json': { repo: 'acme/app', pr: 9, handled: { head: HEAD, action: 'update' } } })), NOTHING);
  const claimed = stateWith(), claim = join(claimed, `claim-9-${HEAD}`);
  mkdirSync(claim);
  utimesSync(claim, new Date(ago(5)), new Date(ago(5)));
  assert.deepEqual(check(claimed), NOTHING);
  utimesSync(claim, new Date(ago(25)), new Date(ago(25)));
  assert.ok(holds(6)(check(claimed)));
  // A head without checks passes while merge.requiredChecks is empty, also where the tip has runs.
  github({ prs: [pr({ statusCheckRollup: [] })] });
  assert.ok(holds(6)(check(stateWith())));
  assert.deepEqual(check(stateWith(), { run: gitWith('{ "merge": { "requiredChecks": ["test"] } }') }), NOTHING);
  github({ prs: [pr({ statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }] })] });
  assert.deepEqual(check(stateWith()), NOTHING);
});

test('catch-up 7: a dispatch past the stall limit, or a headless job whose result nobody read, starts a run', () => {
  // Pull request 4 is open and no bot pull request, so conditions 5 and 6 pass it.
  github({ prs: [pr({ number: 4, headRefName: 'docs-edit' })] });
  const job = (entry) => stateWith({ 'pr-4.json': { repo: 'acme/app', pr: 4, dispatches: [entry] } });
  assert.deepEqual(check(job({ startedAt: ago(21) })), { start: true, condition: 7, reason: 'a dispatch or run of #4 has no result', probe: false });
  assert.deepEqual(check(job({ startedAt: ago(10) })), NOTHING);
  assert.deepEqual(check(job({ startedAt: ago(30), result: 'merged' })), NOTHING);
  const result = join(mkdtempSync(join(tmpdir(), 'cl-catch-up-job-')), 'result.json');
  writeFileSync(result, '{}');
  assert.ok(holds(7)(check(stateWith({ 'pr-4.json': { repo: 'acme/app', pr: 4, runs: [{ startedAt: ago(1), resultFile: result }] } }))));
  // A closed pull request's dispatch starts nothing.
  github();
  assert.deepEqual(check(job({ startedAt: ago(21) })), NOTHING);
});

test('catch-up: the first condition that holds names the run', () => {
  github({ runs: [run('failure')], asked: [OWNER_ANSWER], prs: [pr({ mergeable: 'CONFLICTING' })] });
  assert.ok(holds(2)(check(stateWith({ 'pr-4.json': { repo: 'acme/app', pr: 4, runs: [{ startedAt: ago(30) }] } }))));
  github({ asked: [OWNER_ANSWER], prs: [pr({ mergeable: 'CONFLICTING' })] });
  assert.ok(holds(3)(check(stateWith())));
  github({ prs: [pr({ mergeable: 'CONFLICTING' })] });
  assert.ok(holds(1)(check(stateWith({ 'pr-4.json': { repo: 'acme/app', pr: 4, mergeCommandAt: ago(1), runs: [{ startedAt: ago(30) }] } }))));
});

test('catch-up: a failed read starts a run that reports it', () => {
  github({ skip: 'pr' });
  assert.deepEqual(check(stateWith()), { start: true, condition: 'failed', reason: 'not faked: pr list -R acme/app --state open --limit 1000 --json number,headRefName,headRefOid,isCrossRepository,mergeable,statusCheckRollup', probe: false });
  github();
  assert.deepEqual(check(stateWith({ 'pr-9.json': 'cut' })), { start: true, condition: 'failed', reason: 'pr-9.json is unreadable', probe: false });
  const broken = stateWith({}, null);
  writeFileSync(join(broken, 'counts-2026-11-20.json'), '{ "runs": ');
  assert.deepEqual(check(broken), { start: true, condition: 'failed', reason: 'counts-2026-11-20.json is unreadable', probe: false });
  // A cut optional file is no missing one: the run reports it, also on a day that still needs the probe.
  const cut = stateWith({}, { runs: 1, workerStarts: 0, catchUp: 0, prs: {} });
  writeFileSync(join(cut, 'red-main.json'), '{ "sha": ');
  assert.deepEqual(check(cut), { start: true, condition: 'failed', reason: 'red-main.json is unreadable', probe: true });
});

test('catch-up: a precheck near its 90-second limit starts the run, which reports it', () => {
  github();
  let at = 0;
  // The first gh read takes 90 seconds: the next command would start past the limit.
  const slow = (cwd, cmd, args, timeout) => { if (cmd === 'gh') at += 90_000; return git(cwd, cmd, args, timeout); };
  assert.deepEqual(catchUp({ clone: CLONE, state: stateWith(), now: NOW, run: slow, queue: () => [], clock: () => at }), { start: true, condition: 'failed', reason: 'the 90-second limit nears', probe: false });
});

test('catch-up: a daily limit reached starts no run and says which', () => {
  github({ runs: [run('failure')] });
  assert.deepEqual(check(stateWith({}, { runs: 320, workerStarts: 0, catchUp: 1, prs: {} })), { start: false, condition: null, reason: 'the daily limit of 320 runs is reached', probe: false });
  assert.deepEqual(check(stateWith({}, { runs: 200, workerStarts: 120, catchUp: 1, prs: {} })), { start: false, condition: null, reason: 'the daily limit of 120 worker starts is reached', probe: false });
  assert.ok(holds(2)(check(stateWith({}, { runs: 319, workerStarts: 119, catchUp: 1, prs: {} }))));
});

test('catch-up: a pull request that had 12 runs today, or is held, starts none', () => {
  github({ prs: [pr()] });
  assert.deepEqual(check(stateWith({}, { runs: 12, workerStarts: 0, catchUp: 1, prs: { 9: 12 } })), SPENT);
  assert.ok(holds(6)(check(stateWith({}, { runs: 11, workerStarts: 0, catchUp: 1, prs: { 9: 11 } }))));
  assert.deepEqual(check(stateWith({ 'pr-9.json': { repo: 'acme/app', pr: 9, held: 'a question to the owner' } })), NOTHING);
  github();
  assert.deepEqual(check(stateWith({ 'pr-9.json': { repo: 'acme/app', pr: 9, mergeCommandAt: ago(1) } }, { runs: 12, workerStarts: 0, catchUp: 1, prs: { 9: 12 } })), SPENT);
});

test('catch-up: the counts start again at the UTC day\'s start, with the probe', () => {
  github();
  const state = stateWith({}, { runs: 320, workerStarts: 120, catchUp: 1, prs: { 9: 12 } });
  assert.equal(check(state, { now: new Date('2026-11-20T23:59:59Z') }).start, false);
  assert.deepEqual(check(state, { now: new Date('2026-11-21T00:00:01Z') }), { start: true, condition: 'probe', reason: 'no catch-up run started today', probe: true });
});

test('catch-up: while no catch-up run started today, the run starts and takes the probe', () => {
  github();
  assert.deepEqual(check(stateWith({}, null)), { start: true, condition: 'probe', reason: 'no catch-up run started today', probe: true });
  github({ runs: [run('failure')] });
  assert.ok(holds(2, true)(check(stateWith({}, { runs: 4, workerStarts: 1, catchUp: 0, prs: {} }))));
});

test('catch-up: the command line exits 0 to start a run and 1 to start none, with the JSON line', () => {
  const precheck = fileURLToPath(new URL('../skills/coordinate/precheck.mjs', import.meta.url));
  const state = mkdtempSync(join(tmpdir(), 'cl-catch-up-cli-'));
  // Today and tomorrow: the child may read its clock after UTC midnight.
  for (const at of [Date.now(), Date.now() + 86_400_000]) writeFileSync(join(state, `counts-${new Date(at).toISOString().slice(0, 10)}.json`), JSON.stringify({ runs: 320, workerStarts: 0, catchUp: 1, prs: {} }));
  const at = spawnSync(process.execPath, [precheck, '--catch-up', '/p', '--state', state], { encoding: 'utf8' });
  assert.equal(at.status, 1);
  assert.deepEqual(JSON.parse(at.stdout), { start: false, condition: null, reason: 'the daily limit of 320 runs is reached', probe: false });
  // --catch-up is read wherever it stands.
  const later = spawnSync(process.execPath, [precheck, '--state', state, '--catch-up', '/p'], { encoding: 'utf8' });
  assert.equal(later.status, 1);
  assert.deepEqual(JSON.parse(later.stdout), { start: false, condition: null, reason: 'the daily limit of 320 runs is reached', probe: false });
  const bad = spawnSync(process.execPath, [precheck, '--catch-up'], { encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.deepEqual(JSON.parse(bad.stdout), { start: true, condition: 'failed', reason: 'usage: node precheck.mjs --catch-up <clone> [--state <folder>]', probe: false });
});
