import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { effective, read, sh, validate } from '../skills/coordinate/policy.mjs';
import { initRepo } from './git-repo.mjs';

const BUILT_IN = ['.github', 'CODEOWNERS', 'docs/CODEOWNERS', 'cedarloom.json', 'docs/agents/worker-rules.md', 'docs/agents', 'orca.yaml'];
const DEFAULTS = {
  startLabel: null,
  trustedAuthors: [],
  workersPerProject: 1,
  hostWorkerLimit: 2,
  stallMinutes: 20,
  merge: { allowed: false, requiredChecks: [], mode: 'strict', autoMergeMax: 'medium', additivePaths: [], ownerOnlyPaths: BUILT_IN, ownerOnlyNames: ['.cedarloom', '.claude', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', '.claude-plugin', '.codex', '.cursor', '.vscode', '.husky', '.githooks', '.pre-commit-config.yaml', '.devcontainer', '.devcontainer.json'] },
  closeIssue: false,
  deleteMergedBranch: false,
  issuesPerWorker: 1,
  keepRunning: false,
  mode: 'supervised',
  riskyPaths: [],
  review: { depth: 'high', sensitiveDepth: 'high', sensitivePaths: [] },
  issues: { labels: [] },
  minPlugin: null,
};
const rules = (errors) => errors.map((e) => [e.rule, e.path]);
// git as the reader runs it: the remote's default branch holds this policy file, or none (null).
const HEAD = 'c0ffee0000000000000000000000000000000001';
// The git command without the -c settings before it.
const bare = (fake, calls = []) => (dir, cmd, args) => { calls.push([cmd, ...args].join(' ')); return fake(dir, cmd, args.filter((a, i) => a !== '-c' && args[i - 1] !== '-c')); };
const remote = (file, calls = []) => bare((dir, cmd, args) => {
  if (args[0] === 'ls-remote') return `${HEAD}\tHEAD\n`;
  if (args[0] === 'ls-tree') return file == null ? '' : 'cedarloom.json\n';
  return args[0] === 'show' ? file : '';
}, calls);

test('policy: sh kills a command that outlives its timeout, also one that ignores SIGTERM', () => {
  const ignoring = 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 4000);';
  assert.throws(() => sh(tmpdir(), process.execPath, ['-e', ignoring], 1000), { code: 'ETIMEDOUT', signal: 'SIGKILL' });
});

test('policy: a file without schemaVersion, or of version 3, keeps its fields and gets every default', () => {
  assert.deepEqual(effective({}, '0.1.0'), { policy: DEFAULTS, errors: [], warnings: [] });
  const file = { schemaVersion: 3, startLabel: 'agent-ready', trustedAuthors: ['review-bot[bot]'], hostWorkerLimit: 3, merge: { allowed: true, requiredChecks: ['ci'] }, closeIssue: true };
  assert.deepEqual(effective(file, '0.1.0').policy, { ...DEFAULTS, startLabel: 'agent-ready', trustedAuthors: ['review-bot[bot]'], hostWorkerLimit: 3, merge: { ...DEFAULTS.merge, allowed: true, requiredChecks: ['ci'] }, closeIssue: true });
});

test('policy: a value the schema rejects gives no policy, not the default', () => {
  const { policy, errors } = effective({ schemaVersion: 3, merge: { mode: 'disjont' } }, '0.1.0');
  assert.equal(policy, null);
  assert.deepEqual(rules(errors), [['enum', 'merge.mode']]);
});

test('policy: the built-in owner-only paths stay first, whatever the file lists', () => {
  const paths = (ownerOnlyPaths) => effective({ schemaVersion: 3, merge: { ownerOnlyPaths } }, '0.1.0').policy.merge.ownerOnlyPaths;
  assert.deepEqual(paths([]), BUILT_IN);
  assert.deepEqual(paths(['infra', '.github']), [...BUILT_IN, 'infra']);
});

test('policy: a key the schema does not name gives no policy, a // comment key passes', () => {
  const misspelled = effective({ merge: { ownerOnlyPath: ['infra'] } }, '0.1.0');
  assert.equal(misspelled.policy, null);
  assert.deepEqual(rules(misspelled.errors), [['unknown-key', 'merge.ownerOnlyPath']]);
  const commented = effective({ '//': 'note', merge: { '//why': 'the owner merges', allowed: true } }, '0.1.0');
  assert.deepEqual(commented.errors, []);
  assert.deepEqual(commented.policy.merge, { ...DEFAULTS.merge, allowed: true });
});

for (const label of ['cl:plan', 'cl:needs-human', 'cl:deferred', 'cl:in-progress', 'cl:follow-up', 'cl:triage', 'CL:Triage']) test(`policy: a startLabel of ${label} is refused with the label named`, () => {
  const { policy, errors } = effective({ startLabel: label }, '0.1.0');
  assert.equal(policy, null);
  assert.deepEqual(rules(errors), [['refused', 'startLabel']]);
  assert.match(errors[0].message, new RegExp(`${label.toLowerCase()} is another CedarLoom label`));
});

test('policy: a startLabel of cl:ready-for-agent or a project label is valid', () => {
  for (const label of ['cl:ready-for-agent', 'agent-ready']) assert.equal(effective({ startLabel: label }, '0.1.0').policy.startLabel, label);
});

test('policy: a file that names another repository is refused and keeps the project repository', () => {
  const named = effective({ startLabel: 'go', issues: { repository: 'owner/tracker', labels: ['project-a'] } }, '0.1.0');
  assert.deepEqual(named.errors, []);
  assert.deepEqual(named.policy.issues, { labels: ['project-a'] });
  assert.deepEqual(rules(named.warnings), [['refused', 'issues.repository']]);
  assert.match(named.warnings[0].message, /names no other repository; the tracker is the project repository/);
  // An unknown key beside it is still named.
  assert.deepEqual(rules(effective({ issues: { repository: 'owner/tracker', extra: 'value' } }, '0.1.0').errors), [['unknown-key', 'issues.extra']]);
});

test('policy: mode is supervised unless the file sets automatic', () => {
  assert.equal(effective({}, '0.1.0').policy.mode, 'supervised');
  const automatic = effective({ mode: 'automatic' }, '0.1.0');
  assert.deepEqual(automatic.errors, []);
  assert.equal(automatic.policy.mode, 'automatic');
});

test('policy: a schemaVersion other than 3 gives no policy', () => {
  for (const schemaVersion of [2, 4]) {
    const { policy, errors } = effective({ schemaVersion }, '0.1.0');
    assert.equal(policy, null, schemaVersion);
    assert.deepEqual(rules(errors), [['enum', 'schemaVersion']], schemaVersion);
  }
});

test('policy: minPlugin newer than the plugin gives no policy, and versions compare by number', () => {
  const newer = effective({ minPlugin: '0.10.0' }, '0.9.0');
  assert.equal(newer.policy, null);
  assert.deepEqual(rules(newer.errors), [['range', 'minPlugin']]);
  assert.equal(effective({ minPlugin: '0.9.0' }, '0.9.0').policy.minPlugin, '0.9.0');
  assert.equal(effective({ minPlugin: '0.9.0' }, '0.10.0').policy.minPlugin, '0.9.0');
});

test('policy: the schema takes a models section of roles, tasks, depth and risk rows, and keeps implement and fix inline on opus', () => {
  assert.deepEqual(validate({ '//': ['a comment', 'in lines'], models: { '//': 'note', roles: { top: { model: 'fable', effort: 'high' } }, tasks: { review: 'top', implement: { model: 'opus', effort: 'medium' } }, depth: { quick: { plan: 'light' } }, risk: { critical: { review: { model: 'fable', effort: 'xhigh' } } } } }), []);
});

test('policy: a path entry that leaves the repository, starts at its root or holds a glob is rejected', () => {
  const { policy, errors } = effective({ schemaVersion: 3, merge: { ownerOnlyPaths: ['../x', '/x', 'a/*'] } }, '0.1.0');
  assert.equal(policy, null);
  assert.deepEqual(rules(errors), [['pattern', 'merge.ownerOnlyPaths[0]'], ['pattern', 'merge.ownerOnlyPaths[1]'], ['pattern', 'merge.ownerOnlyPaths[2]']]);
  // A folder with a closing slash, a file below a folder, names that start with dots and a name with a space inside are paths.
  const paths = ['schemas/', 'docs/registry.json', '..cache', '.claude', '.github/workflows', 'docs/release notes.md'];
  assert.deepEqual(effective({ merge: { additivePaths: paths } }, '0.1.0').policy.merge.additivePaths, paths);
});

const PATH_LISTS = [['merge', 'ownerOnlyPaths'], ['merge', 'additivePaths'], ['review', 'sensitivePaths']];
const NO_PATHS = ['', '/x', '../x', 'x/..', 'a/*', 'a\\b', './x', 'x//y', 'x/./y', ' x', 'x ', 'x /y', '.', 'x\ny', 'x\0y', 'infra\u200B', 'x\u00A0y', 'a\u202Eb'];
// One refused document per row, with the one rule and path named for it.
const REFUSED = [
  ...PATH_LISTS.flatMap(([group, list]) => NO_PATHS.map((path) => [{ [group]: { [list]: [path] } }, 'pattern', `${group}.${list}[0]`])),
  ...NO_PATHS.map((path) => [{ riskyPaths: [path] }, 'pattern', 'riskyPaths[0]']),
  [{ merge: { autoMergeMax: 'high' } }, 'enum', 'merge.autoMergeMax'],
  // The editor refuses what the reader drops.
  [{ issues: { repository: 'owner/tracker' } }, 'refused', 'issues.repository'],
  [{ issues: { tracker: 'owner/tracker' } }, 'unknown-key', 'issues.tracker'],
  [{ models: { roles: { deep: { model: 'some-model-20260101', effort: 'high' } } } }, 'enum', 'models.roles.deep.model'],
  [{ review: { depth: 'max' } }, 'enum', 'review.depth'],
  [{ review: { sensitiveDepth: 'max' } }, 'enum', 'review.sensitiveDepth'],
  [{ minPlugin: '0.1' }, 'pattern', 'minPlugin'],
  [{ minPlugin: 'v0.1.0' }, 'pattern', 'minPlugin'],
  [{ issuesPerWorker: 0 }, 'range', 'issuesPerWorker'],
  [{ issuesPerWorker: 17 }, 'range', 'issuesPerWorker'],
  [{ later: true }, 'unknown-key', 'later'],
  [{ mode: 'automatic', sandbox: { allowedDomains: ['registry.npmjs.org'] } }, 'refused', 'sandbox'],
  ...['auto', 'Automatic', 'bypassPermissions', ''].map((mode) => [{ mode }, 'enum', 'mode']),
  [{ models: { roles: { deep: { modle: 'opus', model: 'opus', effort: 'high' } } } }, 'unknown-key', 'models.roles.deep.modle'],
  [{ models: { roles: { deep: { model: 'opus' } } } }, 'required', 'models.roles.deep.effort'],
  [{ models: { roles: { Deep: { model: 'opus', effort: 'high' } } } }, 'unknown-key', 'models.roles.Deep'],
  [{ models: { tasks: { deploy: 'deep' } } }, 'unknown-key', 'models.tasks.deploy'],
  [{ models: { risk: { medium: {} } } }, 'unknown-key', 'models.risk.medium'],
  [{ models: { tasks: { review: 'Deep' } } }, 'any-of', 'models.tasks.review'],
  [{ models: { depth: { quick: { implement: { model: 'sonnet', effort: 'high' } } } } }, 'any-of', 'models.depth.quick.implement'],
  [{ models: { risk: { critical: { fix: { model: 'fable', effort: 'xhigh' } } } } }, 'any-of', 'models.risk.critical.fix'],
  // A key is shown without the characters that could rewrite a terminal line or cut the message.
  [{ 'later\u001B[2K\nmerge': true }, 'unknown-key', 'later?[2K?merge'],
];

test('policy: each refused value is named with its rule and path', () => {
  for (const [doc, rule, path] of REFUSED) {
    assert.deepEqual(rules(validate(doc)), [[rule, path]], JSON.stringify(doc));
  }
});

test('policy: a skill folder copied alone, as for an agent without plugins, checks with its own schema; minPlugin cannot be checked there and gives no policy', async () => {
  const copy = join(mkdtempSync(join(tmpdir(), 'cl-policy-')), 'skills', 'coordinate');
  cpSync(fileURLToPath(new URL('../skills/coordinate', import.meta.url)), copy, { recursive: true });
  const copied = await import(pathToFileURL(join(copy, 'policy.mjs')).href);
  assert.equal(copied.effective({ startLabel: 'go', merge: { mode: 'disjoint' } }).policy.merge.mode, 'disjoint');
  assert.deepEqual(rules(copied.effective({ merge: { mode: 'disjont' } }).errors), [['enum', 'merge.mode']]);
  const gated = copied.effective({ startLabel: 'go', minPlugin: '1.0.0' });
  assert.equal(gated.policy, null);
  assert.deepEqual(rules(gated.errors), [['range', 'minPlugin']]);
  // A schema that gains a keyword the check does not implement refuses every file, the valid ones too, instead of passing what the schema refuses.
  const schema = join(copy, 'cedarloom.schema.json');
  for (const edit of [(s) => { s.properties.trustedAuthors.maxItems = 1; }, (s) => { s.properties.merge.additionalProperties = true; }, (s) => { s.properties.startLabel.const = 'go'; }]) {
    const edited = JSON.parse(readFileSync(new URL('../skills/coordinate/cedarloom.schema.json', import.meta.url), 'utf8'));
    edit(edited);
    writeFileSync(schema, JSON.stringify(edited));
    assert.throws(() => copied.validate({ startLabel: 'go' }), /does not implement/);
  }
});

test('policy: minPlugin is checked against the version in the plugin manifest two folders above the skill', async () => {
  const plugin = mkdtempSync(join(tmpdir(), 'cl-policy-'));
  cpSync(fileURLToPath(new URL('../skills/coordinate', import.meta.url)), join(plugin, 'skills', 'coordinate'), { recursive: true });
  mkdirSync(join(plugin, '.claude-plugin'));
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), '{ "name": "cedarloom", "version": "2.3.0" }');
  const copied = await import(pathToFileURL(join(plugin, 'skills', 'coordinate', 'policy.mjs')).href);
  assert.equal(copied.effective({ startLabel: 'go', minPlugin: '2.3.0' }).policy.minPlugin, '2.3.0');
  assert.deepEqual(rules(copied.effective({ startLabel: 'go', minPlugin: '2.4.0' }).errors), [['range', 'minPlugin']]);
});

test('policy: the remote\'s HEAD is fetched into the reader\'s own ref and the file is read from the commit the remote names; no file means the defaults', () => {
  const calls = [];
  assert.equal(read('/p', remote('{ "startLabel": "go" }', calls)).policy.startLabel, 'go');
  // No name that the remote or the local origin/HEAD chooses is part of a command.
  // The calls after the config listing set again what the repository's config could make run instead of git.
  const pinned = 'git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c protocol.ext.allow=never -c core.sshCommand=ssh';
  assert.ok(calls.includes(`${pinned} ls-remote --upload-pack=git-upload-pack origin HEAD`));
  assert.ok(calls.some((call) => call.startsWith(`${pinned} fetch --upload-pack=git-upload-pack `) && call.endsWith(' origin +HEAD:refs/cedarloom/policy')));
  // The user's own ssh command stays: only the repository's is refused.
  const own = [];
  read('/p', bare((dir, cmd, args) => (args[0] === 'config' ? 'system\0core.sshcommand\nssh -4\0global\0core.sshcommand\nssh -i key\0' : remote('{}')(dir, cmd, args)), own));
  assert.ok(own.some((call) => call.endsWith(' -c core.sshCommand=ssh -i key ls-remote --upload-pack=git-upload-pack origin HEAD')));
  assert.ok(calls.includes(`${pinned} show ${HEAD}:cedarloom.json`));
  // In a partial clone of origin, the id of the file's object is read with the same settings.
  const partial = [];
  read('/p', bare((dir, cmd, args) => (args[0] === 'config' ? 'local\0remote.origin.promisor\ntrue\0' : remote('{}')(dir, cmd, args)), partial));
  assert.ok(partial.includes(`${pinned} rev-parse --verify ${HEAD}:cedarloom.json`));
  // A worker that moves the reader's ref after the fetch changes nothing: the read names the remote's commit, not the ref.
  const moved = read('/p', bare((dir, cmd, args) => {
    if (args[0] === 'ls-remote') return `${HEAD}\tHEAD\n`;
    if (args[0] === 'ls-tree') return 'cedarloom.json\n';
    if (args[0] === 'show') return args[1].startsWith(HEAD) ? '{ "startLabel": "go" }' : '{ "startLabel": "go", "merge": { "allowed": true } }';
    return '';
  }));
  assert.equal(moved.policy.merge.allowed, false);
  // A remote that names no commit as its HEAD gives no policy.
  assert.deepEqual(rules(read('/p', (dir, cmd, args) => (args[0] === 'ls-tree' ? 'cedarloom.json\n' : args[0] === 'show' ? '{ "merge": { "allowed": true } }' : '')).errors), [['unreadable', '']]);
  assert.deepEqual(read('/p', remote(null)), { policy: DEFAULTS, errors: [], warnings: [], commit: HEAD, absent: true });
});

test('policy: a fetch or a show that fails gives no policy: not the defaults, and not the file an older fetch left', () => {
  for (const failing of ['fetch', 'show']) {
    const { policy, errors } = read('/p', bare((dir, cmd, args) => {
      if (args[0] === failing) throw new Error(`fatal: the ${failing} failed`);
      if (args[0] === 'ls-remote') return `${HEAD}\tHEAD\n`;
      return args[0] === 'ls-tree' ? 'cedarloom.json\n' : '{ "startLabel": "go", "merge": { "allowed": true } }';
    }));
    assert.equal(policy, null, failing);
    assert.deepEqual(rules(errors), [['unreadable', '']], failing);
  }
});

test('policy: a file that is not JSON gives no policy', () => {
  const { policy, errors } = read('/p', remote('{ "startLabel": '));
  assert.equal(policy, null);
  assert.deepEqual(rules(errors), [['bad-json', '']]);
});

test('policy: a repository whose own git config redirects origin or runs a command gives no policy, and git starts nothing', () => {
  const repo = (text) => {
    const dir = mkdtempSync(join(tmpdir(), 'cl-policy-'));
    const git = initRepo(dir);
    writeFileSync(join(dir, 'cedarloom.json'), text);
    git('add', '-A');
    git('commit', '-qm', 'policy');
    return { dir, git };
  };
  const origin = repo('{ "startLabel": "go" }');
  const other = repo('{ "startLabel": "go", "trustedAuthors": ["someone"], "merge": { "allowed": true } }');
  const project = () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cl-policy-')), 'project');
    origin.git('clone', '-q', origin.dir, dir);
    return (...config) => { origin.git('-C', dir, 'config', ...config); return dir; };
  };
  assert.equal(read(project()('user.name', 't')).policy.merge.allowed, false);
  const marker = join(mkdtempSync(join(tmpdir(), 'cl-policy-')), 'ran');
  for (const config of [
    [`url.${other.dir}.insteadOf`, origin.dir],
    ['remote.origin.uploadpack', `touch '${marker}'; git-upload-pack`],
    ['core.sshCommand', `touch '${marker}'; ssh`],
    ['core.fsmonitor', `touch '${marker}'`],
    ['credential.helper', `!touch '${marker}'`],
    ['include.path', join(other.dir, '.git', 'config')],
  ]) {
    const { policy, errors } = read(project()(...config));
    assert.equal(policy, null, config[0]);
    assert.deepEqual(rules(errors), [['unreadable', '']], config[0]);
    // A rewrite base can hold a token: the message names no subsection.
    assert.ok(!errors[0].message.includes(other.dir), config[0]);
    assert.equal(existsSync(marker), false, config[0]);
  }
  // A promisor remote of any name could fetch a missing object through its command, on a git that ignores GIT_NO_LAZY_FETCH.
  for (const config of [['remote.evil.promisor', 'true'], ['remote.evil.partialclonefilter', 'blob:none'], ['extensions.partialclone', 'evil']]) {
    const set = project();
    set('remote.evil.url', origin.dir);
    set('remote.evil.uploadpack', `touch '${marker}'; git-upload-pack`);
    const { policy, errors } = read(set(...config));
    assert.equal(policy, null, config[0]);
    assert.deepEqual(rules(errors), [['unreadable', '']], config[0]);
    assert.equal(existsSync(marker), false, config[0]);
  }
  // Origin as the promisor is the blobless scratch clone, also when extensions.partialClone names it.
  assert.equal(read(project()('extensions.partialclone', 'origin')).policy.startLabel, 'go');
  // The user's config can name such a remote as well: the scope does not matter.
  const userConfig = join(mkdtempSync(join(tmpdir(), 'cl-policy-')), 'gitconfig');
  writeFileSync(userConfig, `[remote "evil"]\n\turl = ${origin.dir}\n\tpromisor = true\n`);
  assert.deepEqual(rules(read(project()('user.name', 't'), (dir, cmd, args) => sh(dir, cmd, args, undefined, { GIT_CONFIG_GLOBAL: userConfig })).errors), [['unreadable', '']]);
  // A promisor written after the check, and the policy file's object removed from the shared store: no lazy fetch runs the promisor's command.
  const late = project();
  late('remote.evil.url', origin.dir);
  const blob = origin.git('rev-parse', 'HEAD:cedarloom.json').toString().trim();
  rmSync(join(late('remote.evil.uploadpack', `touch '${marker}'; git-upload-pack`), '.git/objects', blob.slice(0, 2), blob.slice(2)));
  assert.equal(read(late('user.name', 't'), (dir, cmd, args) => { const out = sh(dir, cmd, args); if (args[0] === 'config') origin.git('-C', dir, 'config', 'remote.evil.promisor', 'true'); return out; }).policy, null);
  assert.equal(existsSync(marker), false, 'lazy fetch');
  // git's own file system monitor runs no command of the repository.
  assert.equal(read(project()('core.fsmonitor', 'true')).policy.startLabel, 'go');
  // The fetch writes the reader's ref, and no hook of the shared git directory runs for it. The repository's own core.hooksPath, which the check allows, also overrides one of the user's config.
  const hooks = mkdtempSync(join(tmpdir(), 'cl-policy-'));
  writeFileSync(join(hooks, 'reference-transaction'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  const hooked = project()('core.hooksPath', hooks);
  assert.equal(read(hooked).policy.startLabel, 'go');
  assert.equal(existsSync(marker), false, 'reference-transaction');
  // An ext:: remote is a command, which git runs only where the config allows it.
  const ext = project()('protocol.ext.allow', 'always');
  origin.git('-C', ext, 'remote', 'set-url', 'origin', `ext::sh -c touch% ${marker}`);
  assert.equal(read(ext).policy, null);
  assert.equal(existsSync(marker), false, 'ext');
  // A worker writes the config after the check and before the calls that reach the remote.
  const racing = (...config) => (dir, cmd, args) => { const out = sh(dir, cmd, args); if (args[0] === 'config') origin.git('-C', dir, 'config', ...config); return out; };
  const raced = project()('user.name', 't');
  assert.equal(read(raced, racing('remote.origin.uploadpack', `touch '${marker}'; git-upload-pack`)).policy.startLabel, 'go');
  assert.equal(existsSync(marker), false, 'remote.origin.uploadpack');
  // With GIT_SSH set, the user's ssh program still beats a core.sshCommand of the repository: git ranks any core.sshCommand above GIT_SSH. GIT_SSH_COMMAND outranks both, so the case clears it.
  const tools = join(mkdtempSync(join(tmpdir(), 'cl-policy-')), "it's tools");
  mkdirSync(tools);
  writeFileSync(join(tools, 'ssh'), '#!/bin/sh\ntouch "$(dirname "$0")/used"\nexit 1\n', { mode: 0o755 });
  const viaSsh = project()('user.name', 't');
  origin.git('-C', viaSsh, 'remote', 'set-url', 'origin', 'ssh://example.invalid/policy.git');
  const before = process.env.GIT_SSH, beforeCommand = process.env.GIT_SSH_COMMAND;
  process.env.GIT_SSH = join(tools, 'ssh');
  delete process.env.GIT_SSH_COMMAND;
  try { assert.equal(read(viaSsh, racing('core.sshCommand', `touch '${marker}'; ssh`)).policy, null); } finally {
    if (before === undefined) delete process.env.GIT_SSH; else process.env.GIT_SSH = before;
    if (beforeCommand !== undefined) process.env.GIT_SSH_COMMAND = beforeCommand;
  }
  assert.equal(existsSync(marker), false, 'core.sshCommand');
  assert.equal(existsSync(join(tools, 'used')), true, 'GIT_SSH');
});

test('policy: with origin as the promisor, a missing tree or file comes through the pinned settings: no hook and no upload-pack command of the shared git directory runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-policy-'));
  const origin = join(dir, 'origin'), marker = join(dir, 'ran');
  mkdirSync(origin);
  const git = initRepo(origin);
  const commit = (text) => { writeFileSync(join(origin, 'cedarloom.json'), text); git('add', '-A'); git('commit', '-qm', 'policy'); };
  commit('{ "startLabel": "go" }');
  // git serves a filter, and an object by its id, only where the remote allows it, as GitHub does.
  git('config', 'uploadpack.allowFilter', 'true');
  git('config', 'uploadpack.allowAnySHA1InWant', 'true');
  const hooked = (project) => {
    mkdirSync(join(project, '.git/hooks'), { recursive: true });
    writeFileSync(join(project, '.git/hooks/reference-transaction'), `#!/bin/sh\necho hook >> '${marker}'\n`, { mode: 0o755 });
    return project;
  };

  // A full clone that names origin a promisor with a tree filter: the fetch of origin's new commit leaves its tree out, and a git that ignores GIT_NO_LAZY_FETCH (here: the variable removed) fetches it from the local read.
  const full = join(dir, 'full');
  git('clone', '-q', origin, full);
  git('-C', full, 'config', 'remote.origin.promisor', 'true');
  git('-C', full, 'config', 'remote.origin.partialclonefilter', 'tree:0');
  commit('{ "startLabel": "next" }');
  assert.equal(read(hooked(full), (cwd, cmd, args) => sh(cwd, cmd, args, undefined, { GIT_NO_LAZY_FETCH: undefined })).policy.startLabel, 'next');
  assert.equal(existsSync(marker), false, 'lazy fetch of the tree');

  // A blobless clone: the reader fetches the file's object itself. An upload-pack command written after the check does not serve it, and no hook runs for it.
  const blobless = join(dir, 'blobless');
  git('clone', '-q', '--filter=blob:none', '--no-checkout', pathToFileURL(origin).href, blobless);
  const racing = (cwd, cmd, args) => { const out = sh(cwd, cmd, args); if (args[0] === 'config') git('-C', cwd, 'config', 'remote.origin.uploadpack', `echo upload-pack >> '${marker}'; git-upload-pack`); return out; };
  assert.equal(read(hooked(blobless), racing).policy.startLabel, 'next');
  assert.equal(existsSync(marker), false, 'fetch of the file');
});

test('policy: the command line prints the policy of the default branch and exits 0, or names each error and exits 1', () => {
  const origin = mkdtempSync(join(tmpdir(), 'cl-policy-'));
  const git = initRepo(origin);
  const commit = (text) => {
    mkdirSync(join(origin, 'docs'), { recursive: true });
    writeFileSync(join(origin, 'docs/index.md'), '');
    writeFileSync(join(origin, 'cedarloom.json'), text);
    git('add', '-A');
    git('commit', '-qm', 'policy');
  };
  commit('{ "merge": { "mode": "disjont" } }');
  const project = join(mkdtempSync(join(tmpdir(), 'cl-policy-')), 'project');
  git('clone', '-q', origin, project);
  const cli = (dir, env = {}) => spawnSync(process.execPath, [fileURLToPath(new URL('../skills/coordinate/policy.mjs', import.meta.url)), dir], { encoding: 'utf8', env: { ...process.env, ...env } });
  const rejected = cli(project);
  assert.deepEqual([rejected.status, rejected.stdout], [1, '']);
  assert.match(rejected.stderr, /^enum at merge\.mode: /);
  // The clone is older than the next commit: the reader fetches the default branch before it reads.
  commit('{ "startLabel": "go" }');
  const printed = cli(project);
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(JSON.parse(printed.stdout).startLabel, 'go');
  // A worker shares the git directory and moves the reader's ref to a commit of its own: the commit the reader printed still holds origin's file.
  const { commit: readCommit } = JSON.parse(printed.stdout);
  const show = (rev) => spawnSync('git', ['-C', project, 'show', `${rev}:cedarloom.json`], { encoding: 'utf8' }).stdout;
  writeFileSync(join(project, 'cedarloom.json'), '{ "startLabel": "worker" }');
  spawnSync('git', ['-C', project, '-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'worker']);
  spawnSync('git', ['-C', project, 'update-ref', 'refs/cedarloom/policy', 'HEAD']);
  assert.equal(show('refs/cedarloom/policy'), '{ "startLabel": "worker" }');
  assert.equal(show(readCommit), '{ "startLabel": "go" }');
  // A project path below the repository root reads the same file, not "no file" and with it the defaults.
  const below = cli(join(project, 'docs'));
  assert.equal(below.status, 0, below.stderr);
  assert.equal(JSON.parse(below.stdout).startLabel, 'go');
  // Not cloned (init, then remote add): there is no origin/HEAD, and the remote's HEAD is all the reader needs.
  const added = mkdtempSync(join(tmpdir(), 'cl-policy-'));
  git('init', '-q', '-b', 'other', added);
  git('-C', added, 'remote', 'add', 'origin', origin);
  const asked = cli(added);
  assert.equal(asked.status, 0, asked.stderr);
  assert.equal(JSON.parse(asked.stdout).startLabel, 'go');
  // Started from a hook, GIT_DIR names another repository (here origin, which has no remote): the project's policy is still the one read.
  const hooked = cli(project, { GIT_DIR: join(origin, '.git') });
  assert.equal(hooked.status, 0, hooked.stderr);
  assert.equal(JSON.parse(hooked.stdout).startLabel, 'go');
  // A worker shares the git directory: a replace ref that swaps the policy blob for a wider one changes nothing the reader prints.
  const blob = (...args) => spawnSync('git', ['-C', project, ...args], { encoding: 'utf8', input: '{ "startLabel": "go", "merge": { "allowed": true } }' }).stdout.trim();
  blob('replace', blob('rev-parse', 'refs/cedarloom/policy:cedarloom.json'), blob('hash-object', '-w', '--stdin'));
  const replaced = cli(project);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(JSON.parse(replaced.stdout).merge.allowed, false);
  // The owner moves the default branch: the clone's origin/HEAD still names main, the reader reads the remote's HEAD.
  git('checkout', '-q', '-b', 'next');
  commit('{ "startLabel": "next" }');
  const moved = cli(project);
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(JSON.parse(moved.stdout).startLabel, 'next');
});
