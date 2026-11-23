// The window of terminal questions that /cl-workflow:ask and /cl-workflow:questions open, read by the plugin's hook (ask.mjs).

// The line a session reads while the window is closed, and the reason the hook gives when it refuses the question tool or plan mode.
export const OFF = 'Terminal questions are off: the question tool (AskUserQuestion) and plan mode (EnterPlanMode) are refused; run no chat-text interviews either (rounds of questions in plain text, as a grilling skill asks them). Put the open questions with your recommendations into one issue per task in the issue tracker the project names, else the report; take each recommendation that is safe and reversible (an item without one waits), and go on. Only the user can allow terminal questions, with /cl-workflow:ask or /cl-workflow:questions.';

const pad = (n) => String(n).padStart(2, '0');

// A local time as HH:MM, with its date when that is not today.
function clock(at, now) {
  const a = new Date(at);
  const time = `${pad(a.getHours())}:${pad(a.getMinutes())}`;
  return a.toDateString() === new Date(now).toDateString() ? time : `${a.getFullYear()}-${pad(a.getMonth() + 1)}-${pad(a.getDate())} ${time}`;
}

// /cl-workflow:questions opens the window for the rest of the session: an end of Infinity, kept as SESSION in the window file.
export const SESSION = 'session';
const lasting = (until, now) => (until === Infinity ? 'for this session' : `until ${clock(until, now)}`);

export const allowed = (until, now) => `Terminal questions are allowed ${lasting(until, now)}: /cl-workflow:ask or /cl-workflow:questions opened them, and the question tool and plan mode are refused again after that.`;

// The window's end in epoch ms: none 30 minutes, `for <n>m|h`, `until HH:MM` (next such local time); null off, undefined unread.
export function askUntil(args, now) {
  const a = args.trim().toLowerCase();
  if (a === 'off') return null;
  if (a === '') return now + 30 * 60_000;
  const span = /^for (\d{1,4}) ?(m|h)$/.exec(a);
  if (span) return now + Number(span[1]) * (span[2] === 'h' ? 3_600_000 : 60_000);
  const at = /^until ([01]?\d|2[0-3]):([0-5]\d)$/.exec(a);
  if (!at) return undefined;
  const end = new Date(now);
  end.setHours(Number(at[1]), Number(at[2]), 0, 0);
  if (end.getTime() <= now) end.setDate(end.getDate() + 1);
  return end.getTime();
}

const COUNT = /^([1-9]\d{0,2}|all)$/;
const PROJECT = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,99}$/;

// The question count and filter of /cl-workflow:questions, undefined unread. A first word of digits or all is always the count, never a project.
export function queueArgs(args) {
  const words = args.match(/\S+/g) ?? [];
  const given = /^(\d+|all)$/i.test(words[0] ?? '') ? words.shift().toLowerCase() : 'all';
  if (!COUNT.test(given) || words.length > 1) return undefined;
  const count = given === 'all' ? given : Number(given);
  if (!words.length) return { count, filter: null };
  const [word] = words;
  if (word.toLowerCase() === 'deferred') return { count, filter: 'deferred' };
  return PROJECT.test(word) ? { count, filter: { project: word } } : undefined;
}

// The line the questions skill follows.
export function queueLine({ count, filter }) {
  const asked = count !== 'all' ? `at most ${count} question${count === 1 ? '' : 's'}` : `every ${filter === 'deferred' ? 'deferred' : 'open'} question`;
  const scope = filter === null ? 'no filter' : filter === 'deferred' ? 'filter: deferred' : `local queue filter: project ${filter.project}`;
  // No closing period: a project name can end in one.
  return `Question queue: ${asked}; ${scope}`;
}
