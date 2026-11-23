import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deleteBranch, hookFreeGit } from '../skills/coordinate/delete-branch.mjs';
import { fakeGh } from './fake-gh.mjs';
import { initRepo } from './git-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/coordinate/delete-branch.mjs', import.meta.url));
const BRANCH = 'feat/7-thing';
const VIEW = ['pr', 'view', '7', '-R', 'owner/project', '--json', 'state,headRefName,headRefOid'];
const REFS = ['api', `repos/owner/project/git/matching-refs/heads/${BRANCH}`];
const DELETE = ['api', '-X', 'DELETE', `repos/owner/project/git/refs/heads/${BRANCH}`];
const ON = { deleteMergedBranch: true };

// An origin whose default branch holds the policy, a clone of it as the project with the branch one commit ahead, and a fake gh.
function setup(policyText = '{ "deleteMergedBranch": true }\n') {
  const dir = mkdtempSync(join(tmpdir(), 'delete-branch-'));
  const origin = join(dir, 'origin'), project = join(dir, 'project');
  mkdirSync(origin);
  const git = initRepo(origin);
  mkdirSync(join(origin, 'docs/agents'), { recursive: true });
  writeFileSync(join(origin, 'docs/agents/orchestration.json'), policyText);
  git('add', '-A');
  git('commit', '-qm', 'policy');
  git('clone', '-q', origin, project);
  const inProject = (...a) => git('-C', project, ...a).toString().trim();
  inProject('switch', '-q', '-c', BRANCH);
  writeFileSync(join(project, 'thing.txt'), 'thing\n');
  inProject('add', 'thing.txt');
  inProject('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'thing');
  const head = inProject('rev-parse', 'HEAD');
  inProject('switch', '-q', 'main');
  const gh = fakeGh(dir);
  const exec = (cmd, args) => execFileSync(join(gh.bin, 'gh'), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const run = (policy) => deleteBranch({ repo: 'owner/project', pr: 7, branch: BRANCH, policy, exec, git: hookFreeGit(project) });
  const local = () => inProject('for-each-ref', '--format=%(objectname)', `refs/heads/${BRANCH}`);
  const merged = (sha = head) => [VIEW, JSON.stringify({ state: 'MERGED', headRefName: BRANCH, headRefOid: sha })];
  const remoteAt = (sha) => [REFS, JSON.stringify([{ ref: `refs/heads/${BRANCH}`, object: { sha } }, { ref: `refs/heads/${BRANCH}-2`, object: { sha: 'b'.repeat(40) } }])];
  return { dir, project, gh, head, run, local, inProject, merged, remoteAt };
}
const deletes = (s) => s.gh.calls().filter((c) => c.args.includes('DELETE')).length;

test('delete-branch: a merged pull request whose refs still point at its head loses both, from the command line', () => {
  const s = setup();
  s.gh.answer([s.merged(), s.remoteAt(s.head), [DELETE, '']]);
  const done = spawnSync(process.execPath, [SCRIPT, '--repo', 'owner/project', '--pr', '7', '--branch', BRANCH, '--project', s.project], { encoding: 'utf8', env: { ...process.env, PATH: `${s.gh.bin}:${process.env.PATH}` } });
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(JSON.parse(done.stdout), { remote: 'deleted', local: 'deleted', reasons: [] });
  assert.equal(deletes(s), 1);
  assert.equal(s.local(), '');
});

test('delete-branch: the policy off, or a policy that cannot be read, keeps both and asks GitHub nothing', () => {
  const s = setup('{ "deleteMergedBranch": false }\n');
  s.gh.answer([s.merged(), s.remoteAt(s.head), [DELETE, '']]);
  const done = spawnSync(process.execPath, [SCRIPT, '--repo', 'owner/project', '--pr', '7', '--branch', BRANCH, '--project', s.project], { encoding: 'utf8', env: { ...process.env, PATH: `${s.gh.bin}:${process.env.PATH}` } });
  assert.equal(done.status, 1);
  assert.deepEqual(JSON.parse(done.stdout), { remote: 'kept', local: 'kept', reasons: ["the policy's deleteMergedBranch is off"] });
  assert.deepEqual(s.run(null), { remote: 'kept', local: 'kept', reasons: ['the policy could not be read'] });
  assert.deepEqual(s.gh.calls(), []);
  assert.equal(s.local(), s.head);
});

test('delete-branch: a pull request that is not merged, or whose head is another branch, keeps both', () => {
  const s = setup();
  s.gh.answer([[VIEW, JSON.stringify({ state: 'OPEN', headRefName: BRANCH, headRefOid: s.head })], s.remoteAt(s.head), [DELETE, '']]);
  assert.deepEqual(s.run(ON), { remote: 'kept', local: 'kept', reasons: ['pull request 7 is OPEN, not MERGED'] });
  s.gh.answer([[VIEW, JSON.stringify({ state: 'MERGED', headRefName: 'feat/8-other', headRefOid: s.head })], s.remoteAt(s.head), [DELETE, '']]);
  assert.deepEqual(s.run(ON), { remote: 'kept', local: 'kept', reasons: [`the head branch of pull request 7 is feat/8-other, not ${BRANCH}`] });
  assert.equal(deletes(s), 0);
  assert.equal(s.local(), s.head);
});

test('delete-branch: a ref that moved past the merged head is kept, each side on its own', () => {
  const s = setup();
  const other = 'c'.repeat(40);
  s.gh.answer([s.merged(), s.remoteAt(other), [DELETE, '']]);
  assert.deepEqual(s.run(ON), { remote: 'kept', local: 'deleted', reasons: [`remote: the ref moved to ${other}`] });
  assert.equal(deletes(s), 0);
  // The local branch moves on: the pull request merged an older head.
  const s2 = setup();
  s2.inProject('branch', '-f', BRANCH, 'main');
  const moved = s2.local();
  s2.gh.answer([s2.merged(), s2.remoteAt(s2.head), [DELETE, '']]);
  assert.deepEqual(s2.run(ON), { remote: 'deleted', local: 'kept', reasons: [`local: the branch moved to ${moved}`] });
  assert.equal(s2.local(), moved);
});

test('delete-branch: a failed read keeps what it was to decide', () => {
  const s = setup();
  // No answer for the pull request.
  assert.deepEqual(s.run(ON), { remote: 'kept', local: 'kept', reasons: [`gh pr view failed: not faked: ${VIEW.join(' ')}`] });
  // The pull request reads, the remote ref does not.
  s.gh.answer([s.merged(), [REFS, '', 1]]);
  assert.deepEqual(s.run(ON).remote, 'kept');
  assert.equal(deletes(s), 0);
});

test('delete-branch: a branch checked out in a worktree is kept', () => {
  const s = setup();
  s.inProject('worktree', 'add', '-q', join(s.dir, 'wt'), BRANCH);
  s.gh.answer([s.merged(), s.remoteAt(s.head), [DELETE, '']]);
  const result = s.run(ON);
  assert.deepEqual([result.remote, result.local], ['deleted', 'kept']);
  assert.match(result.reasons[0], /^local: the delete failed: /);
  assert.equal(s.local(), s.head);
});

test('delete-branch: a branch that is a symbolic ref goes alone, and the branch it names stays', () => {
  const s = setup();
  s.inProject('branch', '-D', BRANCH);
  s.inProject('symbolic-ref', `refs/heads/${BRANCH}`, 'refs/heads/main');
  const main = s.inProject('rev-parse', 'refs/heads/main');
  s.gh.answer([s.merged(main), [REFS, '[]']]);
  assert.deepEqual(s.run(ON), { remote: 'gone', local: 'deleted', reasons: [] });
  assert.equal(s.inProject('rev-parse', 'refs/heads/main'), main);
});

test('delete-branch: refs already gone need nothing', () => {
  const s = setup();
  s.inProject('branch', '-D', BRANCH);
  s.gh.answer([s.merged(), [REFS, JSON.stringify([{ ref: `refs/heads/${BRANCH}-2`, object: { sha: s.head } }])]]);
  assert.deepEqual(s.run(ON), { remote: 'gone', local: 'gone', reasons: [] });
  assert.equal(deletes(s), 0);
});
