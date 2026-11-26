import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
        { id: 'plan', run: 'agent', agent: 'cl-workflow:plan', task: 'plan' },
        { id: 'plan-check', run: 'agent', agent: 'cl-workflow:verify', task: 'verify', loop: { fix: 'plan', maxRounds: 1, escalate: false } },
      ],
    },
    {
      id: 'build',
      phases: [
        { id: 'implement', run: 'agent', agent: 'cl-workflow:implement', task: 'implement' },
        { id: 'review', run: 'agent', agent: 'cl-workflow:review', task: 'review', loop: { fix: 'implement', recheck: 'cl-workflow:recheck', maxRounds: 2, escalate: true } },
        { id: 'audit', run: 'agent', agent: 'cl-workflow:review', task: 'audit', with: 'review' },
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

test("generator: --check passes on the shipped definitions and fails after a one-character edit or an agent's model off the map's defaults", () => {
  const copy = mkdtempSync(join(tmpdir(), 'plugin-'));
  const names = readdirSync(join(plugin, 'definitions')).map((file) => file.replace(/\.json$/, ''));
  for (const folder of ['generator', 'definitions', 'workflows', 'agents', 'skills/workflow', ...names.map((name) => `skills/${name}`)]) cpSync(join(plugin, folder), join(copy, folder), { recursive: true });
  const check = () => spawnSync(process.execPath, [join(copy, 'generator/generate.mjs'), ...names.map((name) => join(copy, `definitions/${name}.json`)), '--check']).status;
  assert.equal(check(), 0);
  const verify = join(copy, 'agents/verify.md');
  const agent = readFileSync(verify, 'utf8');
  writeFileSync(verify, agent.replace(/^model: .*$/m, 'model: sonnet'));
  assert.equal(check(), 1);
  writeFileSync(verify, agent);
  appendFileSync(join(copy, 'workflows/full.js'), ' ');
  assert.equal(check(), 1);
});

test('generator: a skill it did not write is never replaced', () => {
  const out = mkdtempSync(join(tmpdir(), 'project-'));
  mkdirSync(join(out, 'skills/dev'), { recursive: true });
  writeFileSync(join(out, 'skills/dev/SKILL.md'), 'own skill\n');
  const run = generate([join(plugin, 'definitions/dev.json'), '--prefix', '', '--out', out]);
  assert.equal(run.status, 1);
  assert.equal(readFileSync(join(out, 'skills/dev/SKILL.md'), 'utf8'), 'own skill\n');
});

test('generator: each refusal names the file, the field and the rule, and exits 1', () => {
  assert.deepEqual(refusedWith(() => {}).refusals, []);
  assert.deepEqual(refusedWith((d) => (d.script = true)).refusals, []);
  const script = (change) => (d) => ((d.script = true), change(d));
  const cases = [
    [(d) => (d.schemaVersion = 1), 'schemaVersion', 'must be 2'],
    [(d) => (d.extra = true), 'extra', 'unknown field'],
    [(d) => (d.stages[1].phases[0].task = 'deploy'), 'stages[1].phases[0].task', 'one of "coordinate", "plan", "review", "recheck", "verify", "fresh-read", "audit", "research", "implement", "fix", "test", "docs", "triage", "digest", "merge", "gather", "lookup"'],
    // Inherited object keys are unknown fields too.
    [(d) => (d.constructor = true), 'constructor', 'unknown field'],
    [(d) => (d.stages[1].phases[1].loop.toString = 'x'), 'stages[1].phases[1].loop.toString', 'unknown field'],
    [(d) => (d.stages[1].phases[1].loop.fix = 'nope'), 'stages[1].phases[1].loop.fix', 'names an earlier agent phase of the same stage'],
    [(d) => (d.stages[1].phases[1].loop.maxRounds = 3), 'stages[1].phases[1].loop.maxRounds', 'an integer from 1 to 2'],
    [(d) => (d.stages[0].phases[2].loop.maxRounds = 2), 'stages[0].phases[2].loop.maxRounds', 'at most 1 where fix is a plan phase'],
    [(d) => Object.assign(d, { script: true, depth: 'standard' }), 'script', 'a script needs work "software" and depth "deep"'],
    [(d) => d.stages[1].phases.splice(1, 0, { id: 'check-in', run: 'session', step: 'settle' }), 'stages[1].phases[1].run', 'a session phase stands only first or last in its stage'],
    [
      script((d) => (d.stages[1].phases[2].agent = 'cl-workflow:gather')),
      'stages[1].phases[2].agent',
      'a script starts only cl-workflow:plan, cl-workflow:implement, cl-workflow:test, cl-workflow:verify, cl-workflow:review, cl-workflow:recheck',
    ],
    [script((d) => (d.stages[1].phases[2].agent = 'cl-workflow:test')), 'stages[1].phases[2].agent', 'a phase with a loop or "with" returns findings: cl-workflow:verify, review or recheck'],
    [script((d) => (d.stages[1].phases[0].agent = 'cl-workflow:test')), 'stages[1].phases[1].loop.fix', 'in a script names a cl-workflow:plan or cl-workflow:implement phase'],
    [script((d) => (d.stages[1].phases[1].loop.recheck = 'cl-workflow:implement')), 'stages[1].phases[1].loop.recheck', 'in a script names cl-workflow:verify, review or recheck'],
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
