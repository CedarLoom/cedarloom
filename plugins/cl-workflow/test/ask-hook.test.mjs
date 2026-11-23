import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openUntil } from '../hooks/ask/window-file.mjs';

const HOOK = fileURLToPath(new URL('../hooks/ask/ask.mjs', import.meta.url));
// The inputs Claude Code 2.1.316 gave the plugin's hooks in a scratch session, paths and ids replaced.
const BASE = { session_id: '596beaa6-1d50-456c-aa11-aa29e85e6bcc', transcript_path: '/home/user/.claude/projects/-home-user-proj/596beaa6-1d50-456c-aa11-aa29e85e6bcc.jsonl', cwd: '/home/user/proj', permission_mode: 'acceptEdits' };
const QUESTION = {
  ...BASE,
  hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Which color should be written to color.txt?', header: 'Color', options: [{ label: 'Red', description: 'Write red' }, { label: 'Blue', description: 'Write blue' }], multiSelect: false }] },
  tool_use_id: 'toolu_01',
};
const typed = (args) => ({ ...BASE, prompt_id: '708efaa2-3c69-4830-9c29-0b03a091a6cb', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'cl-workflow:ask', command_args: args, command_source: 'plugin', prompt: `/cl-workflow:ask ${args}` });
const start = (source) => ({ ...BASE, hook_event_name: 'SessionStart', source });

// Every run carries one CLAUDE_PID, as the hooks of one Claude Code process do, and no entrypoint unless a test names one.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CLAUDE_CODE_ENTRYPOINT'));
const run = (data, input, env = {}) => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: { ...ENV, CLAUDE_PLUGIN_DATA: data, CLAUDE_PID: '4242', ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === '' ? null : JSON.parse(r.stdout).hookSpecificOutput;
};
const decision = (data) => run(data, QUESTION)?.permissionDecision ?? 'none';
const queued = (args) => ({ ...typed(args), command_name: 'cl-workflow:questions', prompt: `/cl-workflow:questions ${args}` });
// The window as the role guard reads it: with flagged, only one that lets the session write answers.
const windowEnd = (data, flagged = false) => openUntil(join(data, 'ask', '4242.json'), Date.now(), flagged);

test('ask hook: refuses the question tool until /cl-workflow:ask opens a window, and again after off', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  assert.equal(decision(data), 'deny');
  run(data, typed('for 30m'));
  assert.equal(decision(data), 'none');
  run(data, typed('off'));
  assert.equal(decision(data), 'deny');
});

test('ask hook: /clear keeps the window, a resumed conversation starts without it', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  run(data, typed('for 30m'));
  run(data, start('clear'));
  assert.equal(decision(data), 'none');
  run(data, start('resume'));
  assert.equal(decision(data), 'deny');
});

test('ask hook: a folder in the ask folder does not stop the start, which exits 0', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  mkdirSync(join(data, 'ask', 'sub'), { recursive: true });
  run(data, start('startup'));
});

test('ask hook: input it cannot read exits 2, which blocks the question tool', () => {
  for (const input of ['', 'not json', 'null']) {
    const r = spawnSync(process.execPath, [HOOK], { input, env: { ...process.env, CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ask-')), CLAUDE_PID: '4242' }, encoding: 'utf8' });
    assert.equal(r.status, 2, input);
    assert.equal(r.stdout, '', input);
  }
});

test('ask hook: /cl-workflow:questions allows the question tool for the session, until /cl-workflow:ask off', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  run(data, { ...typed('cedarloom'), command_name: 'cl-workflow:questions', prompt: '/cl-workflow:questions cedarloom' });
  assert.equal(decision(data), 'none');
  run(data, start('compact'));
  assert.equal(decision(data), 'none');
  run(data, typed('off'));
  assert.equal(decision(data), 'deny');
});

test('ask hook: /cl-workflow:questions 5 opens the session with the answer flag and names the count', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  assert.match(run(data, queued('5')).additionalContext, /^Question queue:.*\b5\b/m);
  assert.equal(decision(data), 'none');
  assert.equal(windowEnd(data, true), Infinity);
});

test('ask hook: /cl-workflow:questions 0 opens no window and sets no answer flag', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  run(data, queued('0'));
  assert.equal(decision(data), 'deny');
  assert.equal(windowEnd(data, true), null);
});

test('ask hook: /cl-workflow:questions 0 leaves a timed window open, with its end and without the answer flag', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  mkdirSync(join(data, 'ask'));
  writeFileSync(join(data, 'ask', '4242.json'), '{"askUntil":"2999-01-01T00:00:00.000Z"}');
  run(data, queued('0'));
  assert.equal(decision(data), 'none');
  assert.equal(windowEnd(data), Date.parse('2999-01-01T00:00:00.000Z'));
  assert.equal(windowEnd(data, true), null);
});

test('ask hook: /cl-workflow:questions sets no answer flag where the input shows an unattended session, and says why', () => {
  const { permission_mode: _, ...noMode } = queued('5');
  const unattended = [
    [{ ...queued('5'), permission_mode: 'dontAsk' }, {}, /dontAsk/],
    [noMode, {}, /no permission mode/],
    [{ ...queued('5'), permission_mode: 'default' }, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, /CLAUDE_CODE_ENTRYPOINT=sdk-cli/],
  ];
  for (const [input, env, why] of unattended) {
    const data = mkdtempSync(join(tmpdir(), 'ask-'));
    assert.match(run(data, input, env).additionalContext, why);
    assert.equal(decision(data), 'deny');
    assert.equal(windowEnd(data, true), null);
  }
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  run(data, { ...queued('5'), permission_mode: 'default' });
  assert.equal(windowEnd(data, true), Infinity);
});

test('ask hook: each /cl-workflow:questions run logs one line, and the next run shows the runs since the last one that set the flag', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  const log = join(data, 'ask', 'log', 'questions.jsonl');
  run(data, { ...queued('5'), session_id: 'first', permission_mode: 'default' });
  const [entry, ...rest] = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  assert.equal(rest.length, 0);
  assert.deepEqual({ ...JSON.parse(entry), time: null }, { time: null, session: 'first', folder: '/home/user/proj', mode: 'default', entrypoint: null, pid: '4242', flag: true });
  run(data, { ...queued('5'), session_id: 'refused', permission_mode: 'dontAsk' });
  const next = run(data, { ...queued('5'), session_id: 'third', permission_mode: 'default' }).additionalContext;
  assert.match(next, /"session":"first"[^\n]*\n[^\n]*"session":"refused"/);
  assert.doesNotMatch(next, /"session":"third"/);
  assert.doesNotMatch(run(data, { ...queued('5'), session_id: 'fourth', permission_mode: 'default' }).additionalContext, /"session":"(first|refused)"/);
});

test('ask hook: a run whose window or log write fails sets no answer flag and logs no run that set it', () => {
  const failing = (prepare) => {
    const data = mkdtempSync(join(tmpdir(), 'ask-'));
    prepare(join(data, 'ask'));
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ ...queued('5'), permission_mode: 'default' }), env: { ...ENV, CLAUDE_PLUGIN_DATA: data, CLAUDE_PID: '4242' }, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    return data;
  };
  // The window file's path is a folder, so its write fails.
  const window = failing((ask) => mkdirSync(join(ask, '4242.json'), { recursive: true }));
  assert.equal(existsSync(join(window, 'ask', 'log', 'questions.jsonl')), false);
  // The log folder's path is a file, so the log write fails.
  const log = failing((ask) => { mkdirSync(ask); writeFileSync(join(ask, 'log'), ''); });
  assert.equal(windowEnd(log, true), null);
});
