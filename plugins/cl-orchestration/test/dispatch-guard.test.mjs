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

test('dispatch guard: an Orca dispatch that hands a session /cl-workflow:away off is refused', () => {
  const dispatched = [
    'orca orchestration send --to dispatch:d1 --subject x --body "/away off" --json',
    '/opt/orca/bin/orca orchestration worker-start --spec "/cl-workflow:away off"',
    'cd w && ORCA_HOME=x orca orchestration send --to dispatch:d1 --body \'/cl-workflow:away off\'',
    'orca orchestration worker-start --spec "/cl-workflow:away off" --terminal t1 --json',
    'orca orchestration send --to dispatch:d1 --body "/away OFF"',
    // Spellings the shell joins into the command.
    'orca orchestration send --to dispatch:d1 --body "/cl-workflow:away"\' off\'',
    'orca orchestration send --to dispatch:d1 --body /cl-workflow:away\\ off',
    'orca orchestration send --to dispatch:d1 --body "/cl-workflow:away o""ff"',
    'orca orchestration send --to dispatch:d1 --body "/cl-workflow:away"$\' off\'',
    'orca orchestration send --to dispatch:d1 --body "/cl-workflow:away"$" off"',
  ];
  for (const command of dispatched) assert.equal(decision(command), 'deny', command);
  assert.equal(decision('orca.exe orchestration send --to dispatch:d1 --body "/away off"', 'PowerShell'), 'deny');
});

// The commands as written: String.raw keeps the backslashes of the shell's escapes.
const raw = String.raw;

test('dispatch guard: reads ANSI-C quoting ($\'...\') decoded, as bash and zsh do, and quotes joined into the name of Orca', () => {
  const dispatched = [
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:away\x20off'`,
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:away\040off'`,
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:away\u0020off'`,
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:away\toff'`,
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:away\cIoff'`,
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:away\C-ioff'`,
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:away\Cioff'`,
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:away\C\x69off'`,
    // zsh hands a program each word up to its first NUL.
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:awa\y off\0x'`,
    raw`orca orchestration send --to dispatch:d1 --body "/cl-workflow:away"$'\x20off'`,
    raw`orca orchestration worker-start --spec $'/cl-workflow:\x61way off'`,
    raw`$'\x6frca' orchestration send --to dispatch:d1 --body "/away off"`,
    // zsh reads \c as a plain c.
    raw`$'or\ca' orchestration send --to dispatch:d1 --body "/away off"`,
    raw`o""rca orchestration send --to dispatch:d1 --body "/away off"`,
    // bash 3.2's \c takes one backslash of \c\\, so the second starts an escape of its own.
    raw`bash -c $'\c\\x3b\x6frca orchestration send --body "/cl-workflow:away off"'`,
    raw`eval $'\c\\norca orchestration send --body "/cl-workflow:away off"'`,
    raw`bash -c $'\c\\073orca orchestration send --body "/cl-workflow:away off"'`,
    raw`bash -c $'\c\\\\\\x3b\x6frca orchestration send --body "/cl-workflow:away off"'`,
    raw`bash -c $'echo a\c\\x3b\x6frca orchestration send --body "/cl-workflow:away off"'`,
  ];
  for (const command of dispatched) assert.equal(decision(command), 'deny', command);
  const passed = [
    raw`orca orchestration send --to dispatch:d1 --body $'/cl-workflow:away 2h\n'`,
    raw`orca orchestration send --to dispatch:d1 --body $'run the away skill\x21'`,
  ];
  for (const command of passed) assert.equal(decision(command), 'none', command);
});

test('dispatch guard: other Orca commands and commands that only name the queue command pass', () => {
  const passed = [
    'orca orchestration worker-start --spec-file spec.md --terminal t1 --json',
    'orca orchestration send --to dispatch:d1 --body "run the away skill later"',
    'orca orchestration send --to dispatch:d1 --body "/cl-workflow:away 2h"',
    'grep -rn "/cl-workflow:away off" plugins',
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
