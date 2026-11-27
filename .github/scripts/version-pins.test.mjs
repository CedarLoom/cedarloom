import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKIP, pins, provenance } from './version-pins.mjs';

test('plugin install lines that name a release tag get the plugins version; app commands and prose stay', () => {
  const text = 'claude plugin marketplace add o/r#cedarloom-v0.1.0, codex plugin marketplace add o/r@cedarloom-v0.1.0. npx @cedarloom/app@0.1.0 and --branch app-v0.1.0 stay; the tag cedarloom-v0.1.0 in prose stays.';
  assert.equal(pins(text, '0.2.0'), 'claude plugin marketplace add o/r#cedarloom-v0.2.0, codex plugin marketplace add o/r@cedarloom-v0.2.0. npx @cedarloom/app@0.1.0 and --branch app-v0.1.0 stay; the tag cedarloom-v0.1.0 in prose stays.');
});

test('files under plugins/ are not rewritten: their pins name the 0.x minor range', () => {
  assert.ok(SKIP.test('plugins/cl-repo/skills/setup/SKILL.md'));
  assert.ok(!SKIP.test('README.md'));
});


test('an Orca file cites a version or an open check only in the pin lines', () => {
  const text = [
    '# Orca commands',
    'Checked with Orca 1.4.254 to 1.4.274.',
    'Checked with Claude Code 2.1.330.',
    'The app runs at [1.4.259](https://example.com) or later, and `claude --version` prints v2.1.330 or later.',
    'Orca refuses it (Orca 1.4.259).',
    'A row shows it (unverified: the state).',
    'It stays open (observed in a live run).',
    'Claude Code v2.1.330 shows the status bar.',
  ].join('\n');
  assert.deepEqual(provenance(text, true), [5, 6, 7, 8]);
});

test('a pin line counts as a version cite outside the head of orca.md', () => {
  assert.deepEqual(provenance('# Orca watch\n\nChecked with Orca 1.4.274.', false), [3]);
  assert.deepEqual(provenance('# Orca commands\n\nChecked with Orca 1.4.274.\n\nText.\nChecked with Claude Code 2.1.330.', true), [6]);
});
