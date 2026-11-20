import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commit, gitIn } from '../skills/coordinate/commit-push.mjs';
import { fakeGh } from './fake-gh.mjs';
import { initRepo } from './git-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/coordinate/commit-push.mjs', import.meta.url));
const BRANCH = 'feat/1-change';
const URL_1 = 'https://github.com/owner/project/pull/1';

// A project with a bare origin and a linked worktree w on a new branch at main, with src/a.txt staged and a commit message written.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'commit-push-'));
  const origin = join(dir, 'origin.git'), project = join(dir, 'project'), worktree = join(dir, 'w');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  mkdirSync(project);
  const git = initRepo(project);
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  git('worktree', 'add', '-q', '-b', BRANCH, worktree, 'main');
  const inW = (...a) => execFileSync('git', ['-C', worktree, ...a], { encoding: 'utf8' }).trim();
  mkdirSync(join(worktree, 'src'));
  writeFileSync(join(worktree, 'src/a.txt'), 'a\n');
  inW('add', 'src/a.txt');
  writeFileSync(join(dir, 'message.txt'), 'feat: add a\n');
  writeFileSync(join(dir, 'body.md'), 'feat: add a\n\nCloses #1\n');
  const base = inW('rev-parse', 'HEAD');
  const gh = fakeGh(dir);
  const compare = (sha, ref, status) => [['api', `repos/owner/project/compare/${sha}...${ref}`, '--jq', '.status'], `${status}\n`];
  const create = [['pr', 'create', '-R', 'owner/project', '--draft', '--base', 'main', '--head', BRANCH, '--title', 'Add a', '--body-file', join(dir, 'body.md')], `${URL_1}\n`];
  gh.answer([compare(base, 'main', 'identical'), create]);
  const admin = join(project, '.git/worktrees/w');
  const options = { project, worktree, repo: 'owner/project', branch: BRANCH, defaultBranch: 'main', message: join(dir, 'message.txt'), files: ['src/a.txt'], owned: ['src'] };
  const flags = ['--project', project, '--worktree', worktree, '--repo', 'owner/project', '--branch', BRANCH, '--default-branch', 'main', '--message', options.message, '--owned', 'src'];
  const run = (mode, ...more) => spawnSync(process.execPath, [SCRIPT, mode, ...more], { encoding: 'utf8', env: { ...process.env, PATH: `${gh.bin}:${process.env.PATH}` } });
  const pushed = () => execFileSync('git', ['-C', origin, 'for-each-ref', '--format=%(refname)', 'refs/heads/'], { encoding: 'utf8' }).trim().split('\n');
  return { dir, origin, project, worktree, admin, inW, base, gh, compare, create, options, flags, run, pushed, git };
}

const refused = (result, line) => {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr.trim().split('\n').length, 1);
  assert.match(result.stderr.trim(), line);
  assert.equal(result.stdout, '');
};

test('commit-push: commits the checked change, pushes that commit and opens the draft pull request', () => {
  const s = setup();
  const result = s.run('commit', ...s.flags, '--file', 'src/a.txt', '--title', 'Add a', '--body', join(s.dir, 'body.md'));
  assert.equal(result.status, 0, result.stderr);
  const { commit: sha, pullRequest } = JSON.parse(result.stdout);
  assert.equal(pullRequest, URL_1);
  assert.equal(execFileSync('git', ['-C', s.origin, 'rev-parse', `refs/heads/${BRANCH}`], { encoding: 'utf8' }).trim(), sha);
  assert.equal(execFileSync('git', ['-C', s.origin, 'rev-parse', `${sha}^`], { encoding: 'utf8' }).trim(), s.base);
  assert.equal(execFileSync('git', ['-C', s.origin, 'show', '--format=%B', '--no-patch', sha], { encoding: 'utf8' }), 'feat: add a\n\n');
  assert.deepEqual(s.gh.calls().map((args) => args[0]), ['api', 'pr']);
});

test('commit-push: a worktree whose commondir names another git directory is refused before any git command', () => {
  const s = setup();
  writeFileSync(join(s.admin, 'commondir'), '../../../other/.git\n');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^commondir: the worktree's commondir does not hold \.\.\/\.\.$/);
  assert.deepEqual(s.gh.calls(), []);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: a worktree with a config.worktree that holds settings is refused', () => {
  const s = setup();
  writeFileSync(join(s.admin, 'config.worktree'), '[core]\n\thooksPath = hooks\n');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^commondir: the worktree's config\.worktree is not empty$/);
  // An empty one passes: the Linux sandbox binds one while another worker's command runs.
  writeFileSync(join(s.admin, 'config.worktree'), '');
  assert.equal(s.run('commit', ...s.flags, '--file', 'src/a.txt').status, 0);
});

test('commit-push: a HEAD that origin does not hold is refused', () => {
  const s = setup();
  s.inW('commit', '-qm', 'worker commit');
  const head = s.inW('rev-parse', 'HEAD');
  writeFileSync(join(s.worktree, 'src/b.txt'), 'b\n');
  s.inW('add', 'src/b.txt');
  s.gh.answer([s.compare(head, 'main', 'diverged')]);
  refused(s.run('commit', ...s.flags, '--file', 'src/b.txt'), new RegExp(`^step 1: HEAD ${head} is no commit of origin's main$`));
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: a staged file the worker did not report is refused', () => {
  const s = setup();
  writeFileSync(join(s.worktree, 'src/extra.txt'), 'x\n');
  s.inW('add', 'src/extra.txt');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^step 2: the staged files src\/a\.txt, src\/extra\.txt are not the reported src\/a\.txt$/);
  assert.equal(s.inW('rev-parse', 'HEAD'), s.base);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: a path under .github/ is refused even when it is reported and owned', () => {
  const s = setup();
  mkdirSync(join(s.worktree, '.github/workflows'), { recursive: true });
  writeFileSync(join(s.worktree, '.github/workflows/ci.yml'), 'on: push\n');
  s.inW('add', '.github/workflows/ci.yml');
  refused(s.run('commit', ...s.flags, '--owned', '.github', '--file', 'src/a.txt', '--file', '.github/workflows/ci.yml'), /^step 2: \.github\/workflows\/ci\.yml is under \.github\/, which is the owner's$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: a commit with a second parent, from a MERGE_HEAD the worker wrote, is not pushed', () => {
  const s = setup();
  // A commit of the shared object store that origin does not hold.
  s.git('switch', '-q', '-c', 'side');
  writeFileSync(join(s.project, 'side.txt'), 's\n');
  s.git('add', 'side.txt');
  s.git('commit', '-qm', 'side');
  const side = s.git('rev-parse', 'HEAD').toString().trim();
  writeFileSync(join(s.admin, 'MERGE_HEAD'), `${side}\n`);
  // Without no-ff, git commit drops a HEAD that MERGE_HEAD descends from, which leaves one parent: refused as well.
  writeFileSync(join(s.admin, 'MERGE_MODE'), 'no-ff');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), new RegExp(`^step 3: commit [0-9a-f]{40} has the parents ${s.base} ${side}, not ${s.base}$`));
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: a commit whose files differ from the checked staged list is not pushed', () => {
  const s = setup();
  const real = gitIn(s.worktree);
  // The worker rewrites the commit right after git commit: same parent, one more file.
  const git = (...args) => {
    const out = real(...args);
    if (args[0] === 'commit') {
      writeFileSync(join(s.worktree, 'src/sneaked.txt'), 'x\n');
      s.inW('add', 'src/sneaked.txt');
      s.inW('commit', '-q', '--amend', '--no-edit');
    }
    return out;
  };
  const exec = (cmd, args) => execFileSync(join(s.gh.bin, 'gh'), args, { encoding: 'utf8' });
  assert.throws(() => commit(s.options, exec, git), (e) => e.step === 'step 3' && /^commit [0-9a-f]{40} changes src\/a\.txt, src\/sneaked\.txt, not the checked src\/a\.txt$/.test(e.message));
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: a merge round merges origin\'s default branch and commits the merge with both parents', () => {
  const s = setup();
  // origin's main moves on, and origin holds the worker's branch at the base.
  s.git('push', '-q', 'origin', `main:refs/heads/${BRANCH}`);
  writeFileSync(join(s.project, 'news.txt'), 'n\n');
  s.git('add', 'news.txt');
  s.git('commit', '-qm', 'news');
  s.git('push', '-q', 'origin', 'main');
  const main = s.git('rev-parse', 'main').toString().trim();
  // The worker stages its change after the merge started.
  s.inW('rm', '-q', '--cached', 'src/a.txt');
  const synced = s.run('sync', '--project', s.project, '--worktree', s.worktree, '--branch', 'main', '--merge');
  assert.equal(synced.status, 0, synced.stderr);
  assert.deepEqual(JSON.parse(synced.stdout), { merged: main, conflicts: false });
  s.inW('add', 'src/a.txt');
  s.gh.answer([s.compare(s.base, BRANCH, 'identical'), s.compare(main, 'main', 'identical')]);
  const result = s.run('commit', ...s.flags, '--file', 'src/a.txt', '--merged', main);
  assert.equal(result.status, 0, result.stderr);
  const { commit: sha } = JSON.parse(result.stdout);
  assert.equal(execFileSync('git', ['-C', s.origin, 'rev-parse', `refs/heads/${BRANCH}`], { encoding: 'utf8' }).trim(), sha);
  assert.equal(execFileSync('git', ['-C', s.origin, 'show', '--no-patch', '--format=%P', sha], { encoding: 'utf8' }).trim(), `${s.base} ${main}`);
});

test('commit-push: a supervised worker\'s commit is pushed when every file it publishes is owned, and refused otherwise', () => {
  const s = setup();
  s.inW('commit', '-qm', 'add a');
  writeFileSync(join(s.worktree, 'src/a.txt'), 'changed\n');
  writeFileSync(join(s.worktree, 'other.txt'), 'o\n');
  s.inW('add', 'src/a.txt', 'other.txt');
  s.inW('commit', '-qm', 'more');
  // A file one commit adds and a later one removes is published too.
  s.inW('rm', '-q', 'other.txt');
  s.inW('commit', '-qm', 'drop other');
  const head = s.inW('rev-parse', 'HEAD');
  const flags = ['--project', s.project, '--worktree', s.worktree, '--repo', 'owner/project', '--branch', BRANCH, '--default-branch', 'main', '--commit', head];
  refused(s.run('supervised', ...flags, '--owned', 'src'), /^supervised: other\.txt is in no owned path$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
  const result = s.run('supervised', ...flags, '--owned', 'src', '--owned', 'other.txt');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { commit: head, pullRequest: null });
  assert.equal(execFileSync('git', ['-C', s.origin, 'rev-parse', `refs/heads/${BRANCH}`], { encoding: 'utf8' }).trim(), head);
});
