// The window file of this Claude Code process, read alike by the plugin's hooks ask.mjs and role-guard.mjs: {"awayUntil": <ISO time or SESSION>}
// while away, {"answers": true} once /cl-workflow:away off set the answer flag, none while here without it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION } from './window.mjs';

// One file per Claude Code process (CLAUDE_PID, which it sets for hook commands): /clear and compaction keep the state.
export const windowDir = () => (process.env.CLAUDE_PLUGIN_DATA ? join(process.env.CLAUDE_PLUGIN_DATA, 'ask') : null);
export const processId = () => process.env.CLAUDE_PID ?? String(process.ppid);
export const windowFile = () => { const dir = windowDir(); return dir && join(dir, `${processId()}.json`); };

const read = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

// The end of a window file's away span while it lasts (Infinity until off), else null.
export function awayEnd(path, now) {
  const window = read(path);
  if (typeof window?.awayUntil !== 'string') return null;
  const end = window.awayUntil === SESSION ? Infinity : Date.parse(window.awayUntil);
  return end > now ? end : null;
}

// Whether /cl-workflow:away off set the answer flag that lets this session write answers into the local question queue.
export const answerFlag = (path) => read(path)?.answers === true;
