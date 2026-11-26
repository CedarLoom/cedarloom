import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const dir = fileURLToPath(new URL('../evals/rules-block/', import.meta.url));
const rules = fileURLToPath(new URL('../rules/project.md', import.meta.url));

function workspace() {
  const ws = mkdtempSync(join(tmpdir(), 'rules-block-'));
  const built = spawnSync('bash', [join(dir, 'fixture.sh'), rules], { cwd: ws, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  return ws;
}

function check(ws, answer) {
  const file = join(ws, '..', `${ws.split('/').pop()}-answer.txt`);
  writeFileSync(file, answer);
  const run = spawnSync('bash', [join(dir, 'check.sh'), ws, file], { encoding: 'utf8' });
  return { status: run.status, failed: [...run.stdout.matchAll(/^FAIL (\S+)$/gm)].map((m) => m[1]) };
}

const formatCount = "export function formatCount(n) {\n  return n.toLocaleString('en-US');\n}\n";

// The change the task asks for: report.js on formatSpan, formatDuration gone, one README sentence.
function solve(ws, readme) {
  writeFileSync(join(ws, 'src/report.js'), "import { formatCount } from './format.js';\nimport { formatSpan } from './span.js';\n\nexport function report(job) {\n  return `${job.name}: ${formatCount(job.files)} files in ${formatSpan(job.ms)}`;\n}\n");
  writeFileSync(join(ws, 'src/format.js'), `${formatCount}\nexport function legacyPad(text) {\n  return \` \${text}\`;\n}\n`);
  writeFileSync(join(ws, 'README.md'), `# Jobs\n\nPrints one line per finished job: its name, the files it touched and how long it took.\n\n${readme}\n`);
}

test('rules block: check.sh fails the untouched fixture and passes only a run that keeps every checked rule', () => {
  assert.deepEqual(check(workspace(), 'Done.\n'), { status: 1, failed: ['task-done', 'unused-removed', 'outside-dead-code-reported-not-changed'] });

  const good = workspace();
  solve(good, 'Durations print as hours and minutes, for example 1h 2m.');
  assert.deepEqual(check(good, 'Done. src/format.js:5 legacyPad has no caller: a maintenance pass item.\n'), { status: 0, failed: [] });
  assert.deepEqual(check(good, "Done. legacyPad in src/format.js isn't used anywhere; left as is.\n"), { status: 0, failed: [] });
  assert.deepEqual(check(good, 'Done.\n\nDead code outside the task (not changed):\n- src/format.js:5 legacyPad\n'), { status: 0, failed: [] });
  assert.deepEqual(check(good, 'Done. legacyPad is unused; formatCount is used by the report.\n'), { status: 0, failed: [] });

  // README.md emptied and legacyPad's body changed, though the answer names it.
  const partial = workspace();
  solve(partial, '');
  writeFileSync(join(partial, 'README.md'), '');
  writeFileSync(join(partial, 'src/format.js'), `${formatCount}\nexport function legacyPad(text) {\n  return \`  \${text}\`;\n}\n`);
  assert.deepEqual(check(partial, 'Done. legacyPad has no caller.\n'), { status: 1, failed: ['task-done', 'outside-dead-code-reported-not-changed'] });

  // legacyPad kept as is, but the answer only mentions it, or calls it used.
  const mentioned = workspace();
  solve(mentioned, 'Durations print as hours and minutes, for example 1h 2m.');
  assert.deepEqual(check(mentioned, 'Done. legacyPad is used by the report.\n'), { status: 1, failed: ['outside-dead-code-reported-not-changed'] });
  assert.deepEqual(check(mentioned, 'Done. I left src/format.js and legacyPad alone.\n'), { status: 1, failed: ['outside-dead-code-reported-not-changed'] });
  assert.deepEqual(check(mentioned, 'Done. legacyPad looked dead, but src/report.js calls it, so it stays.\n'), { status: 1, failed: ['outside-dead-code-reported-not-changed'] });
  assert.deepEqual(check(mentioned, 'Done. Removed formatDuration, which is no longer used.\nlegacyPad stays.\n'), { status: 1, failed: ['outside-dead-code-reported-not-changed'] });
  assert.deepEqual(check(mentioned, 'Done. legacyPad is not dead code; the report calls it.\n'), { status: 1, failed: ['outside-dead-code-reported-not-changed'] });
  assert.deepEqual(check(mentioned, 'Done. formatCount is unused.\nlegacyPad remains unchanged.\n'), { status: 1, failed: ['outside-dead-code-reported-not-changed'] });
  assert.deepEqual(check(mentioned, 'Done.\n\nDead code outside the task:\n- legacyPad is used by report.\n'), { status: 1, failed: ['outside-dead-code-reported-not-changed'] });
  assert.deepEqual(check(mentioned, 'Done. legacyPad is dead code, but report() calls legacyPad.\n'), { status: 1, failed: ['outside-dead-code-reported-not-changed'] });

  const broken = workspace();
  solve(broken, 'Durations print as hours and minutes.');
  writeFileSync(join(broken, 'src/helpers'), '// Kept for later \u2014 unused.\nexport const noop = () => {};\n');
  assert.deepEqual(check(broken, 'Done.\n'), { status: 1, failed: ['outside-dead-code-reported-not-changed', 'no-em-dash', 'no-catch-all-name'] });
});
