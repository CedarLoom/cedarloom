import assert from 'node:assert/strict';
import { test } from 'node:test';
import { create, missing } from '../skills/setup/labels.mjs';

const names = (labels) => labels.map((label) => label.name);

test('labels: missing lists the labels of the set the repository lacks', () => {
  const existing = JSON.stringify([{ name: 'bug' }, { name: 'cl:ready-for-agent' }, { name: 'cl:triage' }]);
  assert.deepEqual(names(missing(existing)), ['cl:plan', 'cl:needs-human', 'cl:in-progress', 'cl:deferred', 'cl:follow-up']);
});

test('labels: the policy start label takes the place of cl:ready-for-agent', () => {
  const existing = JSON.stringify([{ name: 'cl:ready-for-agent' }, { name: 'cl:plan' }, { name: 'cl:needs-human' }]);
  assert.deepEqual(names(missing(existing, 'agent:go')), ['agent:go', 'cl:in-progress', 'cl:deferred', 'cl:follow-up', 'cl:triage']);
});

test('labels: create runs gh for each approved label and returns the commands that failed', () => {
  const ran = [];
  const gh = (args) => {
    ran.push(args.join(' '));
    if (args[2] === 'cl:deferred') throw new Error('HTTP 403');
  };
  const failed = create('acme/app', ['cl:deferred', 'agent:go'], 'agent:go', gh);
  assert.deepEqual(ran, [
    'label create agent:go -R acme/app --description The coordinator may start the issue.',
    'label create cl:deferred -R acme/app --description The owner parked it: it does not start and the question queue skips it.',
  ]);
  assert.deepEqual(failed, ['gh label create cl:deferred -R acme/app --description "The owner parked it: it does not start and the question queue skips it."']);
});

test('labels: create refuses a label outside the set before running gh', () => {
  const gh = () => assert.fail('gh ran');
  assert.throws(() => create('acme/app', ['cl:plan', 'cl:ready-for-agent'], 'agent:go', gh), /not a CedarLoom label: cl:ready-for-agent/);
});
