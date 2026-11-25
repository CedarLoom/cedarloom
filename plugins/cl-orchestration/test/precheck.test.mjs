import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { argsOf, check, distinct, lockToken, pickable, priorities, report, tryLock, unfinished, unlock, unread } from '../skills/coordinate/precheck.mjs';

const POLICY = { startLabel: 'agent-ready', trustedAuthors: ['helper[bot]'] };
const issue = (number, extra = {}) => ({ number, author_association: 'OWNER', user: { login: 'owner' }, labels: [{ name: 'agent-ready' }], ...extra });

test('precheck: picks labeled issues by trusted authors that have no open or merged pull request', () => {
  const issues = [
    issue(1),
    issue(2, { author_association: 'NONE', user: { login: 'stranger' } }),
    issue(3, { author_association: 'NONE', user: { login: 'helper[bot]' } }),
    issue(4, { labels: [{ name: 'other' }] }),
    issue(5, { pull_request: {} }),
    issue(6),
    // GitHub compares label names without case.
    issue(7, { labels: [{ name: 'Agent-Ready' }] }),
  ];
  assert.deepEqual(pickable(POLICY, issues, [{ headRefName: 'fix/6-crash' }, { headRefName: 'feat/16-x' }]), [1, 3, 7]);
  assert.deepEqual(pickable({}, issues, []), []);
  assert.deepEqual(pickable(null, issues, []), []);
});

test('precheck: an issue needs every issues.labels entry', () => {
  const policy = { startLabel: 'agent-ready', issues: { labels: ['project-a'] } };
  const issues = [issue(12, { labels: [{ name: 'agent-ready' }, { name: 'project-a' }] }), issue(14)];
  assert.deepEqual(pickable(policy, issues, []), [12]);
});

test('precheck: an issue that waits for the owner, that a worker holds or that the owner parked does not start, also once it carries the start label', () => {
  const issues = [issue(1), issue(2, { labels: [{ name: 'agent-ready' }, { name: 'CL:Needs-Human' }] }), issue(3, { labels: [{ name: 'cl:needs-human' }, { name: 'agent-ready' }] }), issue(4, { labels: [{ name: 'agent-ready' }, { name: 'cl:in-progress' }] }), issue(5, { labels: [{ name: 'agent-ready' }, { name: 'cl:deferred' }] })];
  assert.deepEqual(pickable(POLICY, issues, []), [1]);
});

test('precheck: the command line takes project paths and a prompts folder only, so an option of an old schedule fails instead of being read as a path', () => {
  assert.deepEqual(argsOf(['/a', '/b']), { dirs: ['/a', '/b'], prompts: undefined });
  assert.deepEqual(argsOf(['--prompts', '/home/prompts', '/a']), { dirs: ['/a'], prompts: '/home/prompts' });
  for (const argv of [['--extra=owner/project', '/a'], ['--issues-in', 'repo', '/a']]) assert.throws(() => argsOf(argv), /--extra|--issues-in/);
});

// A bot home with a prompts folder and a results folder; prompt(name, text) writes a prompt file, result(name, text) a result file, and each gives its path.
function home() {
  const dir = mkdtempSync(join(tmpdir(), 'cl-prompts-'));
  const prompts = join(dir, 'prompts'), results = join(dir, 'results');
  mkdirSync(prompts);
  mkdirSync(results);
  const write = (folder) => (name, text) => { writeFileSync(join(folder, name), text); return join(folder, name); };
  return { prompts, results, prompt: write(prompts), result: write(results) };
}
const RUN = '20261124T101500Z-a1b2c3-1.md';

test('precheck: a builder result of round 0 the pick sweep has not read is work', () => {
  const h = home();
  h.prompt(`project-12-builder-0-${RUN}`, `bot-builder.md\n\nResult file: ${join(h.results, `project-12-builder-0-${RUN}`)}\n`);
  h.result(`project-12-builder-0-${RUN}`, 'The plan.\n');
  assert.deepEqual(unread(h.prompts), [`project-12-builder-0-${RUN}: the builder result is unread`]);
  // The spec before the result line may quote such a line: the last one names the result file.
  h.prompt(`my-project-14-builder-0-${RUN}`, `bot-builder.md\nResult file: ${join(h.results, 'example.md')}\nResult file: ${join(h.results, 'w.md')}`);
  h.result('w.md', 'DONE\n');
  assert.deepEqual(unread(h.prompts), [`my-project-14-builder-0-${RUN}: the builder result is unread`, `project-12-builder-0-${RUN}: the builder result is unread`]);
});

test('precheck: a read result, a run without its result yet and a reviewer or later builder round result are no work', () => {
  const h = home();
  // Read: the pick sweep deleted the prompt file, and the result file stays.
  h.result(`project-12-builder-0-${RUN}`, 'DONE\n');
  h.prompt(`project-14-builder-0-${RUN}`, `Result file: ${join(h.results, 'pending.md')}\n`);
  // A reviewer's result and a builder's fix round are read through the state file.
  h.prompt(`project-15-reviewer-1-${RUN}`, `Result file: ${h.result('r.md', 'Head: c0ffee\n')}\n`);
  h.prompt(`project-15-builder-1-${RUN}`, `Result file: ${h.result('f.md', 'DONE\n')}\n`);
  // An empty result file is a write not done.
  h.prompt(`project-16-builder-0-${RUN}`, `Result file: ${h.result('empty.md', '')}\n`);
  h.prompt('.DS_Store', '');
  assert.deepEqual(unread(h.prompts), []);
});

test('precheck: a prompts folder, prompt or result file that cannot be checked counts as work and names why', () => {
  const h = home();
  assert.deepEqual(unread(join(h.prompts, 'none')), ['the folder does not exist']);
  h.prompt('notes.md', 'x');
  h.prompt(`project-1-builder-0-${RUN}`, 'bot-builder.md\n');
  h.prompt(`project-2-builder-0-${RUN}`, 'Result file: results/plan.md\n');
  h.prompt(`project-3-worker-1-${RUN}`, `Result file: ${h.result('w.md', 'DONE\n')}\n`);
  h.prompt(`project-4-builder-0-${RUN}`, `Result file: ${h.results}\n`);
  assert.deepEqual(unread(h.prompts), [
    'notes.md is no role bot prompt file',
    `project-1-builder-0-${RUN} names no absolute result file`,
    `project-2-builder-0-${RUN} names no absolute result file`,
    `project-3-worker-1-${RUN} is no role bot prompt file`,
    `project-4-builder-0-${RUN}: its result file is no file`,
  ]);
});

test('precheck: a file it cannot check counts only while it or its result file changed within the last hour, and an unread result at any age', () => {
  const h = home();
  const now = Date.now(), old = new Date(now - 61 * 60_000), recent = new Date(now - 59 * 60_000);
  const plan = h.prompt(`project-5-builder-0-${RUN}`, `Result file: ${h.result('plan.md', 'The plan.\n')}\n`);
  const noFile = h.prompt(`project-4-builder-0-${RUN}`, `Result file: ${h.results}\n`);
  for (const file of [h.prompt('notes.md', 'x'), plan, join(h.results, 'plan.md'), noFile]) utimesSync(file, old, old);
  utimesSync(h.prompt('todo.md', 'x'), recent, recent);
  utimesSync(h.results, recent, recent);
  const listed = [`project-5-builder-0-${RUN}: the builder result is unread`, 'todo.md is no role bot prompt file'];
  assert.deepEqual(unread(h.prompts, now), [`project-4-builder-0-${RUN}: its result file is no file`, ...listed]);
  utimesSync(h.results, old, old);
  assert.deepEqual(unread(h.prompts, now), listed);
});

test('precheck: an unread result exits 0 with no issue to pick and is named on stderr', () => {
  assert.deepEqual(report(['/a'], () => ({ tracker: 'owner/project', numbers: [] }), ['/home/prompts: p.md: the builder result is unread']), { out: [], err: ['/home/prompts: p.md: the builder result is unread'], code: 0 });
  const h = home();
  h.prompt(`project-12-builder-0-${RUN}`, `Result file: ${h.result('plan.md', 'The plan.\n')}\n`);
  // A project without a policy picks nothing: the exit is the result's.
  const script = fileURLToPath(new URL('../skills/coordinate/precheck.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script, '--prompts', h.prompts, join(h.prompts, 'missing')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '');
  assert.ok(run.stderr.split('\n').includes(`${h.prompts}: project-12-builder-0-${RUN}: the builder result is unread`), run.stderr);
});

test('precheck: two repositories share one role bot: each project bot reads only its own results, and the host limit counts the unfinished runs of both', () => {
  const alpha = home(), beta = home(), shared = home();
  const name = (repo, n, role) => `${repo}-${n}-${role}-0-${RUN}`;
  // Same issue number and run id in both repositories: the repository prefix keeps the shared bot's result files apart.
  alpha.prompt(name('alpha', 12, 'builder'), `Result file: ${join(shared.results, name('alpha', 12, 'builder'))}\n`);
  beta.prompt(name('beta', 12, 'builder'), `Result file: ${join(shared.results, name('beta', 12, 'builder'))}\n`);
  shared.result(name('beta', 12, 'builder'), 'The plan.\n');
  assert.deepEqual(unread(alpha.prompts), []);
  assert.deepEqual(unread(beta.prompts), [`${name('beta', 12, 'builder')}: the builder result is unread`]);
  assert.deepEqual(unfinished([alpha.prompts, beta.prompts]), [join(alpha.prompts, name('alpha', 12, 'builder'))]);

  const script = fileURLToPath(new URL('../skills/coordinate/precheck.mjs', import.meta.url));
  const limit = (limit, working) => spawnSync(process.execPath, [script, '--host-limit', limit, '--working', working, alpha.prompts, beta.prompts], { encoding: 'utf8' });
  assert.equal(limit('2', '0').status, 0);
  assert.equal(limit('2', '1').status, 1);
  // A reviewer run of the other repository, not started yet, fills the second slot.
  beta.prompt(name('beta', 14, 'reviewer'), `Result file: ${join(shared.results, name('beta', 14, 'reviewer'))}\n`);
  const full = limit('2', '0');
  assert.equal(full.status, 1);
  assert.deepEqual(full.stdout.trim().split('\n'), [join(alpha.prompts, name('alpha', 12, 'builder')), join(beta.prompts, name('beta', 14, 'reviewer'))]);
  assert.equal(limit('3', '0').status, 0);
  assert.equal(limit('two', '0').status, 2);
});

test('precheck: starts of two repositories at the same time for one free slot: exactly one reserves it', async () => {
  const script = fileURLToPath(new URL('../skills/coordinate/precheck.mjs', import.meta.url));
  for (let round = 0; round < 3; round++) {
    const alpha = home(), beta = home(), shared = home();
    const lock = join(shared.prompts, '..', 'host-limit.lock');
    alpha.prompt(`alpha-12-builder-0-${RUN}`, `Result file: ${join(shared.results, 'alpha-12.md')}\n`);
    const start = (repo, n) => new Promise((done) => spawn(process.execPath, [script, '--host-limit', '2', '--working', '0',
      '--reserve', join(repo === 'alpha' ? alpha.prompts : beta.prompts, `${repo}-${n}-builder-0-${RUN}`), '--result', join(shared.results, `${repo}-${n}.md`), '--lock', lock,
      alpha.prompts, beta.prompts]).on('exit', done));
    const codes = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => start(n % 2 ? 'alpha' : 'beta', n)));
    assert.deepEqual(codes.sort(), [0, 1, 1, 1, 1, 1], `round ${round}`);
    // The run that started and the one that reserved the slot; the refused starts left no file.
    assert.equal(readdirSync(alpha.prompts).length + readdirSync(beta.prompts).length, 2, `round ${round}`);
  }
});

const STALE = new Date('2026-01-01T00:00:00Z');

test('precheck: a host limit lock a dead run left is freed by one start, and a lock taken since stays its holder\'s', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-lock-')), lock = join(dir, 'host-limit.lock');
  const dead = lockToken(lock);
  assert.equal(tryLock(lock, dead, Date.now), true);
  utimesSync(join(lock, dead), STALE, STALE);
  const first = lockToken(lock), second = lockToken(lock);
  // The first try removes the dead run's stale token; the next try of another start takes the lock.
  assert.equal(tryLock(lock, first, Date.now), false);
  assert.equal(tryLock(lock, second, Date.now), true);
  // The start that saw the stale lock tries again: it waits, and the new holder keeps its lock.
  assert.equal(tryLock(lock, first, Date.now), false);
  assert.deepEqual(readdirSync(lock), [second]);
  unlock(lock, second);
  assert.equal(tryLock(lock, first, Date.now), true);
  unlock(lock, first);
  assert.deepEqual(readdirSync(dir), []);
});

test('precheck: a start whose host limit lock was freed as stale releases it without an error and leaves the next holder\'s lock', () => {
  const lock = join(mkdtempSync(join(tmpdir(), 'cl-lock-')), 'host-limit.lock');
  const slow = lockToken(lock);
  assert.equal(tryLock(lock, slow, Date.now), true);
  utimesSync(join(lock, slow), STALE, STALE);
  const next = lockToken(lock);
  assert.equal(tryLock(lock, next, Date.now), false);
  assert.equal(tryLock(lock, next, Date.now), true);
  unlock(lock, slow);
  assert.deepEqual(readdirSync(lock), [next]);
});

test('precheck: a start that waited for the host limit lock holds it for the stale age from its take', () => {
  const lock = join(mkdtempSync(join(tmpdir(), 'cl-lock-')), 'host-limit.lock');
  const after = (ms) => () => Date.now() + ms;
  const waited = lockToken(lock), next = lockToken(lock);
  // Taken 10 s after its token was made; 35 s after that token was made, the lock is 25 s old.
  assert.equal(tryLock(lock, waited, after(10_000)), true);
  assert.equal(tryLock(lock, next, after(35_000)), false);
  assert.deepEqual(readdirSync(lock), [waited]);
});

test('precheck: the host limit lock needs no bot home: its folder is made on first use and left empty', () => {
  const alpha = home(), folder = join(mkdtempSync(join(tmpdir(), 'cl-host-')), 'host-limit');
  const script = fileURLToPath(new URL('../skills/coordinate/precheck.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script, '--host-limit', '1', '--working', '0', '--reserve', join(alpha.prompts, `alpha-3-builder-0-${RUN}`),
    '--result', join(alpha.results, 'alpha-3.md'), '--lock', join(folder, 'host-limit.lock'), alpha.prompts], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readdirSync(alpha.prompts), [`alpha-3-builder-0-${RUN}`]);
  assert.deepEqual(readdirSync(folder), []);
});

test('precheck: an issue that several projects list starts in none of them', () => {
  const lists = [
    { dir: '/a', tracker: 'owner/tracker', numbers: [12, 14] },
    { dir: '/b', tracker: 'Owner/Tracker', numbers: [14, 15] },
    // The same number in another repository is another issue.
    { dir: '/c', tracker: 'owner/project', numbers: [12, 15] },
  ];
  assert.deepEqual(distinct(lists), {
    lists: [
      { dir: '/a', tracker: 'owner/tracker', numbers: [12] },
      { dir: '/b', tracker: 'Owner/Tracker', numbers: [15] },
      { dir: '/c', tracker: 'owner/project', numbers: [12, 15] },
    ],
    shared: [{ tracker: 'owner/tracker', number: 14, dirs: ['/a', '/b'] }],
  });
});

test('precheck: the command line prints no issue that several projects list, names the project that fails, and exits 0 only with an issue to pick', () => {
  const lists = { '/a': { tracker: 'owner/tracker', numbers: [14, 12] }, '/b': { tracker: 'owner/tracker', numbers: [14] } };
  // An Escape sequence in a folder name and a right-to-left override in a program's message would rewrite the terminal line.
  const odd = `/c${String.fromCodePoint(0x1b)}[2K`;
  const pick = (dir) => { if (!lists[dir]) throw new Error(`no ${String.fromCodePoint(0x202e)}policy\nsecond line`); return lists[dir]; };
  assert.deepEqual(report(['/a', '/b', odd], pick), { out: ['/a: #12'], err: ['/c?[2K: no ?policy', 'several projects: owner/tracker#14 (/a, /b)'], code: 0 });
  assert.deepEqual(report(['/b', '/a'], (dir) => ({ tracker: 'owner/tracker', numbers: lists[dir].numbers.filter((n) => n === 14) })), { out: [], err: ['several projects: owner/tracker#14 (/b, /a)'], code: 1 });
  assert.deepEqual(report(['/a'], () => ({ tracker: 'owner/project', numbers: [31, 7] })), { out: ['/a: #7 #31'], err: [], code: 0 });
  // A field the reader dropped is named, so a policy that changed meaning does not go quiet.
  assert.deepEqual(report(['/a'], () => ({ tracker: 'owner/project', numbers: [], warnings: [{ rule: 'refused', path: 'issues.repository', message: 'is refused' }] })), { out: [], err: ['/a: refused at issues.repository: is refused'], code: 1 });
});

test('precheck: prints the issues by Priority, Urgent to Low and then none, oldest first within a level, each with its level', () => {
  const priority = { 3: 'Low', 8: 'Urgent', 9: 'high', 12: 'Medium', 14: 'High', 15: 'Someday' };
  assert.deepEqual(report(['/a'], () => ({ tracker: 'owner/project', numbers: [15, 14, 12, 9, 8, 5, 3], priority })).out, ['/a: #8 (urgent) #9 (high) #14 (high) #12 (medium) #3 (low) #5 #15']);
});

test('precheck: reads the Priority field through GraphQL, and an issue without it or an API without issue fields has none', () => {
  const value = (field, name) => ({ name, field: { name: field } });
  const data = { i7: { number: 7, issueFieldValues: { nodes: [value('Effort', 'High'), value('Priority', 'Urgent')] } }, i8: { number: 8, issueFieldValues: { nodes: [value('Effort', 'Low'), {}] } }, i9: { number: 9, issueFieldValues: { nodes: [] } } };
  const asked = [];
  const exec = (cmd, args) => { asked.push(args); return JSON.stringify({ data: { repository: data } }); };
  assert.deepEqual(priorities('owner/project', [7, 8, 9], exec), { 7: 'Urgent' });
  assert.deepEqual(asked[0].slice(0, 2), ['api', 'graphql']);
  assert.deepEqual(asked[0].slice(-4), ['-f', 'owner=owner', '-f', 'name=project']);
  assert.deepEqual(priorities('owner/project', [], () => { throw new Error('not asked'); }), {});
  // execFileSync's message quotes the command, which names the issue fields; stderr holds gh's error alone.
  const fails = (stderr) => (cmd, args) => { throw Object.assign(new Error(`Command failed: ${cmd} ${args.join(' ')}\n${stderr}`), { stderr }); };
  assert.deepEqual(priorities('owner/project', [7], fails("gh: Field 'issueFieldValues' doesn't exist on type 'Issue'")), {});
  assert.throws(() => priorities('owner/project', [7], fails('gh: HTTP 502')), /HTTP 502/);
});

const calls = [];
const stub = (policy, origin = 'git@github.com:owner/project.git') => (dir, cmd, withSettings) => {
  calls.push([cmd, ...withSettings].join(' '));
  // The command without the -c settings the policy reader puts before it.
  const args = withSettings.filter((a, i) => a !== '-c' && withSettings[i - 1] !== '-c');
  if (args[0] === 'fetch') return '';
  if (args[0] === 'ls-remote') return 'c0ffee0000000000000000000000000000000001\tHEAD\n';
  if (args[0] === 'remote') return `${origin}\n`;
  if (args[0] === 'ls-tree') return policy ? 'cedarloom.json\n' : '';
  if (args[0] === 'show') return JSON.stringify(policy);
  if (args[0] === 'api' && args[1] === 'graphql') return JSON.stringify({ data: { repository: {} } });
  if (args[0] === 'api') return JSON.stringify([7, 8, 9, 10].map((n) => [issue(n)]));
  // 7: a closed pull request and an open one from a fork, which anyone can open; 8: an open one of the project; 9: a merged one from a fork; 10: a merged one.
  return JSON.stringify([
    { headRefName: 'feat/10-z', state: 'MERGED', isCrossRepository: false },
    { headRefName: 'feat/8-x', state: 'OPEN', isCrossRepository: false },
    { headRefName: 'feat/7-x', state: 'CLOSED', isCrossRepository: false },
    { headRefName: 'fix/7-x', state: 'OPEN', isCrossRepository: true },
    { headRefName: 'fix/9-y', state: 'MERGED', isCrossRepository: true },
  ]);
};

test('precheck: a policy that names another repository lists the project\'s own issues', () => {
  calls.length = 0;
  assert.deepEqual(check('/p', stub({ ...POLICY, issues: { repository: 'owner/other' } })), [7]);
  assert.ok(calls.includes('gh api --paginate --slurp repos/owner/project/issues?state=open&per_page=100&labels=agent-ready'));
  assert.ok(!calls.some((c) => c.includes('owner/other')));
});

test('precheck: reads the policy from the default branch, skips a project without one and names why the reader rejects one', () => {
  calls.length = 0;
  assert.deepEqual(check('/p', stub(POLICY)), [7]);
  assert.ok(calls.some((call) => call.endsWith(' show c0ffee0000000000000000000000000000000001:cedarloom.json')));
  // The issues and pull requests are origin's, whatever gh would resolve through an upstream remote or a set default.
  assert.ok(calls.includes('gh api --paginate --slurp repos/owner/project/issues?state=open&per_page=100&labels=agent-ready'));
  assert.ok(calls.includes('gh pr list -R owner/project --state all --limit 1000 --json headRefName,state,isCrossRepository'));
  calls.length = 0;
  assert.deepEqual(check('/p', stub(null)), []);
  assert.ok(!calls.some((c) => c.startsWith('gh')));
  assert.throws(() => check('/p', stub({ ...POLICY, merge: { mode: 'disjont' }, later: true })), /enum at merge\.mode: .+; unknown-key at later: /);
});

test('precheck: a member or collaborator counts only with write access to the repository, and a failed lookup starts nothing', () => {
  const by = (number, author_association, login) => issue(number, { author_association, user: { login } });
  // A managed user's login ends in _<shortcode>.
  const issues = [by(1, 'MEMBER', 'reader'), by(2, 'COLLABORATOR', 'reader'), by(3, 'MEMBER', 'writer'), by(4, 'COLLABORATOR', 'maintainer'), by(5, 'COLLABORATOR', 'admin'), by(6, 'OWNER', 'owner'), by(7, 'MEMBER', 'mona_acme')];
  // The REST API gives the maintain role as write.
  const roles = { reader: 'read', writer: 'write', maintainer: 'write', admin: 'admin', mona_acme: 'write' };
  const asked = [];
  const run = (fails) => (dir, cmd, args) => {
    if (args[0] !== 'api' || args[1] === 'graphql') return stub(POLICY)(dir, cmd, args);
    if (args[1] === '--paginate') return JSON.stringify([issues]);
    asked.push(args.join(' '));
    if (fails) throw new Error('HTTP 502');
    return JSON.stringify({ permission: roles[args[1].split('/')[4]] });
  };
  assert.deepEqual(check('/p', run(false), {}), [3, 4, 5, 6, 7]);
  assert.ok(asked.includes('api repos/owner/project/collaborators/reader/permission'));
  assert.throws(() => check('/p', run(true), {}), /HTTP 502/);
});

test('precheck: an origin on another host than gh\'s fails instead of listing the github.com repository of the same path', () => {
  for (const origin of ['https://gitlab.com/owner/project.git', 'git@gitlab.com:owner/project.git', 'ssh://git@gitlab.com:2222/owner/project']) {
    calls.length = 0;
    assert.throws(() => check('/p', stub(POLICY, origin), {}), { message: /^origin's URL names the host gitlab\.com, and gh asks github\.com:/ }, origin);
    assert.ok(!calls.some((c) => c.startsWith('gh')), origin);
  }
  // An ssh alias names no host, ssh.github.com is github.com's own, and GH_HOST names the host gh asks.
  assert.deepEqual(check('/p', stub(POLICY, 'work:owner/project'), {}), [7]);
  assert.deepEqual(check('/p', stub(POLICY, 'ssh://git@ssh.github.com:443/owner/project.git'), {}), [7]);
  assert.deepEqual(check('/p', stub(POLICY, 'https://gitlab.com/owner/project.git'), { GH_HOST: 'gitlab.com' }), [7]);
  assert.throws(() => check('/p', stub(POLICY), { GH_HOST: 'gitlab.com' }), { message: /^origin's URL names the host github\.com, and gh asks gitlab\.com:/ });
});

test('precheck: an origin whose host cannot be compared with gh\'s fails, and an ssh alias passes', () => {
  const fails = (origin, why) => {
    calls.length = 0;
    assert.throws(() => check('/p', stub(POLICY, origin), {}), why, origin);
    assert.ok(!calls.some((c) => c.startsWith('gh')), origin);
  };
  // A local path and a file: URL name no host: gh would list the github.com repository of the same path.
  for (const origin of ['/srv/git/owner/project.git', '../owner/project', 'file:///srv/git/owner/project.git', 'file://github.com/owner/project', 'C:/git/owner/project']) fails(origin, /local path/);
  // git and curl end the host at the #, so the fetch goes to evil.example.
  fails('https://evil.example#@github.com/owner/project', /evil\.example/);
  fails('https://evil.example?@github.com/owner/project', /evil\.example/);
  fails('https://evil.example@other.example@github.com/owner/project', /./);
  fails('git@github.com-work.evil.example:owner/project.git', /evil\.example/);
  // The error names the host and nothing of a credential.
  for (const origin of ['https://user:s3cret@gitlab.com/owner/project.git', 'https://user:s3@cret@gitlab.com/owner/project.git', 'https://user:s3/cret@gitlab.com/owner/project.git']) {
    fails(origin, (e) => !/s3|cret|user/.test(e.message));
  }
  // An alias of ~/.ssh/config: a name without a dot, or gh's host with a suffix, as in the accounts of one user.
  for (const origin of ['git@github.com-work:owner/project.git', 'github.com-work:owner/project', 'git@work:owner/project.git']) assert.deepEqual(check('/p', stub(POLICY, origin), {}), [7], origin);
});

test('precheck and policy: started through a symlinked folder they still run, so no project means exit 1, not a silent 0', () => {
  // Exit 0 means "there is an issue to pick" or "here is the policy": a guard that skipped the command line would start every scheduled run.
  const real = realpathSync(fileURLToPath(new URL('../skills/coordinate', import.meta.url)));
  const link = join(mkdtempSync(join(tmpdir(), 'cl-precheck-')), 'link');
  symlinkSync(real, link, 'dir');
  for (const dir of [real, link]) for (const script of ['precheck.mjs', 'policy.mjs']) assert.equal(spawnSync(process.execPath, [join(dir, script)]).status, 1, join(dir, script));
});

test('precheck: Pick leaves an issue while a question that names it waits for the owner', () => {
  const question = (comments, body = 'What: the export format\n\nIssue: owner/project#7\n', login = 'owner') => ({ number: 20, labels: [{ name: 'cl:needs-human' }], body, author: { login }, comments });
  const answered = [{ author: { login: 'owner' }, authorAssociation: 'OWNER', body: 'Owner answer (2026-11-20): a.', createdAt: '2026-11-20T10:00:00Z' }];
  const run = (asked) => (dir, cmd, args) => {
    if (args[0] === 'issue') return JSON.stringify(asked);
    if (args[1]?.endsWith('/permission')) return JSON.stringify({ permission: args[1].split('/')[4] === 'owner' ? 'admin' : 'read' });
    return stub(POLICY)(dir, cmd, args);
  };
  const none = () => [];
  assert.deepEqual(check('/p', run([question([])]), {}, none), []);
  // Anyone can open an issue with an Issue line: one without write access holds nothing.
  assert.deepEqual(check('/p', run([question([], undefined, 'stranger')]), {}, none), [7]);
  // A question filed under an App, as gh prints it, is a trustedAuthors login's.
  assert.deepEqual(check('/p', run([question([], undefined, 'app/helper')]), {}, none), []);
  // An Issue line in a comment or a code block names nothing; a question about another repository's #7 holds nothing.
  for (const quoted of ['<!--\nIssue: owner/project#7\n-->', '```\nIssue: owner/project#7\n```', '~~~~\nIssue: owner/project#7\n']) {
    assert.deepEqual(check('/p', run([question([], quoted)]), {}, none), [7], quoted);
  }
  // GitHub shows the Issue line below a code span that starts with three backticks or holds "<!--": the question names #7.
  for (const span of ['```gh issue list``` prints the author as app/slug.\nIssue: owner/project#7\n', 'A `<!--` starts a comment.\nIssue: owner/project#7\n']) {
    assert.deepEqual(check('/p', run([question([], span)]), {}, none), [], span);
  }
  assert.deepEqual(check('/p', run([question([], 'Issue: owner/other#7')]), {}, none), [7]);
  // An answer releases the issue only when it names one option row that is no Hold, by label, text or both; anything else holds it.
  const options = 'Issue: owner/project#7\n\n| Option | Impact |\n|---|---|\n| (a) Stream it (Recommended) | x |\n| (c) Hold | Nothing changes |\n';
  for (const said of ['a', 'Owner answer (2026-11-20): Stream it. Go.', 'Owner answer (2026-11-20): (a) Stream it (Recommended).']) {
    assert.deepEqual(check('/p', run([question([{ ...answered[0], body: said }], options)]), {}, none), [7], said);
  }
  for (const said of ['c', 'Owner answer (2026-11-20): (c) Hold. Later.', 'Owner answer (2026-11-20): Wait until the audit is done.']) {
    assert.deepEqual(check('/p', run([question([{ ...answered[0], body: said }], options)]), {}, none), [], said);
  }
  // An option that starts with a row's label but goes on to reject it names no row: the answer holds the issue.
  const node = 'Issue: owner/project#7\n\n| Option | Impact |\n|---|---|\n| (a) Upgrade to Node.js 24 (Recommended) | x |\n| (b) Hold | Nothing changes |\n';
  assert.deepEqual(check('/p', run([question([{ ...answered[0], body: 'Owner answer (2026-11-20): (a) is too risky. Wait for the audit.' }], node)]), {}, none), []);
  // Without option rows, no answer names one.
  assert.deepEqual(check('/p', run([question(answered)]), {}, none), []);
  // A local question holds it while open, deferred or held by its answer; a file that is no question starts nothing.
  const local = (status, held) => () => [{ file: 'project-1.md', status, issue: 'owner/project#7', held }];
  assert.deepEqual(check('/p', run([]), {}, local('open')), []);
  assert.deepEqual(check('/p', run([]), {}, local('deferred')), []);
  assert.deepEqual(check('/p', run([]), {}, local('answered', true)), []);
  assert.deepEqual(check('/p', run([]), {}, local('answered', false)), [7]);
  assert.throws(() => check('/p', run([]), {}, () => [{ file: 'project-1.md', error: 'cannot be read (EISDIR)' }]), /the question project-1\.md cannot be read/);
});
