// The away state that /cl-workflow:away sets and the plugin option mode starts a session in, read by the plugin's hook (ask.mjs).

const pad = (n) => String(n).padStart(2, '0');

// A local time as HH:MM, with its date when that is not today.
function clock(at, now) {
  const a = new Date(at);
  const time = `${pad(a.getHours())}:${pad(a.getMinutes())}`;
  return a.toDateString() === new Date(now).toDateString() ? time : `${a.getFullYear()}-${pad(a.getMonth() + 1)}-${pad(a.getDate())} ${time}`;
}

// Away without a span lasts until off: an end of Infinity, kept as SESSION in the window file.
export const SESSION = 'session';

const RULE = 'the question tool (AskUserQuestion) and plan mode (EnterPlanMode) are refused; run no chat-text interviews either (rounds of questions in plain text, as a grilling skill asks them). Put the open questions with your recommendations into one issue per task in the issue tracker the project names, else the report; take each recommendation that is safe and reversible (an item without one waits), and go on.';

// The line a session reads while away, and the reason the hook gives when it refuses the question tool or plan mode.
export const away = (until, now) => `Away ${until === Infinity ? 'until /cl-workflow:away off' : `until ${clock(until, now)}`}: ${RULE} Only the user comes back, with /cl-workflow:away off.`;
export const alone = (why) => `Nobody answers in this session (${why}): ${RULE}`;

export const HERE = 'Here: the user answers terminal questions (the question tool and plan mode). /cl-workflow:away [span] works alone.';

export const FORMS = '/cl-workflow:away alone (until off), 30 or 30m (minutes), 2h, until 07:30 (local time), or off';

// The end of an away span in epoch ms: none Infinity, `<n>[m|h]` (minutes without a unit, a span of 0 unread), `until HH:MM` (next such local time); null off, undefined unread.
export function awayUntil(args, now) {
  const a = args.trim().toLowerCase();
  if (a === 'off') return null;
  if (a === '') return Infinity;
  const span = /^(\d{1,4}) ?(m|h)?$/.exec(a);
  if (span) return Number(span[1]) === 0 ? undefined : now + Number(span[1]) * (span[2] === 'h' ? 3_600_000 : 60_000);
  const at = /^until ([01]?\d|2[0-3]):([0-5]\d)$/.exec(a);
  if (!at) return undefined;
  const end = new Date(now);
  end.setHours(Number(at[1]), Number(at[2]), 0, 0);
  if (end.getTime() <= now) end.setDate(end.getDate() + 1);
  return end.getTime();
}

// The most queued questions /cl-workflow:away off asks.
export const QUEUE_COUNT = 5;
export const QUEUE_LINE = `Question queue: at most ${QUEUE_COUNT} questions; no filter`;
