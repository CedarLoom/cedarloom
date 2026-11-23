import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deleteBranch, hookFreeGit } from '../skills/coordinate/delete-branch.mjs';
import { gitProgram } from '../hooks/git-program.mjs';
import { fakeGh } from './fake-gh.mjs';
import { initRepo } from './git-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/coordinate/delete-branch.mjs', import.meta.url));
const BRANCH = 'feat/7-thing';
const VIEW = ['pr', 'view', '7', '-R', 'owner/project', '--json', 'state,headRefName,headRefOid,isCrossRepository'];
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
  const run = (policy, git = hookFreeGit(project)) => deleteBranch({ repo: 'owner/project', pr: 7, branch: BRANCH, policy, exec, git });
  const local = () => inProject('for-each-ref', '--format=%(objectname)', `refs/heads/${BRANCH}`);
  const merged = (sha = head, more = {}) => [VIEW, JSON.stringify({ state: 'MERGED', headRefName: BRANCH, headRefOid: sha, isCrossRepository: false, ...more })];
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

test('delete-branch: a hook the shared git directory defines does not run, through core.hooksPath or hook.<name>', () => {
  const s = setup();
  const mark = join(s.dir, 'MARK'), hooks = join(s.dir, 'hooks');
  mkdirSync(hooks);
  writeFileSync(join(hooks, 'reference-transaction'), `#!/bin/sh\necho hooksPath >> '${mark}'\n`, { mode: 0o755 });
  s.inProject('config', 'core.hooksPath', hooks);
  s.inProject('config', 'hook.mark.event', 'reference-transaction');
  s.inProject('config', 'hook.mark.command', `echo config >> '${mark}'`);
  s.gh.answer([s.merged(), s.remoteAt(s.head), [DELETE, '']]);
  assert.deepEqual(s.run(ON), { remote: 'deleted', local: 'deleted', reasons: [] });
  assert.equal(existsSync(mark), false);
  assert.equal(s.local(), '');
});

test('delete-branch: a hook whose name holds = keeps the local branch', () => {
  const s = setup();
  s.inProject('config', 'hook.a=b.command', 'true');
  s.gh.answer([s.merged(), s.remoteAt(s.head), [DELETE, '']]);
  assert.deepEqual(s.run(ON), { remote: 'deleted', local: 'kept', reasons: ['local: the branch could not be read: git config defines a hook whose name holds =, which -c cannot turn off'] });
  assert.equal(s.local(), s.head);
});

test('delete-branch: a promisor remote or partial clone filter of any remote name, origin included, keeps the local branch and runs no command, also one set after the runner was made', () => {
  for (const [name, key, value] of ['evil', 'origin'].flatMap((name) => [[name, `remote.${name}.promisor`, 'true'], [name, `remote.${name}.partialclonefilter`, 'blob:none'], [name, 'extensions.partialclone', name]])) {
    const s = setup();
    const git = hookFreeGit(s.project);
    const mark = join(s.dir, 'MARK');
    s.inProject('config', `remote.${name}.url`, join(s.dir, 'origin'));
    s.inProject('config', `remote.${name}.uploadpack`, `echo ran >> '${mark}'; git-upload-pack`);
    s.inProject('config', key, value);
    // The branch names a commit the object store never held, written by hand as git refuses to.
    const missing = 'd'.repeat(40);
    writeFileSync(join(s.project, '.git/refs/heads', BRANCH), `${missing}\n`);
    s.gh.answer([s.merged(missing), [REFS, '[]']]);
    assert.deepEqual(s.run(ON, git), { remote: 'gone', local: 'kept', reasons: ['local: the branch could not be read: git config names a promisor remote or a partial clone filter, whose lazy fetch can run a command'] }, `${name}: ${key}`);
    assert.equal(existsSync(mark), false, `${name}: ${key}`);
  }
});

test('delete-branch: a translated git message names no false removed commit', () => {
  const s = setup();
  // A git whose messages follow the locale unless LC_ALL is C, as with the zh_CN catalog.
  const program = join(s.dir, 'git');
  writeFileSync(program, `#!/bin/sh\n[ "$LC_ALL" = C ] && exec '${gitProgram()}' "$@"\nfor a in "$@"; do [ "$a" = -D ] && { '${gitProgram()}' "$@" > /dev/null && echo '\u5df2\u5220\u9664\u5206\u652f x\uff08\u66fe\u4e3a abc1234\uff09\u3002'; exit; }; done\nexec '${gitProgram()}' "$@"\n`, { mode: 0o755 });
  s.gh.answer([s.merged(), s.remoteAt(s.head), [DELETE, '']]);
  assert.deepEqual(s.run(ON, hookFreeGit(s.project, program)), { remote: 'deleted', local: 'deleted', reasons: [] });
});

test('delete-branch: a local branch that moved between the read and the delete exits 1, from the command line', () => {
  const s = setup();
  const bin = join(s.dir, 'wrapper');
  mkdirSync(bin);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = -D ] && '${gitProgram()}' -C '${s.project}' branch -f '${BRANCH}' main; done\nexec '${gitProgram()}' "$@"\n`, { mode: 0o755 });
  s.gh.answer([s.merged(), s.remoteAt(s.head), [DELETE, '']]);
  const done = spawnSync(process.execPath, [SCRIPT, '--repo', 'owner/project', '--pr', '7', '--branch', BRANCH, '--project', s.project], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${s.gh.bin}:${process.env.PATH}` } });
  assert.equal(done.status, 1, done.stderr);
  assert.deepEqual([JSON.parse(done.stdout).remote, JSON.parse(done.stdout).local], ['deleted', 'deleted']);
});

test('delete-branch: a failed remote delete keeps the remote branch', () => {
  const s = setup();
  s.gh.answer([s.merged(), s.remoteAt(s.head), [DELETE, '', 1]]);
  const result = s.run(ON);
  assert.deepEqual([result.remote, result.local], ['kept', 'deleted']);
  assert.match(result.reasons.join(), /^remote: the delete failed: /);
});

test('delete-branch: a pull request without a well-formed head commit, or from a fork, keeps both and deletes nothing', () => {
  const s = setup();
  for (const sha of ['abc', 'D'.repeat(40), null]) {
    s.gh.answer([s.merged(sha), [REFS, '[]'], [DELETE, '']]);
    assert.deepEqual(s.run(ON), { remote: 'kept', local: 'kept', reasons: ['pull request 7 names no head commit'] });
  }
  // A view without the field counts as a fork too.
  for (const isCrossRepository of [true, undefined]) {
    s.gh.answer([s.merged(s.head, { isCrossRepository }), s.remoteAt(s.head), [DELETE, '']]);
    assert.deepEqual(s.run(ON), { remote: 'kept', local: 'kept', reasons: ['pull request 7 comes from another repository'] });
  }
  assert.equal(deletes(s), 0);
  assert.equal(s.local(), s.head);
});

test('delete-branch: a local branch that moved between the read and the delete names the removed commit', () => {
  const s = setup();
  const git = hookFreeGit(s.project);
  s.gh.answer([s.merged(), s.remoteAt(s.head), [DELETE, '']]);
  const result = s.run(ON, (...a) => { if (a[0] === 'branch') s.inProject('branch', '-f', BRANCH, 'main'); return git(...a); });
  assert.deepEqual([result.remote, result.local], ['deleted', 'deleted']);
  assert.deepEqual(result.reasons, [`local: the deleted branch held another commit than ${s.head}: Deleted branch ${BRANCH} (was ${s.inProject('rev-parse', '--short', 'main')}).`]);
});

test('delete-branch: an unreadable policy is named with its cause, from the command line', () => {
  const s = setup('{ not json\n');
  const done = spawnSync(process.execPath, [SCRIPT, '--repo', 'owner/project', '--pr', '7', '--branch', BRANCH, '--project', s.project], { encoding: 'utf8', env: { ...process.env, PATH: `${s.gh.bin}:${process.env.PATH}` } });
  assert.equal(done.status, 1);
  assert.deepEqual(JSON.parse(done.stdout).reasons, ['the policy could not be read: bad-json: is not valid JSON']);
});
