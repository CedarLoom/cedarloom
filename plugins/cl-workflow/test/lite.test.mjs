import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../skills/${path}`, import.meta.url), 'utf8');
const lite = read('lite/SKILL.md');
const workflow = read('workflow/SKILL.md');

test('lite: a typed, short skill that loads no playbook', () => {
  assert.ok(lite.split(/\s+/).filter(Boolean).length <= 350);
  assert.match(lite, /^disable-model-invocation: true$/m);
  assert.doesNotMatch(lite, /\]\([^)]*(software|deep|risk)\.md/);
});

test('lite: the gate names every risky, at-least-standard and always-deep term of the workflow skill', () => {
  const list = (re) => {
    const found = workflow.match(re)?.[1];
    assert.ok(found, String(re));
    return found.split(', ').map((term) => term.replace(/^an? /, ''));
  };
  const terms = [
    ...list(/^ *- Risky: ([^\n]*)\.$/m),
    ...list(/at least standard: ([^|\n]*?) \|/),
    ...list(/always deep: ([^|\n]*?) \|/),
  ];
  // A floor the workflow skill gains must reach the lite gate too.
  for (const term of terms) assert.ok(lite.includes(term), term);
});
