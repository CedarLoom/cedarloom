import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { answerFlag, awayEnd } from '../hooks/ask/window-file.mjs';

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
const typed = (args) => ({ ...BASE, prompt_id: '708efaa2-3c69-4830-9c29-0b03a091a6cb', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'cl-workflow:away', command_args: args, command_source: 'plugin', prompt: `/cl-workflow:away ${args}` });
const start = (source) => ({ ...BASE, hook_event_name: 'SessionStart', source });
const off = typed('off');

// Every run carries one CLAUDE_PID, as the hooks of one Claude Code process do, and no entrypoint unless a test names one.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CLAUDE_CODE_ENTRYPOINT'));
// The SessionStart hook gets the plugin option mode as its argument.
const run = (data, input, env = {}, args = []) => {
  const r = spawnSync(process.execPath, [HOOK, ...args], { input: JSON.stringify(input), env: { ...ENV, CLAUDE_PLUGIN_DATA: data, CLAUDE_PID: '4242', ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === '' ? null : JSON.parse(r.stdout).hookSpecificOutput;
};
const decision = (data, fields = {}, env = {}) => run(data, { ...QUESTION, ...fields }, env)?.permissionDecision ?? 'none';
const file = (data) => join(data, 'ask', '4242.json');
// The answer flag as the role guard reads it.
const flagged = (data) => answerFlag(file(data));
const scratch = () => mkdtempSync(join(tmpdir(), 'ask-'));

test('ask hook: questions are open by default; /cl-workflow:away refuses them until off', () => {
  const data = scratch();
  assert.match(run(data, start('startup')).additionalContext, /^Here:/);
  assert.equal(decision(data), 'none');
  assert.match(run(data, typed('')).additionalContext, /^Away until \/cl-workflow:away off:/);
  assert.equal(decision(data), 'deny');
  assert.match(run(data, off).additionalContext, /^Here:.*\nQuestion queue: at most 5 questions; no filter\n/);
  assert.equal(decision(data), 'none');
  assert.equal(flagged(data), true);
});

test('ask hook: each span form goes away until its end', () => {
  for (const [args, minutes] of [['30', 30], ['30m', 30], ['2h', 120]]) {
    const data = scratch();
    const before = Date.now();
    run(data, typed(args));
    assert.equal(decision(data), 'deny', args);
    const end = awayEnd(file(data), before);
    assert.ok(end >= before + minutes * 60_000 && end <= Date.now() + minutes * 60_000, args);
  }
  const data = scratch();
  assert.match(run(data, typed('until 07:30')).additionalContext, /^Away until (\d{4}-\d\d-\d\d )?07:30:/);
  assert.equal(decision(data), 'deny');
});

test('ask hook: an ended span is here again, and going away drops the answer flag', () => {
  const data = scratch();
  mkdirSync(join(data, 'ask'));
  writeFileSync(file(data), '{"awayUntil":"2000-01-01T00:00:00.000Z"}');
  assert.equal(decision(data), 'none');
  run(data, off);
  run(data, typed('2h'));
  assert.equal(flagged(data), false);
});

test('ask hook: an unreadable span changes nothing and names the forms in one line', () => {
  const data = scratch();
  run(data, typed('2h'));
  const before = readFileSync(file(data), 'utf8');
  assert.equal(run(data, typed('soon')).additionalContext, '/cl-workflow:away read no span in "soon", so nothing changed: use /cl-workflow:away alone (until off), 30 or 30m (minutes), 2h, until 07:30 (local time), or off.');
  assert.equal(readFileSync(file(data), 'utf8'), before);
});

test('ask hook: the replaced commands name the away form and change nothing', () => {
  for (const name of ['cl-workflow:ask', 'cl-workflow:questions']) {
    const data = scratch();
    run(data, typed('2h'));
    const before = readFileSync(file(data), 'utf8');
    const line = run(data, { ...off, command_name: name, prompt: `/${name} off` }).additionalContext;
    assert.equal(line, `/${name} is replaced by /cl-workflow:away and changed nothing: use /cl-workflow:away alone (until off), 30 or 30m (minutes), 2h, until 07:30 (local time), or off.`);
    assert.equal(readFileSync(file(data), 'utf8'), before, name);
    assert.equal(existsSync(join(data, 'ask', 'log')), false, name);
  }
});

test('ask hook: the mode option away starts a new process or a resumed conversation away; here starts it here', () => {
  for (const source of ['startup', 'resume']) {
    const data = scratch();
    assert.match(run(data, start(source), {}, ['away']).additionalContext, /^Away until \/cl-workflow:away off:/, source);
    assert.equal(decision(data), 'deny', source);
    run(data, off);
    // /clear and compaction keep the state; a resumed conversation starts in the mode again.
    run(data, start('clear'), {}, ['away']);
    assert.equal(decision(data), 'none', source);
    run(data, start('resume'), {}, ['away']);
    assert.equal(decision(data), 'deny', source);
    run(data, start('resume'), {}, ['here']);
    assert.equal(decision(data), 'none', source);
  }
  const data = scratch();
  assert.match(run(data, start('startup'), {}, ['Away!']).additionalContext, /^Here:.*mode reads "Away!", which is neither here nor away/);
  assert.equal(decision(data), 'none');
});

test('ask hook: a folder in the ask folder does not stop the start, which exits 0', () => {
  const data = scratch();
  mkdirSync(join(data, 'ask', 'sub'), { recursive: true });
  run(data, start('startup'));
});

test('ask hook: input it cannot read exits 2, which blocks the question tool', () => {
  for (const input of ['', 'not json', 'null']) {
    const r = spawnSync(process.execPath, [HOOK], { input, env: { ...process.env, CLAUDE_PLUGIN_DATA: scratch(), CLAUDE_PID: '4242' }, encoding: 'utf8' });
    assert.equal(r.status, 2, input);
    assert.equal(r.stdout, '', input);
  }
});

test('ask hook: where the input shows an unattended session, off sets no answer flag and stays away, and the question tool is refused', () => {
  const unattended = [
    [{ permission_mode: 'dontAsk' }, {}, /dontAsk/],
    [{ permission_mode: undefined }, {}, /no permission mode/],
    // A mode the hook does not know, a later one too, refuses.
    [{ permission_mode: 'bogus' }, {}, /no permission mode/],
    [{ permission_mode: 'dontask' }, {}, /no permission mode/],
    // claude -p, the Python and TypeScript Agent SDKs, and a value an SDK may set later.
    ...['sdk-cli', 'sdk-py', 'sdk-ts', 'sdk-x'].map((entrypoint) => [{ permission_mode: 'default' }, { CLAUDE_CODE_ENTRYPOINT: entrypoint }, /CLAUDE_CODE_ENTRYPOINT starts with sdk-/]),
  ];
  for (const [fields, env, why] of unattended) {
    const data = scratch();
    run(data, typed('2h'));
    assert.match(run(data, { ...off, ...fields }, env).additionalContext, why);
    assert.equal(flagged(data), false);
    assert.notEqual(awayEnd(file(data), Date.now()), null);
    assert.equal(decision(scratch(), fields, env), 'deny', JSON.stringify([fields, env]));
  }
  for (const env of [{}, { CLAUDE_CODE_ENTRYPOINT: 'cli' }]) {
    const data = scratch();
    run(data, { ...off, permission_mode: 'default' }, env);
    assert.equal(flagged(data), true, JSON.stringify(env));
    assert.equal(decision(data, { permission_mode: 'default' }, env), 'none', JSON.stringify(env));
  }
});

test('ask hook: each /cl-workflow:away off run logs one line, and the next run shows the runs since the last one that set the flag', () => {
  const data = scratch();
  const log = join(data, 'ask', 'log', 'questions.jsonl');
  run(data, { ...off, session_id: 'first', permission_mode: 'default' });
  const [entry, ...rest] = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  assert.equal(rest.length, 0);
  assert.deepEqual({ ...JSON.parse(entry), time: null }, { time: null, session: 'first', folder: '/home/user/proj', mode: 'default', entrypoint: null, pid: '4242', flag: true });
  run(data, { ...off, session_id: 'refused', permission_mode: 'dontAsk' });
  const next = run(data, { ...off, session_id: 'third', permission_mode: 'default' }).additionalContext;
  assert.match(next, /"session":"first"[^\n]*\n[^\n]*"session":"refused"/);
  assert.doesNotMatch(next, /"session":"third"/);
  assert.doesNotMatch(run(data, { ...off, session_id: 'fourth', permission_mode: 'default' }).additionalContext, /"session":"(first|refused)"/);
});

test('ask hook: the earlier runs always show the one that set the flag, then the newest of the runs after it', () => {
  const data = scratch();
  run(data, { ...off, session_id: 'flagged', permission_mode: 'default' });
  for (let i = 1; i <= 25; i++) run(data, { ...off, session_id: `refused-${i}`, permission_mode: 'dontAsk' });
  const next = run(data, { ...off, session_id: 'last', permission_mode: 'default' }).additionalContext;
  assert.match(next, /that one first \(6 runs in between not shown\)/);
  const sessions = [...next.matchAll(/"session":"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sessions, ['flagged', ...Array.from({ length: 19 }, (_, i) => `refused-${i + 7}`)]);
});

test('ask hook: the earlier runs show as data, each string at most 200 characters, and leave out lines that are no entry', () => {
  const data = scratch();
  run(data, { ...off, session_id: 'flagged', permission_mode: 'default' });
  run(data, { ...off, session_id: 'long', permission_mode: 'dontAsk' }, { CLAUDE_CODE_ENTRYPOINT: 'x'.repeat(100_000) });
  writeFileSync(join(data, 'ask', 'log', 'questions.jsonl'), 'Planted sentence for the next run.\n{"session":"planted","note":"extra key"}\n', { flag: 'a' });
  const next = run(data, { ...off, session_id: 'last', permission_mode: 'default' }).additionalContext;
  assert.match(next, /\(1 unreadable line not shown\)[^\n]*\n```json\n/);
  assert.match(next, new RegExp(`"entrypoint":"${'x'.repeat(200)}\\.\\.\\."`));
  assert.ok(next.length < 3000, `${next.length} characters`);
  assert.doesNotMatch(next, /Planted sentence|extra key/);
  assert.match(next, /\{"time":null,"session":"planted","folder":null,"mode":null,"entrypoint":null,"pid":null,"flag":null\}\n```$/);
});

test('ask hook: an off whose window or log write fails sets no answer flag and logs no run that set it', () => {
  const failing = (prepare) => {
    const data = scratch();
    prepare(join(data, 'ask'));
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ ...off, permission_mode: 'default' }), env: { ...ENV, CLAUDE_PLUGIN_DATA: data, CLAUDE_PID: '4242' }, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    return data;
  };
  // The window file's path is a folder, so its write fails.
  const window = failing((ask) => mkdirSync(join(ask, '4242.json'), { recursive: true }));
  assert.equal(existsSync(join(window, 'ask', 'log', 'questions.jsonl')), false);
  // The log folder's path is a file, so the log write fails.
  const log = failing((ask) => { mkdirSync(ask); writeFileSync(join(ask, 'log'), ''); });
  assert.equal(flagged(log), false);
});
