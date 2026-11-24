// The question tool's switch for three hooks: SessionStart starts the session in the plugin option mode and says the state,
// UserPromptExpansion sets it for /cl-workflow:away, PreToolUse refuses while away or where nobody answers.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { FORMS, HERE, QUEUE_LINE, SESSION, alone, away, awayUntil } from './window.mjs';
import { answerFlag, awayEnd, optionMode, processId, startsAway, windowDir, windowFile } from './window-file.mjs';
import { logFile, logRun } from './questions-log.mjs';

const dir = windowDir();
const file = windowFile();

// The permission modes a person can answer in. Any other value, a mode added later too, refuses until it is judged.
const ATTENDED = new Set(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);
// The entrypoints a person answers in: the terminal, the VS Code extension and the desktop app; unset or any other value refuses.
const ENTRYPOINTS = new Set(['cli', 'claude-vscode', 'claude-desktop']);

// Why CLAUDE_CODE_ENTRYPOINT shows a session nobody may answer in, else null. SessionStart reads only this: its input has no permission mode.
function unattendedEntrypoint() {
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT;
  // Python Agent SDK: sdk-py over any value. TypeScript SDK: sdk-ts only where unset. claude -p: sdk-cli only where unset or cli.
  // Those two keep an IDE or orchestrator parent's value: that child is not refused.
  if (ENTRYPOINTS.has(entrypoint)) return null;
  if (entrypoint?.startsWith('sdk-')) return 'the session runs headless or under an Agent SDK (CLAUDE_CODE_ENTRYPOINT starts with sdk-)';
  return 'CLAUDE_CODE_ENTRYPOINT names no entrypoint a person answers in';
}

// Why the input shows a session nobody may answer in, else null.
function unattended(input) {
  const mode = input.permission_mode;
  if (mode === 'dontAsk') return 'the session runs in dontAsk mode, which asks nobody';
  if (!ATTENDED.has(mode)) return 'the hook input names no permission mode a person answers in';
  return unattendedEntrypoint();
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
  const mode = optionMode();
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
    // A start that cannot write the state still ends away: with no file, awayEnd reads a mode other than here as away.
    if (startsAway(mode)) {
      if (mode.trim().toLowerCase() !== 'away') note = ` The plugin option mode reads "${mode}", which is not here, so the session started away.`;
      if (!dir) throw new Error('the plugin has no data folder (CLAUDE_PLUGIN_DATA), so the session cannot keep its away state');
      save({ awayUntil: SESSION });
    }
  }
  const end = awayEnd(file, now);
  const why = unattendedEntrypoint();
  say(event, { additionalContext: `${end !== null ? away(end, now) : why ? alone(why) : HERE}${note}` });
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
    // Only off ends an away sooner, so another session that types a short span cannot open the question tool.
    const current = awayEnd(file, now);
    if (current !== null && end < current) {
      say(event, { additionalContext: `/cl-workflow:away ${args.trim()} would end before the current away, so nothing changed. ${away(current, now)}` });
    } else {
      save({ awayUntil: end === Infinity ? SESSION : new Date(end).toISOString() });
      say(event, { additionalContext: away(end, now) });
    }
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
