import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../hooks/dispatch-guard/dispatch-guard.mjs', import.meta.url));

const run = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
const decision = (command, tool = 'Bash') => {
  const r = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, tool_use_id: 'toolu_01', cwd: '/home/user/proj' }));
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === '' ? 'none' : JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
};

test('dispatch guard: an Orca dispatch that hands a session /cl-workflow:questions is refused', () => {
  const dispatched = [
    'orca orchestration worker-start --spec "/cl-workflow:questions all" --terminal t1 --json',
    'orca orchestration send --to dispatch:d1 --subject x --body "/questions 5" --json',
    '/opt/orca/bin/orca orchestration worker-start --spec /cl-workflow:questions',
    'cd w && ORCA_HOME=x orca orchestration send --to dispatch:d1 --body \'/cl-workflow:questions\'',
  ];
  for (const command of dispatched) assert.equal(decision(command), 'deny', command);
  assert.equal(decision('orca.exe orchestration send --to dispatch:d1 --body "/questions"', 'PowerShell'), 'deny');
});

test('dispatch guard: other Orca commands and commands that only name the queue command pass', () => {
  const passed = [
    'orca orchestration worker-start --spec-file spec.md --terminal t1 --json',
    'orca orchestration send --to dispatch:d1 --body "run the questions skill later"',
    'grep -rn /cl-workflow:questions plugins',
    'cat docs/orca.md',
  ];
  for (const command of passed) assert.equal(decision(command), 'none', command);
});

test('dispatch guard: input it cannot read exits 2, which blocks the call', () => {
  for (const input of ['', 'not json', 'null', JSON.stringify({ tool_name: 'Bash', tool_input: { command: ['orca'] } })]) {
    const r = run(input);
    assert.equal(r.status, 2, input);
    assert.equal(r.stdout, '', input);
  }
});
