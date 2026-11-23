// The question tool's switch for three hooks: UserPromptExpansion sets the window of /cl-workflow:ask and /cl-workflow:questions, PreToolUse refuses outside it, SessionStart says the mode.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { OFF, SESSION, allowed, askUntil, queueArgs, queueLine } from './window.mjs';
import { openUntil, processId, windowDir, windowFile } from './window-file.mjs';
import { logFile, logRun } from './questions-log.mjs';

const dir = windowDir();
const file = windowFile();

// Why the input shows a session nobody may answer in, else null. A mode the hook cannot read refuses too.
function unattended(input) {
  const mode = input.permission_mode;
  if (typeof mode !== 'string' || mode === '') return 'the hook input names no permission mode';
  if (mode === 'dontAsk') return 'the session runs in dontAsk mode, which asks nobody';
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli') return 'the session runs headless (CLAUDE_CODE_ENTRYPOINT=sdk-cli, as claude -p sets it)';
  return null;
}

const line = (now) => {
  const end = openUntil(file, now);
  return end === null ? OFF : allowed(end, now);
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
  if (openUntil(file, now) === null) say(event, { permissionDecision: 'deny', permissionDecisionReason: OFF });
} else if (event === 'SessionStart') {
  // A new process or a resumed conversation starts with questions off; ended windows of earlier processes go too.
  // shortcut: a quit process's session window stays (a few bytes) until a process with its id starts; prune by age if they pile up.
  if (dir && (input.source === 'startup' || input.source === 'resume')) {
    rmSync(file, { force: true });
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { /* no window was ever opened */ }
    // Window files only: rmSync without recursive throws on a folder.
    for (const entry of entries) if (entry.isFile() && openUntil(join(dir, entry.name), now) === null) rmSync(join(dir, entry.name), { force: true });
  }
  say(event, { additionalContext: line(now) });
} else if (event === 'UserPromptExpansion' && ['cl-workflow:ask', 'cl-workflow:questions'].includes(input.command_name)) {
  // A command expands alike when typed, piped to claude -p or sent as a stream-json message, and no field of this input tells
  // them apart. So /cl-workflow:questions sets no answer flag where the input shows an unattended session, role-guard.mjs
  // refuses a launch that names it, and the log shows each run to the next one.
  if (!file) throw new Error(`the plugin has no data folder (CLAUDE_PLUGIN_DATA), so /${input.command_name} cannot keep its window`);
  const args = String(input.command_args ?? '');
  const questions = input.command_name === 'cl-workflow:questions';
  const refused = questions ? unattended(input) : null;
  const queue = questions && !refused ? queueArgs(args) : undefined;
  // Running the question queue with arguments it reads in an attended session allows terminal questions for the rest of the session.
  const end = queue ? Infinity : questions ? undefined : askUntil(args, now);
  // The log entry comes first: where it cannot be written, the hook fails and sets no flag.
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? null;
  const earlier = questions
    ? logRun(logFile(dir), { time: new Date(now).toISOString(), session: input.session_id ?? null, folder: input.cwd ?? null, mode: input.permission_mode ?? null, entrypoint, pid: processId(), flag: end === Infinity })
    : null;
  if (refused) {
    say(event, { additionalContext: `/cl-workflow:questions set no answer flag and allowed no terminal questions: ${refused}. Typed into an interactive terminal session, it can set the flag. ${line(now)}` });
  } else if (end === undefined) {
    const [read, forms] = questions
      ? ['count or filter', 'alone (every open question) or as [<count>|all] [deferred|<project>], with a count from 1 to 999']
      : ['window', 'alone (30 minutes), for 30m, for 2h, until 14:30 or off'];
    say(event, { additionalContext: `/${input.command_name} read no ${read} in "${args}", so nothing changed: use it ${forms}. ${line(now)}` });
  } else if (end === null || end <= now) {
    rmSync(file, { force: true });
    say(event, { additionalContext: OFF });
  } else {
    mkdirSync(dir, { recursive: true });
    // The flag lets this session, and no other, write answers into the local question queue (role-guard.mjs).
    writeFileSync(file, `${JSON.stringify({ askUntil: end === Infinity ? SESSION : new Date(end).toISOString(), questions: questions || undefined })}\n`);
    say(event, { additionalContext: queue ? `${allowed(end, now)}\n${queueLine(queue)}\n${earlier}` : allowed(end, now) });
  }
}
