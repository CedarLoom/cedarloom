// The question tool's switch for three hooks: SessionStart starts the session in the plugin option mode (argument 1) and says the state,
// UserPromptExpansion sets it for /cl-workflow:away, PreToolUse refuses while away or where nobody answers.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { FORMS, HERE, QUEUE_LINE, SESSION, alone, away, awayUntil } from './window.mjs';
import { answerFlag, awayEnd, processId, windowDir, windowFile } from './window-file.mjs';
import { logFile, logRun } from './questions-log.mjs';

const dir = windowDir();
const file = windowFile();

// The permission modes a person can answer in. Any other value, a mode added later too, refuses until it is judged.
const ATTENDED = new Set(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);

// Why the input shows a session nobody may answer in, else null.
function unattended(input) {
  const mode = input.permission_mode;
  if (mode === 'dontAsk') return 'the session runs in dontAsk mode, which asks nobody';
  if (!ATTENDED.has(mode)) return 'the hook input names no permission mode a person answers in';
  // Python Agent SDK: sdk-py over any value. TypeScript SDK: sdk-ts only where unset. claude -p: sdk-cli only where unset or cli.
  // Those two keep an IDE or orchestrator parent's value: that child is not refused.
  if (process.env.CLAUDE_CODE_ENTRYPOINT?.startsWith('sdk-')) return 'the session runs headless or under an Agent SDK (CLAUDE_CODE_ENTRYPOINT starts with sdk-)';
  return null;
}

// The rule while away or where nobody answers, else null.
const refusal = (input, now) => {
  const end = awayEnd(file, now);
  if (end !== null) return away(end, now);
  const why = unattended(input);
  return why && alone(why);
};
const save = (window) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(window)}\n`);
};
const say = (event, fields) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...fields } }));

const input = await text(process.stdin).then(JSON.parse).catch(() => null);
const event = input?.hook_event_name;
const now = Date.now();
if (input === null || typeof input !== 'object' || Array.isArray(input)) {
  // Exit 2 refuses the question tool; onFailure "block" also refuses it when the hook cannot start.
  process.stderr.write('CedarLoom ask hook: the hook input is no JSON object.\n');
  process.exitCode = 2;
} else if (event === 'PreToolUse') {
  const reason = refusal(input, now);
  if (reason) say(event, { permissionDecision: 'deny', permissionDecisionReason: reason });
} else if (event === 'SessionStart') {
  const mode = process.argv[2] ?? 'here';
  let note = '';
  // A new process or a resumed conversation starts in the mode; ended away spans of earlier processes go too.
  // shortcut: a quit process's answer flag stays (a few bytes) until a process with its id starts; prune by age if they pile up.
  if (input.source === 'startup' || input.source === 'resume') {
    if (dir) {
      rmSync(file, { force: true });
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { /* no window was ever written */ }
      // Window files only: rmSync without recursive throws on a folder.
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isFile() && awayEnd(path, now) === null && !answerFlag(path)) rmSync(path, { force: true });
      }
    }
    if (mode === 'away' && !dir) throw new Error('the plugin has no data folder (CLAUDE_PLUGIN_DATA), so the session cannot start away');
    if (mode === 'away') save({ awayUntil: SESSION });
    else if (mode !== 'here') note = ` The plugin option mode reads "${mode}", which is neither here nor away, so the session started here.`;
  }
  say(event, { additionalContext: `${refusal(input, now) ?? HERE}${note}` });
} else if (event === 'UserPromptExpansion' && ['cl-workflow:away', 'cl-workflow:ask', 'cl-workflow:questions'].includes(input.command_name)) {
  const args = String(input.command_args ?? '');
  const end = input.command_name === 'cl-workflow:away' ? awayUntil(args, now) : undefined;
  if (input.command_name !== 'cl-workflow:away') {
    say(event, { additionalContext: `/${input.command_name} is replaced by /cl-workflow:away and changed nothing: use ${FORMS}.` });
  } else if (end === undefined) {
    say(event, { additionalContext: `/cl-workflow:away read no span in "${args}", so nothing changed: use ${FORMS}.` });
  } else if (!file) {
    throw new Error('the plugin has no data folder (CLAUDE_PLUGIN_DATA), so /cl-workflow:away cannot keep its state');
  } else if (end !== null) {
    save({ awayUntil: end === Infinity ? SESSION : new Date(end).toISOString() });
    say(event, { additionalContext: away(end, now) });
  } else {
    // A command expands alike when typed, piped to claude -p or sent as a stream-json message, and no field of this input tells
    // them apart. So off sets no answer flag where the input shows an unattended session, role-guard.mjs refuses a launch that
    // names it, and the log shows each run to the next one.
    const refused = unattended(input);
    const log = (flag) => logRun(logFile(dir), { time: new Date(now).toISOString(), session: input.session_id ?? null, folder: input.cwd ?? null, mode: input.permission_mode ?? null, entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null, pid: processId(), flag });
    if (refused) {
      log(false);
      say(event, { additionalContext: `/cl-workflow:away off set no answer flag and changed nothing: ${refused}. Typed into an interactive terminal session, it can set the flag. ${refusal(input, now)}` });
    } else {
      // The flag lets this session, and no other, write answers into the local question queue (role-guard.mjs).
      save({ answers: true });
      // A run logs as one that set the flag only once the flag is written; where the log cannot be written, the flag goes again.
      let earlier;
      try {
        earlier = log(true);
      } catch (error) {
        rmSync(file, { force: true });
        throw error;
      }
      say(event, { additionalContext: `${HERE}\n${QUEUE_LINE}\n${earlier}` });
    }
  }
}
