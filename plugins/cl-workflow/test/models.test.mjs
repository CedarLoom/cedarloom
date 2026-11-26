import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveMap } from '../skills/workflow/models.mjs';

const script = fileURLToPath(new URL('../skills/workflow/models.mjs', import.meta.url));

// A project folder and a config home, each with its file when given; returns the arguments of a lookup.
function setup({ user, repository } = {}) {
  const project = mkdtempSync(join(tmpdir(), 'models-project-'));
  const config = mkdtempSync(join(tmpdir(), 'models-config-'));
  if (repository !== undefined) writeFileSync(join(project, 'cedarloom.json'), JSON.stringify(repository));
  if (user !== undefined) {
    mkdirSync(join(config, 'cedarloom'));
    writeFileSync(join(config, 'cedarloom', 'cedarloom.json'), JSON.stringify(user));
  }
  return { project, env: { XDG_CONFIG_HOME: config, HOME: config } };
}
const pick = ({ model, effort }) => `${model} ${effort}`;

test('models: the user file overrides the defaults and the repository file overrides both, each value naming its row and file', () => {
  const at = setup({
    user: { models: { roles: { deep: { model: 'fable', effort: 'high' } }, tasks: { test: 'deep' } } },
    repository: { startLabel: 'ready', models: { tasks: { test: { model: 'haiku', effort: 'medium' } } } },
  });
  const { tasks } = resolveMap(at);
  assert.deepEqual(tasks.plan, { model: 'fable', effort: 'high', row: 'tasks.plan', file: 'default', role: 'roles.deep', roleFile: 'user' });
  assert.deepEqual(tasks.test, { model: 'haiku', effort: 'medium', row: 'tasks.test', file: 'repository' });
  assert.deepEqual(tasks.gather, { model: 'sonnet', effort: 'medium', row: 'tasks.gather', file: 'default', role: 'roles.read', roleFile: 'default' });
});

test('models: a depth row lowers a task, and the risk row after it only raises', () => {
  const at = setup({ user: { models: { depth: { quick: { plan: { model: 'sonnet', effort: 'medium' }, review: { model: 'haiku', effort: 'low' } } }, risk: { high: { plan: { model: 'sonnet', effort: 'low' } } } } } });
  assert.equal(pick(resolveMap({ ...at, depth: 'quick' }).tasks.review), 'haiku low');
  const plan = resolveMap({ ...at, depth: 'quick', risk: 'high' }).tasks.plan;
  assert.deepEqual([pick(plan), plan.row], ['sonnet medium', 'depth.quick.plan']);
});

test('models: rank compares the model first, then the effort', () => {
  const at = setup({
    user: {
      models: {
        tasks: { test: { model: 'sonnet', effort: 'high' }, audit: { model: 'opus', effort: 'xhigh' }, docs: { model: 'opus', effort: 'low' } },
        risk: { high: { test: { model: 'opus', effort: 'medium' }, audit: { model: 'fable', effort: 'high' }, docs: { model: 'sonnet', effort: 'max' } } },
      },
    },
  });
  const { tasks } = resolveMap({ ...at, risk: 'high' });
  assert.deepEqual([pick(tasks.test), pick(tasks.audit), pick(tasks.docs)], ['opus medium', 'fable high', 'opus low']);
});

test('models: a critical lookup applies the high row, then the critical row', () => {
  const at = setup({ user: { models: { risk: { high: { audit: { model: 'fable', effort: 'high' }, verify: { model: 'fable', effort: 'xhigh' } }, critical: { verify: { model: 'fable', effort: 'high' } } } } } });
  const { tasks } = resolveMap({ ...at, risk: 'critical' });
  assert.deepEqual([pick(tasks.audit), tasks.audit.row], ['fable high', 'risk.high.audit']);
  assert.deepEqual([pick(tasks.verify), tasks.verify.row], ['fable xhigh', 'risk.high.verify']);
  assert.equal(pick(resolveMap({ ...at, risk: 'medium' }).tasks.audit), 'opus high');
});

test('models: implement and fix run only on opus, whatever row or role would move them', () => {
  for (const [user, message] of [
    [{ models: { tasks: { implement: 'light' } } }, /tasks\.implement \(user\), roles\.light \(default\) puts implement on sonnet at depth quick, risk low/],
    [{ models: { depth: { quick: { fix: { model: 'sonnet', effort: 'high' } } } } }, /depth\.quick\.fix \(user\) puts fix on sonnet/],
    [{ models: { risk: { critical: { fix: { model: 'fable', effort: 'high' } } } } }, /risk\.critical\.fix \(user\) puts fix on fable at depth quick, risk critical/],
    [{ models: { roles: { build: { model: 'haiku', effort: 'high' } } } }, /tasks\.implement \(default\), roles\.build \(user\) puts implement on haiku/],
  ]) assert.throws(() => resolveMap(setup({ user })), message);
});

test('models: a file is refused for an unknown task, key or value, a role nobody defines, or a user file with other keys', () => {
  for (const [files, message] of [
    [{ repository: { models: { tasks: { deploy: 'deep' } } } }, /models\.tasks\.deploy: unknown key/],
    [{ user: { models: { risk: { medium: {} } } } }, /models\.risk\.medium: unknown key/],
    [{ user: { models: { roles: { deep: { model: 'claude-opus-5', effort: 'high' } } } } }, /models\.roles\.deep\.model: must be one of haiku, sonnet, opus, fable/],
    [{ user: { models: { tasks: { review: 'strongest' } } } }, /tasks\.review in the user file names the role strongest, which no file defines/],
    [{ repository: { models: { depth: { deep: { test: 'typo' } } } } }, /depth\.deep\.test in the repository file names the role typo/],
    [{ user: { startLabel: 'ready', models: {} } }, /startLabel: the user file holds models only/],
  ]) assert.throws(() => resolveMap(setup(files)), message);
});

test('models: the command prints each task with its row and file, and exits 1 on a refused file', () => {
  const at = setup({ user: { models: { tasks: { docs: 'deep' } } } });
  const run = (project, ...args) => spawnSync(process.execPath, [script, project, ...args], { encoding: 'utf8', env: { ...process.env, ...at.env } });
  const printed = run(at.project, '--risk', 'high');
  assert.equal(printed.status, 0);
  assert.match(printed.stdout, /^docs: opus high from tasks\.docs \(user\), roles\.deep \(default\)$/m);
  assert.match(printed.stdout, /^plan: fable high from risk\.high\.plan \(default\), roles\.top \(default\)$/m);
  const refused = setup({ repository: { models: { tasks: { fix: { model: 'sonnet', effort: 'high' } } } } });
  const failed = run(refused.project);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /puts fix on sonnet/);
});
