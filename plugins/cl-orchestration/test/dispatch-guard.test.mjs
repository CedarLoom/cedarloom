import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

const SHA = 'a'.repeat(40);
const CWD = '/home/user/proj';
const CLONE = '.cedarloom/runs/r1/clones/app-12-1';
// The reason of a refusal, or none; the hook runs as Claude Code starts it.
const reason = (tool_input, tool = 'Bash', cwd = CWD) => {
  const r = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input, tool_use_id: 'toolu_01', cwd }));
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout === '') return 'none';
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  return out.permissionDecisionReason;
};
const refused = (rule, commands, tool = 'Bash', cwd = CWD) => {
  for (const command of commands) assert.match(reason({ command }, tool, cwd), new RegExp(`\\b${rule}: `), command);
};
const passed = (commands, tool = 'Bash', cwd = CWD) => {
  for (const command of commands) assert.equal(reason({ command }, tool, cwd), 'none', command);
};

test('bypass-flag: a flag that bypasses or skips permission prompts is refused in each spelling', () => {
  refused('bypass-flag', [
    'claude --dangerously-skip-permissions',
    '"/usr/local/bin/claude" --allow-dangerously-skip-permissions -p x',
    'claude --permission-mode=bypassPermissions',
    'claude --permission-mode "bypass"Permissions',
    'command claude --dang',
    'env FOO=1 codex --yolo',
    'codex -a never exec x',
    'codex --ask-for-approval=never',
    'codex --sandbox danger-full-access',
    `codex -c 'approval_policy="never"'`,
    `claude --settings '{"permissions":{"defaultMode":"bypassPermissions"}}'`,
    '(claude --dangerously-skip-permissions)',
    "bash -c 'claude --dangerously-skip-permissions'",
    'claude \\\n  --dangerously-skip-permissions',
    'claude $FLAGS',
    'claude "$(cat flags)"',
    'orca terminal create --command "env -u CEDARLOOM_ROLE claude --dangerously-skip-permissions" --json',
  ]);
  refused('bypass-flag', ['claude --dangerously-skip-permissions'], 'PowerShell');
  passed(['claude --permission-mode auto --model opus', 'codex -a on-request', 'rg -n bypassPermissions docs', 'grep -rn "skip permissions" docs', 'jq .permissions.disableBypassPermissionsMode settings.json']);
});

test('launch-env: an Orca launch line that starts an agent without env -u of the role is refused', () => {
  refused('launch-env', [
    "orca terminal create --worktree path:/w --command \"CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false '/usr/local/bin/claude' --permission-mode auto\" --json",
    'orca terminal create --command="claude --permission-mode auto"',
    'orca terminal create --command "env -u OTHER claude --permission-mode auto"',
    'orca terminal create --command "env -u CEDARLOOM_ROLE CEDARLOOM_ROLE=coordinator claude"',
    'orca terminal create --command "sudo -u CEDARLOOM_ROLE claude"',
    `orca terminal create --command "bash -c 'claude --permission-mode auto'"`,
    'orca terminal create --command "$LAUNCH"',
    'orca terminal create --command "$CLAUDE --permission-mode auto"',
  ]);
  passed([
    "orca terminal create --worktree path:/w --title 12-x --command \"env -u CEDARLOOM_ROLE CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false '/usr/local/bin/claude' --autocompact 200k --model 'opus' --effort high --permission-mode auto\" --json",
    'orca terminal create --command "env -u OTHER -uCEDARLOOM_ROLE claude"',
    'orca terminal create --command "npm test"',
  ]);
});

test('worktree-force: a forced worktree removal is refused, through Orca and git', () => {
  refused('worktree-force', [
    'orca worktree rm --worktree path:/w --force --json',
    'orca worktree rm --worktree path:/w --force=true',
    'orca worktree rm --worktree path:/w $EXTRA',
    'git worktree remove --force /w',
    'git worktree remove -f /w',
    'git -C /p worktree remove --forc /w',
    'git worktree remove -ff /w',
    'command git worktree remove --force /w',
    'cd /p && (git worktree remove \\\n --force /w)',
    'git worktree remove $OPTS /w',
    'git worktree $VERB --force /w',
  ]);
  passed(['orca worktree rm --worktree path:/w --run-hooks --json', 'orca worktree rm --worktree "path:$W" --json', 'git worktree remove /w', 'git -C /p worktree list --porcelain']);
});

test('direct-merge: a gh pr merge without the reviewed head pinned, or one the guard cannot read, is refused', () => {
  refused('direct-merge', [
    'gh pr merge 12 -R o/r --squash',
    'gh pr merge 12 --squash --match-head-commit "$HEAD"',
    'gh pr merge 12 --squash --match-head-commit abc123',
    'gh pr merge 12 --squash --match-head-commit=$(git rev-parse HEAD)',
    'gh pr merge 12 --squash --disable-auto=false',
    'grep "$(gh pr merge 12)" notes.md',
    '$(echo gh) pr merge 12',
    'env GH_TOKEN=x gh pr merge 12',
    '(gh pr merge 12)',
    'bash -c "gh pr merge 12"',
    'g""h pr merge 12',
    'gh pr $VERB 12',
    'gh pr merge 12 $OPTS',
    'gh pr merge 12 --squash --body -h',
  ]);
  refused('direct-merge', ['gh pr merge 12 --squash'], 'PowerShell');
  passed([
    `gh pr merge 12 -R o/r --squash --match-head-commit ${SHA} --subject "$(cat subject.txt)" --body-file body.md`,
    `gh pr merge 12 --match-head-commit=${SHA} --merge`,
    'gh pr merge 12 -R o/r --disable-auto',
    'gh pr merge --help',
    'gh pr view 12 --json state',
    'rg -n "gh pr merge 12" docs',
    'echo "$(git log -1)" | grep merge',
  ]);
});

test('no-admin, no-auto and no-delete-branch: gh pr merge refuses each flag, also =-joined and in a short cluster', () => {
  const pinned = `gh pr merge 12 --squash --match-head-commit ${SHA}`;
  refused('no-admin', [`${pinned} --admin`, `${pinned} --admin=true`, `command ${pinned} \\\n --admin`]);
  refused('no-auto', [`${pinned} --auto`, `gh pr merge --auto=true 12 --match-head-commit ${SHA}`]);
  refused('no-delete-branch', [`${pinned} --delete-branch`, `${pinned} -d`, `gh pr merge 12 -sd --match-head-commit ${SHA}`]);
  passed([pinned, `${pinned} --body "--admin --auto"`, `${pinned} -t "-d"`]);
});

test('unreadable-program: a command whose program is a variable or command substitution is refused', () => {
  refused('unreadable-program', ['$RUN', 'GH=gh; $GH pr merge 12 --squash', '"$ORCA" terminal create --command claude', '"$(which gh)" pr view 12'], 'Bash');
  refused('unreadable-program', ['& $gh pr merge 12'], 'PowerShell');
  passed(['$r = gh pr view 12'], 'PowerShell');
  passed(['echo "$(date)"', 'head=$(git rev-parse HEAD)', 'echo $((1 + 2))']);
});

test('update-branch-rebase: gh pr update-branch with --rebase, or an option the guard cannot read, is refused', () => {
  refused('update-branch-rebase', ['gh pr update-branch 12 -R o/r --rebase', 'gh pr update-branch 12 --rebase=true', 'gh pr update-branch 12 $OPT', "sh -c 'gh pr update-branch 12 --rebase'"]);
  passed(['gh pr update-branch 12 -R o/r']);
});

test('clone-checkout: checkout, switch, restore and worktree in a scratch clone, or in a folder the guard cannot read, are refused', () => {
  refused('clone-checkout', [
    `git -C ${CLONE} checkout main`,
    `cd ${CLONE} && git switch main`,
    `git --no-pager -C ${CWD}/${CLONE} restore .`,
    `git -C ${CLONE} worktree add ../w`,
    `(cd ${CLONE}; git checkout main)`,
    `git -C ${CLONE} -c alias.co=checkout co main`,
    `git -C '${CLONE}' "check"out main`,
    'git -C "$CLONE" checkout main',
    'cd - && git checkout main',
    'git --git-dir=x checkout main',
  ]);
  // A folder change that fails leaves the next command in the clone.
  refused('clone-checkout', ['git checkout main', 'cd /tmp/gone; git checkout main'], 'Bash', `${CWD}/${CLONE}`);
  // Past 64 folders the folder counts as unread: 30 changes would otherwise make 2^30 of them.
  const changes = Array.from({ length: 30 }, (_, k) => `cd d${k}`).join('; ');
  // From the temp folder: each path lookup under /home goes through the automounter on macOS.
  refused('clone-checkout', [`${changes}; git checkout main`], 'Bash', tmpdir());
  refused('handoff-size', [`${changes}; echo x > handoff.md`, `${changes}; echo x > /tmp/.cedarloom/runs/handoff.md`], 'Bash', tmpdir());
  passed([`${changes}; git status`], 'Bash', tmpdir());
  // A bot home holds .cedarloom/runs/ and its clones beside it.
  const home = mkdtempSync(join(tmpdir(), 'bot-'));
  mkdirSync(join(home, '.cedarloom', 'runs'), { recursive: true });
  try {
    refused('clone-checkout', ['git -C clones/app-12-1 checkout main', 'git -C clones/trial-app-12-1 checkout main'], 'Bash', home);
  } finally {
    rmSync(home, { recursive: true });
  }
  passed([
    `git -C .cedarloom/runs/r1/checkouts/app-12-2 checkout --force --detach ${SHA}`,
    `git -C ${CLONE} diff --no-ext-diff --no-textconv a..b`,
    'git switch -c feat/12-x',
    `git -C ${CLONE} rev-parse --git-dir`,
  ]);
  passed(['git checkout main'], 'Bash', '/home/user/clones/app');
});

test('handoff-size: a handoff file over 8,000 characters, or a write the guard cannot measure, is refused', () => {
  const handoff = `${CWD}/.cedarloom/runs/handoff.md`;
  assert.match(reason({ file_path: handoff, content: 'x'.repeat(8001) }, 'Write'), /\bhandoff-size: /);
  assert.match(reason({ file_path: '.cedarloom/runs/handoff.md', content: 'x'.repeat(8001) }, 'Write'), /\bhandoff-size: /);
  assert.equal(reason({ file_path: handoff, content: 'é'.repeat(8000) }, 'Write'), 'none');
  assert.equal(reason({ file_path: `${CWD}/notes.md`, content: 'x'.repeat(9000) }, 'Write'), 'none');
  const dir = mkdtempSync(join(tmpdir(), 'run-'));
  const file = join(dir, '.cedarloom', 'runs', 'handoff.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `# Handoff\n${'x'.repeat(7990)}\n`);
  try {
    assert.match(reason({ file_path: file, old_string: '# Handoff', new_string: '# Handoff and more' }, 'Edit'), /\bhandoff-size: /);
    assert.match(reason({ file_path: file, edits: [{ old_string: 'x', new_string: 'yy', replace_all: true }] }, 'MultiEdit'), /\bhandoff-size: /);
    assert.match(reason({ file_path: file, old_string: 'missing', new_string: 'y' }, 'Edit'), /\bhandoff-size: /);
    assert.equal(reason({ file_path: file, old_string: '# Handoff', new_string: '# Run' }, 'Edit'), 'none');
  } finally {
    rmSync(dir, { recursive: true });
  }
  refused('handoff-size', ['echo x > .cedarloom/runs/handoff.md', 'cp big.md .cedarloom/runs/handoff.md', 'cd .cedarloom/runs && tee handoff.md < notes.md', 'echo x >> "$OUT"', 'cat notes.md > "$RUN/handoff.md"']);
  passed(['cat .cedarloom/runs/handoff.md', 'wc -c .cedarloom/runs/handoff.md', 'echo x > notes.md']);
});
