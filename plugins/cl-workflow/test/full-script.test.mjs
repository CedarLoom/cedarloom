import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The generated script ends in a top-level return: its body runs as an async function over stubbed workflow globals.
const source = readFileSync(new URL('../workflows/full.js', import.meta.url), 'utf8');
const body = source.replace(/^export const meta = /m, 'const meta = ');
const AsyncFunction = (async () => {}).constructor;

const IMPORTANT = { class: 'Important', text: 'the guard misses empty input', file: 'src/a.js', line: 3, evidence: 'a.js:3' };
const MINOR = { class: 'Minor', text: 'a name', file: 'src/a.js', line: 9, evidence: 'a.js:9' };
const PLAN = { plan: 'the plan', questions: [] };
const DONE = { status: 'done', report: 'fixed' };
const STUCK = { status: 'stuck', report: 'no way forward' };
const CLEAN = { findings: [] };
const FOUND = { findings: [IMPORTANT] };
const DEFAULT = {
  'cl-workflow:plan': PLAN,
  'cl-workflow:implement': DONE,
  'cl-workflow:test': { status: 'pass', failures: [], keyLines: [] },
  'cl-workflow:review': CLEAN,
  'cl-workflow:verify': CLEAN,
  'cl-workflow:recheck': CLEAN,
};

// Runs one stage; `stubs` maps a call's label, else its agent, to the result. Returns each call as [agent, model] and the stage's result without its reason text.
async function run(args, stubs = {}) {
  const calls = [];
  const agent = async (prompt, { agentType, model, label }) => {
    calls.push([agentType, model]);
    return stubs[label] ?? stubs[agentType] ?? DEFAULT[agentType];
  };
  const parallel = (thunks) => Promise.all(thunks.map((thunk) => thunk().catch(() => null)));
  const pipeline = () => assert.fail('pipeline is not used');
  const quiet = () => {};
  const { reason, ...result } = await new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', body)(agent, parallel, pipeline, quiet, quiet, args);
  assert.equal(typeof reason, 'string');
  return { calls, result };
}

const build = (more) => ({ stage: 'build', task: 'add a guard', planPath: '/plans/guard.md', ...more });
const start = [
  ['cl-workflow:implement', 'opus'],
  ['cl-workflow:test', 'sonnet'],
  ['cl-workflow:review', 'opus'],
  ['cl-workflow:review', 'opus'],
];
const done = (more) => ({ status: 'done', findings: [], minor: [], rounds: 0, phases: ['implement', 'test', 'review', 'audit'], ...more });

test('full build: findings after every re-review end the stage after the third remediation, the last one stronger', async () => {
  const { calls, result } = await run(build(), { 'cl-workflow:review': FOUND, 'cl-workflow:recheck': FOUND });
  assert.deepEqual(calls, [
    ...start,
    ['cl-workflow:implement', 'opus'],
    ['cl-workflow:recheck', 'opus'],
    ['cl-workflow:implement', 'opus'],
    ['cl-workflow:recheck', 'opus'],
    ['cl-workflow:implement', 'fable'],
    ['cl-workflow:recheck', 'opus'],
  ]);
  assert.deepEqual(result, {
    status: 'stopped',
    findings: [IMPORTANT],
    minor: [],
    rounds: 3,
    phases: ['implement', 'test', 'review', 'audit', 'implement round 1', 'review recheck 1', 'implement round 2', 'review recheck 2', 'implement round 3', 'review recheck 3'],
  });
});

test('full build: Minor findings of the review or the audit start no fix and come back in minor', async () => {
  for (const label of ['review', 'audit']) {
    const { calls, result } = await run(build(), { [label]: { findings: [MINOR] } });
    assert.deepEqual(calls, start, label);
    assert.deepEqual(result, done({ minor: [MINOR] }), label);
  }
});

test("full build: the audit's Important finding starts one remediation and one re-review", async () => {
  const { calls, result } = await run(build(), { audit: FOUND });
  assert.deepEqual(calls, [...start, ['cl-workflow:implement', 'opus'], ['cl-workflow:recheck', 'opus']]);
  assert.deepEqual(result, done({ rounds: 1, phases: ['implement', 'test', 'review', 'audit', 'implement round 1', 'review recheck 1'] }));
});

test("full build: a review override reaches the audit, and the recheck model override the re-reviews", async () => {
  const fable = await run(build({ overrides: { review: { model: 'fable' } } }));
  assert.deepEqual(fable.calls, [...start.slice(0, 2), ['cl-workflow:review', 'fable'], ['cl-workflow:review', 'fable']]);
  assert.deepEqual(fable.result, done());

  const rechecked = await run(build({ overrides: { review: { model: 'sonnet', recheckModel: 'opus' } } }), { review: FOUND, 'review recheck 1': FOUND });
  assert.deepEqual(rechecked.calls, [
    ...start.slice(0, 2),
    ['cl-workflow:review', 'sonnet'],
    ['cl-workflow:review', 'sonnet'],
    ['cl-workflow:implement', 'opus'],
    ['cl-workflow:recheck', 'opus'],
    ['cl-workflow:implement', 'opus'],
    ['cl-workflow:recheck', 'opus'],
  ]);
  assert.deepEqual(rechecked.result, done({ rounds: 2, phases: ['implement', 'test', 'review', 'audit', 'implement round 1', 'review recheck 1', 'implement round 2', 'review recheck 2'] }));
});

test('full build: the trial verifies before the first fix, and a disputed finding goes to the re-review unfixed', async () => {
  const trial = ['cl-workflow:verify', 'opus'];
  const confirmed = await run(build({ trial: true }), { review: FOUND, trial: { verdicts: [{ finding: 0, verdict: 'confirmed', evidence: 'holds' }] } });
  assert.deepEqual(confirmed.calls, [...start, trial, ['cl-workflow:implement', 'opus'], ['cl-workflow:recheck', 'opus']]);
  assert.deepEqual(confirmed.result, done({ rounds: 1, phases: ['implement', 'test', 'review', 'audit', 'trial', 'implement round 1', 'review recheck 1'] }));

  const disputed = await run(build({ trial: true }), { review: FOUND, trial: { verdicts: [{ finding: 0, verdict: 'disputed', evidence: 'covered' }] } });
  assert.deepEqual(disputed.calls, [...start, trial, ['cl-workflow:recheck', 'opus']]);
  assert.deepEqual(disputed.result, done({ rounds: 1, phases: ['implement', 'test', 'review', 'audit', 'trial', 'review recheck 1'] }));
});

test('full build: an implement call stuck twice ends the stage after one rerun one step up', async () => {
  const { calls, result } = await run(build(), { 'cl-workflow:implement': STUCK });
  assert.deepEqual(calls, [
    ['cl-workflow:implement', 'opus'],
    ['cl-workflow:implement', 'fable'],
  ]);
  assert.deepEqual(result, { status: 'stopped', findings: [], minor: [], rounds: 0, phases: ['implement', 'implement rerun'], result: STUCK });
});

test('full build: a stuck remediation reruns once one step up, and the next remediation is back on its own model', async () => {
  const { calls, result } = await run(build(), { review: FOUND, 'review recheck 1': FOUND, 'implement round 1': STUCK });
  assert.deepEqual(calls, [
    ...start,
    ['cl-workflow:implement', 'opus'],
    ['cl-workflow:implement', 'fable'],
    ['cl-workflow:recheck', 'opus'],
    ['cl-workflow:implement', 'opus'],
    ['cl-workflow:recheck', 'opus'],
  ]);
  assert.deepEqual(
    result,
    done({ rounds: 2, phases: ['implement', 'test', 'review', 'audit', 'implement round 1', 'implement round 1 rerun', 'review recheck 1', 'implement round 2', 'review recheck 2'] }),
  );
});

test('full build: from restarts at a phase before the loop and refuses the loop phase', async () => {
  const fromTest = await run(build({ from: 'test' }));
  assert.deepEqual(fromTest.calls, start.slice(1));
  assert.deepEqual(fromTest.result, done({ phases: ['test', 'review', 'audit'] }));

  const fromReview = await run(build({ from: 'review' }));
  assert.deepEqual(fromReview.calls, []);
  assert.deepEqual(fromReview.result, { status: 'stopped', findings: [], minor: [], rounds: 0, phases: [] });
});

test('full plan: plan check findings end the stage after one revision, or at once on a brought plan', async () => {
  const planned = await run({ stage: 'plan', task: 'add a guard' }, { 'cl-workflow:verify': FOUND });
  assert.deepEqual(planned.calls, [
    ['cl-workflow:plan', 'opus'],
    ['cl-workflow:verify', 'opus'],
    ['cl-workflow:plan', 'opus'],
    ['cl-workflow:verify', 'opus'],
  ]);
  assert.deepEqual(planned.result, { status: 'stopped', plan: PLAN, findings: [IMPORTANT], minor: [], rounds: 1, phases: ['plan', 'plan-check', 'plan round 1', 'plan-check recheck 1'] });

  const brought = await run({ stage: 'plan', task: 'add a guard', planPath: '/plans/guard.md' }, { 'cl-workflow:verify': FOUND });
  assert.deepEqual(brought.calls, [['cl-workflow:verify', 'opus']]);
  assert.deepEqual(brought.result, { status: 'stopped', findings: [IMPORTANT], minor: [], rounds: 0, phases: ['plan-check'] });
});

test('full: a run without a known stage starts no agent', async () => {
  for (const args of [{ task: 'add a guard' }, { stage: 'ship', task: 'add a guard' }]) {
    const { calls, result } = await run(args);
    assert.deepEqual(calls, []);
    assert.deepEqual(result, { status: 'stopped', findings: [], minor: [], rounds: 0, phases: [] });
  }
});
