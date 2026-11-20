import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { reconcile } from '../skills/coordinate/reconcile.mjs';
import { fakeGh } from './fake-gh.mjs';
import { initRepo } from './git-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/coordinate/reconcile.mjs', import.meta.url));
// SHA-256 of the fixtures: the rulesets output [] and the settings file {}\n.
const RULESETS = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
const SETTINGS = 'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356';
const OID5 = '5'.repeat(40), OID6 = '6'.repeat(40);
const TAGS = [['api', 'repos/owner/project/tags', '--paginate', '--jq', '.[].name'], 'v1.0.0\n'];
const RULES = [['api', 'repos/owner/project/rulesets', '--paginate'], '[]'];
const merged = (prs) => [['pr', 'list', '-R', 'owner/project', '--state', 'merged', '--base', 'main', '--search', 'merged:>=2026-11-19', '--limit', '100', '--json', 'number,mergeCommit,mergedAt,mergedBy'], JSON.stringify(prs)];
const PR5 = { number: 5, mergeCommit: { oid: OID5 }, mergedAt: '2026-11-19T09:00:00Z', mergedBy: { login: 'owner' } };

// A project, a merge log with its baseline taken on 2026-11-19 and one logged merge, #5.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-'));
  const project = join(dir, 'project');
  mkdirSync(project);
  const git = initRepo(project);
  mkdirSync(join(dir, 'runs'));
  const log = join(dir, 'runs/merge-log.md'), settings = join(dir, 'settings.json');
  writeFileSync(settings, '{}\n');
  const gh = fakeGh(dir);
  gh.answer([TAGS, RULES]);
  const exec = (cmd, args) => execFileSync(join(gh.bin, 'gh'), args, { encoding: 'utf8' });
  const run = (now) => reconcile({ project, repo: 'owner/project', defaultBranch: 'main', log, settings, now: new Date(now), exec });
  const baseline = run('2026-11-19T08:00:00Z');
  appendFileSync(log, `2026-11-19T09:00:00Z owner/project #5 ${'a'.repeat(40)} ${'a'.repeat(40)} ${OID5} https://github.com/owner/project/pull/5#pullrequestreview-1 run-1\n`);
  return { dir, project, git, log, settings, gh, run, baseline };
}

test('reconcile: the first run takes the baseline and compares nothing', () => {
  const s = setup();
  assert.deepEqual(s.baseline, {
    repo: 'owner/project', baseline: true, since: null, findings: [],
    reconciled: `reconciled 2026-11-19T08:00:00Z owner/project tags=["v1.0.0"] rulesets=${RULESETS} settings=${SETTINGS}`,
  });
  // No merges are listed without a base date.
  assert.deepEqual(s.gh.calls().map((args) => args[0]), ['api', 'api']);
  assert.match(readFileSync(join(s.dir, 'runs/git-config-owner-project.txt'), 'utf8'), /^user\.email=t@example\.com$/m);
});

test('reconcile: nothing changed and every merge logged gives no finding and appends the next base', () => {
  const s = setup();
  s.gh.answer([TAGS, RULES, merged([PR5])]);
  const result = s.run('2026-11-20T08:00:00Z');
  assert.deepEqual(result, {
    repo: 'owner/project', baseline: false, since: '2026-11-19', findings: [],
    reconciled: `reconciled 2026-11-20T08:00:00Z owner/project tags=["v1.0.0"] rulesets=${RULESETS} settings=${SETTINGS}`,
  });
  assert.equal(readFileSync(s.log, 'utf8').trim().split('\n').at(-1), result.reconciled);
});

test('reconcile: a merged pull request without a merge log line is a finding', () => {
  const s = setup();
  s.gh.answer([TAGS, RULES, merged([PR5, { number: 6, mergeCommit: { oid: OID6 }, mergedAt: '2026-11-19T12:00:00Z', mergedBy: { login: 'someone' } }])]);
  assert.deepEqual(s.run('2026-11-20T08:00:00Z').findings, [{ kind: 'unlogged-merge', number: 6, mergeCommit: OID6, mergedAt: '2026-11-19T12:00:00Z', mergedBy: 'someone' }]);
});

test('reconcile: a new tag is a finding', () => {
  const s = setup();
  s.gh.answer([[TAGS[0], 'v1.0.0\nv1.1.0\n'], RULES, merged([PR5])]);
  const result = s.run('2026-11-20T08:00:00Z');
  assert.deepEqual(result.findings, [{ kind: 'new-tag', name: 'v1.1.0' }]);
  assert.match(result.reconciled, / tags=\["v1\.0\.0","v1\.1\.0"\] /);
});

test('reconcile: a changed key of the local git config is a finding, by name only, and branch lines are left out', () => {
  const s = setup();
  s.git('config', 'core.hooksPath', 'hooks');
  s.git('config', 'branch.main.remote', 'origin');
  s.gh.answer([TAGS, RULES, merged([PR5])]);
  assert.deepEqual(s.run('2026-11-20T08:00:00Z').findings, [{ kind: 'config-changed', key: 'core.hookspath' }]);
  assert.match(readFileSync(join(s.dir, 'runs/git-config-owner-project.txt'), 'utf8'), /^core\.hookspath=hooks$/m);
});

test('reconcile: the command line prints the findings as JSON and a failed read writes nothing', () => {
  const s = setup();
  const before = readFileSync(s.log, 'utf8');
  const args = [SCRIPT, '--project', s.project, '--repo', 'owner/project', '--default-branch', 'main', '--log', s.log, '--settings', s.settings];
  const env = { ...process.env, PATH: `${s.gh.bin}:${process.env.PATH}` };
  // The merges of the base date are asked for; no answer for them is a failed read.
  const failed = spawnSync(process.execPath, args, { encoding: 'utf8', env });
  assert.equal(failed.status, 1);
  assert.equal(failed.stderr.trim().split('\n').length, 1);
  assert.equal(readFileSync(s.log, 'utf8'), before);
  s.gh.answer([TAGS, RULES, merged([PR5])]);
  const done = spawnSync(process.execPath, args, { encoding: 'utf8', env });
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(JSON.parse(done.stdout).findings, []);
});
