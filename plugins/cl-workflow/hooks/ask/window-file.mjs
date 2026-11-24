// The window file of this Claude Code process, read alike by the plugin's hooks ask.mjs and role-guard.mjs: {"awayUntil": <ISO time or SESSION>}
// while away, {"answers": true} once /cl-workflow:away off set the answer flag, none while here without it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION } from './window.mjs';

// One file per Claude Code process (CLAUDE_PID, which it sets for hook commands): /clear and compaction keep the state.
export const windowDir = () => (process.env.CLAUDE_PLUGIN_DATA ? join(process.env.CLAUDE_PLUGIN_DATA, 'ask') : null);
export const processId = () => process.env.CLAUDE_PID ?? String(process.ppid);
export const windowFile = () => { const dir = windowDir(); return dir && join(dir, `${processId()}.json`); };

// The plugin option mode, which Claude Code exports only once the option is saved (it does not fill the manifest default for hooks).
export const optionMode = () => process.env.CLAUDE_PLUGIN_OPTION_MODE;
// Unset is here; any value but here, a typo too, starts away: coming back is one command, a job that waits for an answer is not.
export const startsAway = (mode) => mode !== undefined && mode.trim().toLowerCase() !== 'here';

const read = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

// The end of a window file's away span while it lasts (Infinity until off), else null. No file is here, unless the mode starts
// away (the start could not write it); state it cannot read is away until off.
export function awayEnd(path, now, mode = optionMode()) {
  let window;
  try {
    window = JSON.parse(readFileSync(path ?? '', 'utf8'));
  } catch (error) {
    return error.code === 'ENOENT' && !startsAway(mode) ? null : Infinity;
  }
  if (window?.answers === true && Object.keys(window).length === 1) return null;
  const until = window?.awayUntil;
  if (until === SESSION) return Infinity;
  const end = typeof until === 'string' ? Date.parse(until) : NaN;
  // Only the ISO time save() writes is read; any other value is away until off.
  if (Number.isNaN(end) || new Date(end).toISOString() !== until) return Infinity;
  return end > now ? end : null;
}

// Whether /cl-workflow:away off set the answer flag that lets this session write answers into the local question queue.
export const answerFlag = (path) => read(path)?.answers === true;
