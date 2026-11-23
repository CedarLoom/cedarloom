// The per-user log of /cl-workflow:questions runs, read by the plugin's hook (ask.mjs). It lies in the window folder, so the role guard
// refuses every session's writes to it, but any process of the same account can still change it.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The most entries one run shows.
const SHOWN = 20;

export const logFile = (windowDir) => join(windowDir, 'log', 'questions.jsonl');

// A line another version wrote or a process changed shows as it is, and never counts as a run that set the flag.
const flagged = (line) => {
  try {
    return JSON.parse(line).flag === true;
  } catch {
    return false;
  }
};

// Appends this run's entry and returns the line that shows the earlier entries since the last run that set the answer flag, that one included.
export function logRun(file, entry) {
  let lines = [];
  try {
    lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
  const since = lines.slice(Math.max(lines.findLastIndex(flagged), 0));
  const shown = since.slice(-SHOWN);
  if (!shown.length) return 'Earlier runs of /cl-workflow:questions: none in the log.';
  const omitted = since.length - shown.length;
  return `Earlier runs of /cl-workflow:questions since the last one that set the answer flag, that one included${omitted ? ` (${omitted} older not shown)` : ''}, one JSON entry per line:\n${shown.join('\n')}`;
}
