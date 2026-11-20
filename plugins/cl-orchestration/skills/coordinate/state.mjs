// A project bot's state folder, <bot home>/state/: per pull request pr-<n>.json, then tip.json, red-main.json, merge-log.md and the merge lock, which only merge.mjs takes.
// pr-<n>.json: repo, pr, issue, branch, project (the bot's checkout of the repository), dispatches, reviewedHead, reviewUrl, riskClass, round, claim, trialBase, updatedAt (the bot's last update of the branch), mergeCommandAt, mergedAt, held (why it waits for the owner), rules, clones (scratch clones, the newest last), runs and handled ({ head, action }: the last head the bot judged and its verdict's next).
// Each entry of dispatches and runs: { startedAt, resultFile, result }, resultFile naming a headless job's result file, result set once the bot read the result.
// tip.json: { sha, firstSeen, passed }, the default branch's tip, when the bot first saw it, and the last tip whose watch passed. red-main.json: { sha, report, pr }, the red tip, its report and the pull request the answered report named.
// answered.json: ["<file> <at>"...], the answered local questions (approval.mjs queue) the bot acted on. claim-<n>-<head>: the folder a review claim makes. counts-<day>.json: count() below.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const TIP = 'tip.json';
export const RED_MAIN = 'red-main.json';
export const LOG = 'merge-log.md';
const LOCK = 'lock';
const HOLDER = 'holder.json';
// A merge holds the lock for seconds to a few minutes; one older than this was left behind.
export const LOCK_LIMIT = 15 * 60_000;

export const isPrFile = (name) => /^pr-[1-9]\d*\.json$/.test(name);

const text = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
// The parsed file, or null for a missing or unreadable one: the caller rebuilds it or fails closed.
export const readState = (path) => { try { return JSON.parse(text(path) ?? 'null'); } catch { return null; } };

const unique = () => `${process.pid}-${randomBytes(6).toString('hex')}`;
// Per project and UTC day: runs of the project bot, worker starts (a role bot run counts as one), and runs per pull request, after which it is held for the owner.
export const LIMITS = { runs: 320, workerStarts: 120, prRuns: 12 };
const COUNTED = ['runs', 'workerStarts', 'catchUp'];
const countable = (n) => Number.isInteger(n) && n >= 0;
// The counts of now's UTC day, counts-<YYYY-MM-DD>.json: { runs, workerStarts, catchUp (catch-up runs), prs: { <n>: runs } }; a day without a file counts zero. add's counts, its runs also for add.pr, are added and written first.
// An unreadable or malformed file throws, so a limit never resets unseen.
// shortcut: two runs that count at the same moment can lose one count (read, then rename); count under the lock if runs ever overlap often.
export function count(state, now, add = {}) {
  const file = join(state, `counts-${now.toISOString().slice(0, 10)}.json`);
  let counts = { runs: 0, workerStarts: 0, catchUp: 0, prs: {} };
  try { counts = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`${basename(file)} is unreadable`); }
  if (!COUNTED.every((k) => countable(counts?.[k])) || typeof counts.prs !== 'object' || !counts.prs || !Object.values(counts.prs).every(countable)) throw new Error(`${basename(file)} holds no counts`);
  if (!Object.keys(add).length) return counts;
  const added = { ...counts, prs: { ...counts.prs } };
  for (const k of COUNTED) added[k] += add[k] ?? 0;
  if (add.pr) added.prs[add.pr] = (added.prs[add.pr] ?? 0) + (add.runs ?? 0);
  writeState(file, added);
  return added;
}

// A temporary file in the same folder, then a rename: a reader finds the old file or the new one, never a part of either. Gives the text written.
export function writeState(path, value) {
  const tmp = join(dirname(path), `.${basename(path)}.${unique()}.tmp`), body = `${JSON.stringify(value, null, 2)}\n`;
  try {
    writeFileSync(tmp, body, { flag: 'wx' });
    renameSync(tmp, path);
    return body;
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export const appendLog = (state, line) => appendFileSync(join(state, LOG), `${line}\n`);
// An unreadable log counts as one without the line, so a merge command time without it keeps pausing merges.
export const logged = (state, repo, pr) => (text(join(state, LOG)) ?? '').split('\n').some((line) => line.includes(` ${repo} #${pr} `));

// A process's start time, which tells a reused process id from the holder: null when no process has that id, undefined when it cannot be read (macOS's sandbox refuses to run the setuid ps).
export function processStart(pid) {
  if (process.platform === 'linux') {
    // Field 22 of /proc/<pid>/stat, in clock ticks since boot; the fields start after the command name's closing parenthesis.
    let stat;
    try { stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? null : undefined; }
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? undefined;
  }
  const r = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 10_000, killSignal: 'SIGKILL', windowsHide: true });
  if (r.error) return undefined;
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

const holderOf = (raw) => {
  try {
    const h = JSON.parse(raw ?? '');
    // Process id 0 or a negative one would make kill() test a whole process group.
    return Number.isInteger(h.pid) && h.pid > 0 && (typeof h.start === 'string' || h.start === null) && !Number.isNaN(Date.parse(h.takenAt)) ? h : null;
  } catch { return null; }
};
// Gone: no process has the holder's id, or one with another start time. A process the caller may not see (EPERM) or a start time either side could not read counts as running: the age still ends the lock.
const gone = (h) => {
  try { process.kill(h.pid, 0); } catch (e) { if (e.code === 'ESRCH') return true; if (e.code !== 'EPERM') throw e; }
  const start = processStart(h.pid);
  return typeof start === 'string' && typeof h.start === 'string' && start !== h.start;
};

// null when no lock is taken, else { holder, raw, stale }: raw is the holder file's text (null when unreadable), which removeLock compares. A lock without a readable holder is held until the folder is LOCK_LIMIT old.
export function inspectLock(state, now = new Date()) {
  const dir = join(state, LOCK);
  let made;
  try { made = lstatSync(dir).mtimeMs; } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const raw = text(join(dir, HOLDER)), holder = holderOf(raw);
  const age = now.getTime() - (holder ? Date.parse(holder.takenAt) : made);
  return { holder, raw, stale: age > LOCK_LIMIT || (holder !== null && gone(holder)) };
}

// The holder file's text, or null when the lock is taken already. mkdir is atomic: of two runs one gets the folder.
export function takeLock(state, { pr, head }, now = new Date()) {
  const holder = { pid: process.pid, start: processStart(process.pid) ?? null, pr, head, takenAt: now.toISOString() };
  const dir = join(state, LOCK);
  try { mkdirSync(dir); } catch (e) { if (e.code === 'EEXIST') return null; throw e; }
  try {
    return writeState(join(dir, HOLDER), holder);
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

// Removes the lock whose holder text is raw, as read before; true when removed. The rename makes the lock free in one step; a holder other than the one read (the lock was taken again meanwhile) is put back and gives false.
export function removeLock(state, raw) {
  const dir = join(state, LOCK), moved = join(state, `${LOCK}-removed-${unique()}`);
  try { renameSync(dir, moved); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (text(join(moved, HOLDER)) === raw) {
    rmSync(moved, { recursive: true, force: true });
    return true;
  }
  try { renameSync(moved, dir); } catch (e) { throw new Error(`the lock of another run is at ${moved} and could not be put back: ${e.code}`); }
  return false;
}
