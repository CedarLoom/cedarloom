import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const plugin = fileURLToPath(new URL('..', import.meta.url));
const generate = (args) => spawnSync(process.execPath, [join(plugin, 'generator/generate.mjs'), ...args], { encoding: 'utf8' });

// A valid two-stage definition with both loop kinds; each case below breaks one rule of it.
const valid = () => ({
  schemaVersion: 2,
  name: 'demo',
  description: 'A demo flow.',
  work: 'software',
  depth: 'deep',
  script: false,
  stages: [
    {
      id: 'plan',
      phases: [
        { id: 'settle', run: 'session', step: 'settle', questions: true },
        { id: 'plan', run: 'agent', agent: 'cl-workflow:plan', model: 'opus' },
        { id: 'plan-check', run: 'agent', agent: 'cl-workflow:verify', model: 'opus', loop: { fix: 'plan', maxRounds: 1, escalate: false } },
      ],
    },
    {
      id: 'build',
      phases: [
        { id: 'implement', run: 'agent', agent: 'cl-workflow:implement', model: 'opus' },
        { id: 'review', run: 'agent', agent: 'cl-workflow:review', model: 'opus', loop: { fix: 'implement', recheck: 'cl-workflow:recheck', maxRounds: 2, escalate: true } },
        { id: 'audit', run: 'agent', agent: 'cl-workflow:review', model: 'opus', with: 'review' },
        { id: 'pull-request', run: 'session', step: 'pull-request' },
      ],
    },
  ],
});

function refusedWith(change) {
  const def = valid();
  change(def);
  const file = join(mkdtempSync(join(tmpdir(), 'definition-')), 'demo.json');
  writeFileSync(file, JSON.stringify(def));
  const run = generate([file, '--json', '--out', join(tmpdir(), 'out')]);
  return { file, status: run.status, refusals: JSON.parse(run.stdout) };
}

test('generator: --check passes on the shipped definitions and fails after a one-character edit', () => {
  const copy = mkdtempSync(join(tmpdir(), 'plugin-'));
  for (const folder of ['generator', 'definitions', 'skills/dev', 'skills/research']) cpSync(join(plugin, folder), join(copy, folder), { recursive: true });
  const check = () => spawnSync(process.execPath, [join(copy, 'generator/generate.mjs'), join(copy, 'definitions/dev.json'), join(copy, 'definitions/research.json'), '--check']).status;
  assert.equal(check(), 0);
  appendFileSync(join(copy, 'skills/research/agents/openai.yaml'), ' ');
  assert.equal(check(), 1);
});

test('generator: each refusal names the file, the field and the rule, and exits 1', () => {
  assert.deepEqual(refusedWith(() => {}).refusals, []);
  const cases = [
    [(d) => (d.schemaVersion = 1), 'schemaVersion', 'must be 2'],
    [(d) => (d.extra = true), 'extra', 'unknown field'],
    [(d) => (d.stages[1].phases[1].loop.maxRounds = 3), 'stages[1].phases[1].loop.maxRounds', 'an integer from 1 to 2'],
    [(d) => (d.stages[0].phases[2].loop.maxRounds = 2), 'stages[0].phases[2].loop.maxRounds', 'at most 1 where fix is a plan phase'],
    [(d) => Object.assign(d, { script: true, depth: 'standard' }), 'script', 'a script needs work "software" and depth "deep"'],
    [(d) => d.stages[1].phases.splice(1, 0, { id: 'check-in', run: 'session', step: 'settle' }), 'stages[1].phases[1].run', 'a session phase stands only first or last in its stage'],
  ];
  for (const [change, field, rule] of cases) {
    const { file, status, refusals } = refusedWith(change);
    assert.deepEqual(refusals, [{ file, field, rule }], field);
    assert.equal(status, 1, field);
  }
});

test("generator: --prefix '' names the bare command and the project's definition", () => {
  const out = mkdtempSync(join(tmpdir(), 'project-'));
  assert.equal(generate([join(plugin, 'definitions/dev.json'), '--prefix', '', '--out', out]).status, 0);
  const skill = readFileSync(join(out, 'skills/dev/SKILL.md'), 'utf8');
  assert.match(skill, /Typed as `\/dev <task>`/);
  assert.doesNotMatch(skill, /\/cl-workflow:dev/);
  assert.match(skill, /Generated from \.cedarloom\/workflows\/dev\.json /);
});
