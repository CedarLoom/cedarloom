import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commit, gitIn, optionsOf, sync } from '../skills/coordinate/commit-push.mjs';
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
  const runWith = (env, mode, ...more) => spawnSync(process.execPath, [SCRIPT, mode, ...more], { encoding: 'utf8', env: { ...process.env, ...env, PATH: `${gh.bin}:${process.env.PATH}` } });
  const run = (mode, ...more) => runWith({}, mode, ...more);
  const pushed = () => execFileSync('git', ['-C', origin, 'for-each-ref', '--format=%(refname)', 'refs/heads/'], { encoding: 'utf8' }).trim().split('\n');
  return { dir, origin, project, worktree, admin, inW, base, gh, compare, create, options, flags, run, runWith, pushed, git };
}

// Origin's main moves on, origin holds the worker's branch at the base, and sync --merge starts the merge of main with src/a.txt staged after it. Returns main's sha.
function mergeRound(s) {
  s.git('push', '-q', 'origin', `main:refs/heads/${BRANCH}`);
  writeFileSync(join(s.project, 'news.txt'), 'n\n');
  s.git('add', 'news.txt');
  s.git('commit', '-qm', 'news');
  s.git('push', '-q', 'origin', 'main');
  const main = s.git('rev-parse', 'main').toString().trim();
  s.inW('rm', '-q', '--cached', 'src/a.txt');
  const synced = s.run('sync', '--project', s.project, '--worktree', s.worktree, '--branch', 'main', '--merge');
  assert.equal(synced.status, 0, synced.stderr);
  assert.deepEqual(JSON.parse(synced.stdout), { merged: main, conflicts: false });
  s.inW('add', 'src/a.txt');
  return main;
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
  // gh reads the git config of its working folder: the run folder, never the worktree.
  assert.deepEqual([...new Set(s.gh.calls().map((c) => c.cwd))], [realpathSync(s.dir)]);
});

test('commit-push: a worktree whose commondir names another git directory is refused before any git command', () => {
  const s = setup();
  writeFileSync(join(s.admin, 'commondir'), `${join(s.dir, 'other/.git')}\n`);
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^commondir: the worktree's commondir does not hold \.\.\/\.\.$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: a worktree with a config.worktree that holds settings is refused', () => {
  const s = setup();
  writeFileSync(join(s.admin, 'config.worktree'), '[core]\n\thooksPath = hooks\n');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^commondir: the worktree's config\.worktree is not empty$/);
  // An empty one passes: it holds no settings.
  writeFileSync(join(s.admin, 'config.worktree'), '');
  assert.equal(s.run('commit', ...s.flags, '--file', 'src/a.txt').status, 0);
});

test('commit-push: a setting of the shared git config that runs a command is refused', () => {
  const s = setup();
  s.git('config', 'filter.x.clean', 'touch ran');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^config: the repository's own git config sets filter\.\*\.clean, which can run a command or send the push elsewhere$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
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
  const main = mergeRound(s);
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

test('commit-push: a .git file whose .. passes a link is read where git opens it, not at a decoy', () => {
  const s = setup();
  writeFileSync(join(s.admin, 'commondir'), `${join(s.dir, 'other/.git')}\n`);
  // git follows s to the worktree's real folder before the ..; a lexical resolve lands on the decoy w in the worktree.
  symlinkSync(s.admin, join(s.worktree, 's'));
  mkdirSync(join(s.worktree, 'w'));
  writeFileSync(join(s.worktree, 'w/commondir'), '../..\n');
  writeFileSync(join(s.worktree, '.git'), 'gitdir: s/../w\n');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^commondir: the worktree's commondir does not hold \.\.\/\.\.$/);
});

test('commit-push: a commondir that is a link or a folder, or a commondir in the shared .git, is refused', () => {
  const s = setup();
  const file = join(s.admin, 'commondir');
  renameSync(file, `${file}.real`);
  symlinkSync(`${file}.real`, file);
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^commondir: .*\/commondir is not a regular file$/);
  renameSync(file, `${file}.link`);
  mkdirSync(file);
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^commondir: .*\/commondir is not a regular file$/);
  const t = setup();
  writeFileSync(join(t.project, '.git/commondir'), '.\n');
  refused(t.run('commit', ...t.flags, '--file', 'src/a.txt'), /^commondir: the shared \.git holds a commondir$/);
});

test('commit-push: no hook runs, neither one in the shared .git nor one the user\'s config defines', () => {
  const s = setup();
  const shared = join(s.dir, 'shared-hook-ran'), defined = join(s.dir, 'config-hook-ran');
  writeFileSync(join(s.project, '.git/hooks/pre-commit'), `#!/bin/sh\ntouch '${shared}'\n`, { mode: 0o755 });
  const user = join(s.dir, 'user.gitconfig');
  writeFileSync(user, `[hook "probe"]\n\tcommand = touch '${defined}'\n\tevent = pre-commit\n`);
  const result = s.runWith({ GIT_CONFIG_GLOBAL: user }, 'commit', ...s.flags, '--file', 'src/a.txt');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(shared), false);
  assert.equal(existsSync(defined), false);
});

test('commit-push: a hook whose name holds =, which -c cannot turn off, is refused before the commit', () => {
  const s = setup();
  const ran = join(s.dir, 'hook-ran');
  const user = join(s.dir, 'user.gitconfig');
  writeFileSync(user, `[hook "a=b"]\n\tcommand = touch '${ran}'\n\tevent = pre-commit\n`);
  refused(s.runWith({ GIT_CONFIG_GLOBAL: user }, 'commit', ...s.flags, '--file', 'src/a.txt'), /^config: git config defines a hook whose name holds =, which -c cannot turn off$/);
  assert.equal(existsSync(ran), false);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: an ext:: origin that the repository\'s config allows runs nothing', () => {
  const s = setup();
  const ran = join(s.dir, 'ext-ran');
  s.git('config', 'protocol.ext.allow', 'always');
  s.git('remote', 'set-url', 'origin', `ext::sh -c touch% ${ran}`);
  assert.equal(s.run('sync', '--project', s.project, '--worktree', s.worktree, '--branch', BRANCH).status, 1);
  assert.equal(existsSync(ran), false);
});

test('commit-push: a replace object the worker wrote does not hide a staged file', () => {
  const s = setup();
  // The base replaced by a commit whose tree already holds other.txt: with replacement, the staged diff shows src/a.txt alone.
  s.inW('rm', '-q', '--cached', 'src/a.txt');
  writeFileSync(join(s.worktree, 'other.txt'), 'o\n');
  s.inW('add', 'other.txt');
  const fake = s.inW('commit-tree', s.inW('write-tree'), '-m', 'fake');
  s.inW('replace', s.base, fake);
  s.inW('add', 'src/a.txt');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^step 2: other\.txt is in no owned path$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: a submodule commit outside the owned paths is refused, also when the worker\'s .gitmodules ignores it', () => {
  const s = setup();
  s.inW('update-index', '--add', '--cacheinfo', `160000,${s.base},vendor/lib`);
  writeFileSync(join(s.worktree, '.gitmodules'), '[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = https://example.com/lib.git\n\tignore = all\n');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^step 2: vendor\/lib is in no owned path$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: supervised refuses a submodule commit outside the owned paths, also when the worker\'s .gitmodules ignores it', () => {
  const s = setup();
  s.inW('update-index', '--add', '--cacheinfo', `160000,${s.base},vendor/lib`);
  s.inW('commit', '-qm', 'add a and lib');
  writeFileSync(join(s.worktree, '.gitmodules'), '[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = https://example.com/lib.git\n\tignore = all\n');
  const flags = ['--project', s.project, '--worktree', s.worktree, '--repo', 'owner/project', '--branch', BRANCH, '--default-branch', 'main', '--owned', 'src'];
  refused(s.run('supervised', ...flags, '--commit', s.inW('rev-parse', 'HEAD')), /^supervised: vendor\/lib is in no owned path$/);
  // Removed again by a later commit: the diff no longer shows it, the log does.
  s.inW('update-index', '--force-remove', 'vendor/lib');
  s.inW('commit', '-qm', 'drop lib');
  refused(s.run('supervised', ...flags, '--commit', s.inW('rev-parse', 'HEAD')), /^supervised: vendor\/lib is in no owned path$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: supervised refuses a submodule commit that a merge took back to the branch\'s side, also when the worker\'s .gitmodules ignores it', () => {
  const s = setup();
  const link = (sha) => { s.git('update-index', '--add', '--cacheinfo', `160000,${sha},vendor/lib`); s.git('commit', '-qm', 'lib'); };
  link(s.base);
  s.inW('merge', '-q', '--ff-only', 'main');
  s.inW('commit', '-qm', 'add a');
  // Main moves vendor/lib after the fork, and the branch's merge keeps its own side: the merge equals its first parent there, so log --cc omits the path and only the diff lists it.
  link(s.git('rev-parse', 'HEAD').toString().trim());
  s.git('push', '-q', 'origin', 'main');
  s.inW('merge', '-q', '--no-edit', '-s', 'ours', 'main');
  writeFileSync(join(s.worktree, '.gitmodules'), '[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = https://example.com/lib.git\n\tignore = all\n');
  const flags = ['--project', s.project, '--worktree', s.worktree, '--repo', 'owner/project', '--branch', BRANCH, '--default-branch', 'main', '--owned', 'src'];
  refused(s.run('supervised', ...flags, '--commit', s.inW('rev-parse', 'HEAD')), /^supervised: vendor\/lib is in no owned path$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: nothing staged is refused', () => {
  const s = setup();
  s.inW('rm', '-q', '--cached', 'src/a.txt');
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^step 2: nothing is staged$/);
});

test('commit-push: a CHERRY_PICK_HEAD, whose author git commit would take, is refused', () => {
  const s = setup();
  writeFileSync(join(s.admin, 'CHERRY_PICK_HEAD'), `${s.base}\n`);
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt'), /^step 2: a CHERRY_PICK_HEAD is set, whose author git commit would take$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: the push takes no tag along, whatever push.followTags says', () => {
  const s = setup();
  s.git('tag', '-a', 'v9.9.9', '-m', 'worker tag', s.base);
  s.git('config', 'push.followTags', 'true');
  assert.equal(s.run('commit', ...s.flags, '--file', 'src/a.txt').status, 0);
  assert.equal(execFileSync('git', ['-C', s.origin, 'for-each-ref', 'refs/tags/'], { encoding: 'utf8' }), '');
});

test('commit-push: the push takes the sha read after the commit, not a HEAD the worker moved since', () => {
  const s = setup();
  const real = gitIn(s.worktree);
  const git = (...args) => {
    const out = real(...args);
    if (args.includes('cat-file')) {
      writeFileSync(join(s.worktree, 'src/later.txt'), 'x\n');
      s.inW('add', 'src/later.txt');
      s.inW('commit', '-qm', 'later');
    }
    return out;
  };
  const exec = (cmd, args) => execFileSync(join(s.gh.bin, 'gh'), args, { encoding: 'utf8' });
  const { commit: sha } = commit(s.options, exec, git);
  assert.equal(execFileSync('git', ['-C', s.origin, 'rev-parse', `refs/heads/${BRANCH}`], { encoding: 'utf8' }).trim(), sha);
  assert.notEqual(s.inW('rev-parse', 'HEAD'), sha);
});

test('commit-push: sync refuses a MERGE_HEAD other than the sha it merged', () => {
  const s = setup();
  s.git('commit', '-q', '--allow-empty', '-m', 'news');
  s.git('push', '-q', 'origin', 'main');
  const main = s.git('rev-parse', 'main').toString().trim();
  s.inW('rm', '-q', '--cached', 'src/a.txt');
  const real = gitIn(s.worktree);
  const git = (...args) => {
    const out = real(...args);
    if (args.includes('merge') && args.includes('--no-commit')) writeFileSync(join(s.admin, 'MERGE_HEAD'), `${s.base}\n`);
    return out;
  };
  assert.throws(() => sync({ project: s.project, worktree: s.worktree, branch: 'main', merge: true }, git), (e) => e.step === 'step 5' && e.message === `MERGE_HEAD is ${s.base}, not the merged ${main}`);
});

test('commit-push: a merge round refuses a MERGE_HEAD other than --merged, and a merged sha that origin\'s default branch does not hold', () => {
  const s = setup();
  const main = mergeRound(s);
  s.gh.answer([s.compare(s.base, BRANCH, 'identical'), s.compare(main, 'main', 'diverged')]);
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt', '--merged', main), new RegExp(`^step 1: the merged ${main} is no commit of origin's main$`));
  writeFileSync(join(s.admin, 'MERGE_HEAD'), `${s.base}\n`);
  refused(s.run('commit', ...s.flags, '--file', 'src/a.txt', '--merged', main), new RegExp(`^step 1: MERGE_HEAD is ${s.base}, not the merged ${main}$`));
  assert.equal(execFileSync('git', ['-C', s.origin, 'rev-parse', `refs/heads/${BRANCH}`], { encoding: 'utf8' }).trim(), s.base);
});

test('commit-push: supervised refuses a branch that is not the reported commit, and a file only a merge\'s resolution added', () => {
  const s = setup();
  s.inW('commit', '-qm', 'add a');
  const head = s.inW('rev-parse', 'HEAD');
  const flags = ['--project', s.project, '--worktree', s.worktree, '--repo', 'owner/project', '--branch', BRANCH, '--default-branch', 'main', '--owned', 'src'];
  refused(s.run('supervised', ...flags, '--commit', s.base), new RegExp(`^supervised: refs/heads/${BRANCH} is ${head}, not the reported ${s.base}$`));
  // One merge adds evil.txt in its resolution, a second drops it in its own: only log --cc of the first shows it.
  const merge = (side, file, resolve) => {
    s.inW('switch', '-q', '-c', side, s.base);
    mkdirSync(join(s.worktree, 'src'));
    writeFileSync(join(s.worktree, file), 's\n');
    s.inW('add', file);
    s.inW('commit', '-qm', side);
    s.inW('switch', '-q', BRANCH);
    s.inW('merge', '-q', '--no-ff', '--no-commit', side);
    resolve();
    s.inW('commit', '-qm', `merge ${side}`);
  };
  merge('side1', 'src/s.txt', () => { writeFileSync(join(s.worktree, 'evil.txt'), 'e\n'); s.inW('add', 'evil.txt'); });
  merge('side2', 'src/t.txt', () => s.inW('rm', '-q', 'evil.txt'));
  refused(s.run('supervised', ...flags, '--commit', s.inW('rev-parse', 'HEAD')), /^supervised: evil\.txt is in no owned path$/);
  assert.deepEqual(s.pushed(), ['refs/heads/main']);
});

test('commit-push: options that are relative paths, no plain branch name or the default branch as --branch are refused', () => {
  const sha = 'a'.repeat(40);
  const flags = (branch, project = '/p', worktree = '/w') => ['supervised', '--project', project, '--worktree', worktree, '--repo', 'o/r', '--branch', branch, '--default-branch', 'main', '--commit', sha, '--owned', 'src'];
  assert.equal(optionsOf(flags('feat/1')).mode, 'supervised');
  const usage = (argv, message) => assert.throws(() => optionsOf(argv), (e) => e.step === 'usage' && e.message === message);
  usage(flags('feat/1', 'p'), '--project must be an absolute path');
  usage(flags('a..b'), '--branch is no plain branch name');
  usage(flags('main'), '--branch is the default branch main, which supervised never pushes to');
  // The folders of --message and --body are resolved, so they and the worktree exist here.
  const dir = mkdtempSync(join(tmpdir(), 'commit-push-'));
  const w = join(dir, 'w');
  mkdirSync(join(w, 'sub'), { recursive: true });
  const commitFlags = (branch, message) => ['commit', '--project', '/p', '--worktree', w, '--repo', 'o/r', '--branch', branch, '--default-branch', 'main', '--message', message, '--file', 'a', '--owned', 'src'];
  usage(commitFlags('main', join(dir, 'm')), '--branch is the default branch main, which commit never pushes to');
  // gh runs in the folder of --body, else --message: never the worktree, also when a link names it.
  usage(commitFlags('feat/1', join(w, 'm')), '--message is under --worktree');
  symlinkSync(w, join(dir, 'link'));
  usage(commitFlags('feat/1', join(dir, 'link/m')), '--message is under --worktree');
  usage([...flags('feat/1', '/p', w), '--title', 't', '--body', join(w, 'sub/b.md')], '--body is under --worktree');
});
