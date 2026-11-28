// Usage: USAGE below. The command line the bot procedures run, so a run types no code: count (startRun, startWorker), read, write (update, append), decide, rebuild and unlock; each prints one JSON line.
// A project bot's state folder, <bot home>/state/: per pull request pr-<n>.json, then tip.json, red-main.json, merge-log.md and the merge lock, which only merge.mjs takes; <file>.lock is a state file's write lock and <file>.lock-new-<token> a writer's folder before it takes it (change).
// pr-<n>.json: version (one up with each write, from the time of its rebuild in milliseconds: change), repo, pr, issue, branch, project (the bot's checkout of the repository), dispatches, reviewedHead, reviewUrl, riskClass, round, claim, trialBase, updatedAt (the bot's last update of the branch), mergeCommandAt, mergedAt, held (why it waits for the owner), cappedOn (the UTC day the pull request reached its run limit), rules, clones (scratch clones, the newest last), runs and handled ({ head, action }: the last head the bot judged and its verdict's next).
// Each entry of dispatches and runs: { startedAt, head, role, resultFile, result }, head the head it started for, role builder or reviewer for a role bot run in runs, worker, reviewer or fixer for an Orca worker in dispatches, resultFile naming a headless job's result file, result set once the bot read the result.
// tip.json: { sha, firstSeen, passed }, the default branch's tip, when the bot first saw it, and the last tip whose watch passed. red-main.json: { sha, report, pr }, the red tip, its report and the pull request the answered report named.
// answered.json: ["<file> <at>" or "#<n> <at>"...], each owner answer the bot acted on, of a local question (approval.mjs queue) or of issue n (approval.mjs answer). pending.json: ["#<n>"...], each issue whose answer a run took on, written before approval.mjs apply changes its labels. claim-<n>-<head>: the folder a review claim makes. counts-<day>.json: count() below. probe-<day>.json and failed-<day>.json: the catch-up run's daily probe and reported precheck failure. maintain.json: decide() below.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { escaped, isMain, json } from './policy.mjs';

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
const MISSING = Symbol('missing'), UNREADABLE = Symbol('unreadable');
// The parsed file, MISSING or UNREADABLE (no JSON object or array); an error other than a missing file throws.
function load(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return MISSING; throw e; }
  try { const value = JSON.parse(raw); return value !== null && typeof value === 'object' ? value : UNREADABLE; } catch { return UNREADABLE; }
}
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// pr-<n>.json holds an object: other JSON in it is UNREADABLE, so the run rebuilds it.
const loadPr = (path) => { const value = load(path); return value === MISSING || isRecord(value) ? value : UNREADABLE; };

export const unique = () => `${process.pid}-${randomBytes(6).toString('hex')}`;
// Per project and UTC day: runs of the project bot, worker starts (a role bot run counts as one), and runs per pull request, after which the catch-up counts that pull request for no condition until the UTC day ends.
export const LIMITS = { runs: 320, workerStarts: 120, prRuns: 12 };
const COUNTED = ['runs', 'workerStarts', 'catchUp'];
const countable = (n) => Number.isInteger(n) && n >= 0;
// The counts of now's UTC day, counts-<YYYY-MM-DD>.json: { runs, workerStarts, catchUp (catch-up runs), prs: { <n>: runs } }; a day without a file counts zero. add's counts, its runs also for add.pr, are added and written first; counts that are no non-negative integers, or a pr that is no positive one, throw and write nothing.
// An unreadable or malformed file throws, so a limit never resets unseen.
// shortcut: two runs that count at the same moment can lose one count (read, then rename); count under the lock if runs ever overlap often.
export function count(state, now, add = {}) {
  if (!COUNTED.every((k) => add[k] === undefined || countable(add[k])) || !(add.pr === undefined || (Number.isInteger(add.pr) && add.pr > 0))) throw new Error('count: add holds no counts');
  const file = join(state, `counts-${now.toISOString().slice(0, 10)}.json`);
  let counts = { runs: 0, workerStarts: 0, catchUp: 0, prs: {} };
  try { counts = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`${basename(file)} is unreadable`); }
  if (!COUNTED.every((k) => countable(counts?.[k])) || typeof counts.prs !== 'object' || !counts.prs || Array.isArray(counts.prs) || !Object.values(counts.prs).every(countable)) throw new Error(`${basename(file)} holds no counts`);
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

const day = (now) => now.toISOString().slice(0, 10);

// A project bot run's start: none at the daily limit of runs or worker starts. A run about pull request pr that had LIMITS.prRuns runs today counts { runs: 1 } and stops, and sets that pull request's cappedOn to the day (change, which decides report too); report is true unless cappedOn named the day already. Else it counts { runs: 1, pr, catchUp }.
export function startRun(state, now, { pr, catchUp = false } = {}) {
  const counts = count(state, now);
  if (counts.runs >= LIMITS.runs) return { go: false, limit: 'runs' };
  if (counts.workerStarts >= LIMITS.workerStarts) return { go: false, limit: 'workerStarts' };
  const add = { runs: 1, ...(catchUp && { catchUp: 1 }) };
  if (pr === undefined || (counts.prs[pr] ?? 0) < LIMITS.prRuns) {
    count(state, now, { ...add, ...(pr !== undefined && { pr }) });
    return { go: true };
  }
  count(state, now, add);
  let report = true;
  change(join(state, `pr-${pr}.json`), (current) => {
    if (current?.cappedOn === day(now)) report = false;
    return current && report ? { ...current, cappedOn: day(now) } : null;
  });
  return { go: false, limit: 'prRuns', report };
}

// One worker start or role bot run: none at LIMITS.workerStarts today, else it counts { workerStarts: 1 }.
export function startWorker(state, now) {
  if (count(state, now).workerStarts >= LIMITS.workerStarts) return { go: false, limit: 'workerStarts' };
  count(state, now, { workerStarts: 1 });
  return { go: true };
}

const WRITE_TRIES = 200;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const holderIn = (file) => { try { const h = JSON.parse(readFileSync(file, 'utf8')); return Number.isInteger(h.pid) && h.pid > 0 && (typeof h.start === 'string' || h.start === null) ? h : null; } catch { return null; } };

// A state file's write lock: the folder <file>.lock holding one file named by its holder's token, which holds { pid, start }. A writer takes it by renaming a folder of its own, holding its token file, onto the path; the rename fails while a token file is there, since it replaces only an empty folder.
// Only a token whose process is gone is removed, by its own name, so a lock taken since is never touched and a live holder keeps the lock however long it pauses. A lock held through WRITE_TRIES waits throws.
function writeLocked(path, fn, sleep) {
  const lock = `${path}.lock`, token = unique(), own = `${lock}-new-${token}`;
  try {
    mkdirSync(own);
    writeFileSync(join(own, token), JSON.stringify({ pid: process.pid, start: processStart(process.pid) ?? null }));
    for (let tries = 0; ; tries++) {
      try { renameSync(own, lock); break; } catch (e) { if (e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e; }
      if (tries >= WRITE_TRIES) throw new Error(`${basename(path)} is locked by another write`);
      let names = [];
      try { names = readdirSync(lock); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      for (const name of names) {
        const holder = holderIn(join(lock, name));
        if (holder && gone(holder)) rmSync(join(lock, name), { force: true });
      }
      sleep(10);
    }
  } catch (e) { rmSync(own, { recursive: true, force: true }); throw e; }
  try {
    // A writer that died before its rename left its own folder: gone once its holder is.
    const prefix = `${basename(lock)}-new-`;
    for (const name of readdirSync(dirname(path)).filter((n) => n.startsWith(prefix))) {
      const holder = holderIn(join(dirname(path), name, name.slice(prefix.length)));
      if (holder && gone(holder)) rmSync(join(dirname(path), name), { recursive: true, force: true });
    }
    return fn();
  } finally {
    rmSync(join(lock, token), { force: true });
    try { rmdirSync(lock); } catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
  }
}

// Replaces the object in the state file at path with next(current, unreadable), read under the file's write lock, so another run's write between the read and the replace is never lost. current is null for a missing file or one that holds no object (then unreadable is true); next gives null to write nothing.
// Each write counts version up by one from the file's, or from next's for a file without one (rebuild), which update compares. Gives the object written, or null.
export function change(path, next, { sleep = pause } = {}) {
  return writeLocked(path, () => {
    const loaded = load(path), current = isRecord(loaded) ? loaded : null;
    const value = next(current, loaded !== MISSING && current === null);
    if (value === null) return null;
    const written = { ...value, version: ((current ?? value).version ?? 0) + 1 };
    writeState(path, written);
    return written;
  }, sleep);
}

// Sets the fields of an object in the state file at path (change). A fields version is the one the caller read: another write since refuses the fields, so a decision taken on an older read is taken again, never written over another run's (a runs entry, held). A missing file starts empty; an unreadable one throws: rebuild it first.
// Gives { written, version }, version the file's after the call.
export function update(path, fields, options) {
  if (!isRecord(fields)) throw new Error('update: the fields are no JSON object');
  if (fields.version !== undefined && !(Number.isInteger(fields.version) && fields.version >= 0)) throw new Error('update: the version is no count');
  let version;
  const written = change(path, (current, unreadable) => {
    if (unreadable) throw new Error(`${basename(path)} is unreadable: rebuild it first`);
    version = current?.version ?? 0;
    return fields.version === undefined || fields.version === version ? { ...current, ...fields } : null;
  }, options);
  return { written: written !== null, version: written?.version ?? version };
}

// Adds entry to the list in the state file at path (answered.json, pending.json) unless it lists it; a missing file starts empty. Gives true when added.
// Under the file's write lock, as change() writes: two runs that add at once would else drop one entry.
export function append(path, entry, { sleep = pause } = {}) {
  if (typeof entry !== 'string' || !entry.trim() || /\p{Cc}/u.test(entry)) throw new Error('append: the entry is no single line');
  return writeLocked(path, () => {
    const current = load(path);
    if (current !== MISSING && !Array.isArray(current)) throw new Error(`${basename(path)} holds no list`);
    const list = current === MISSING ? [] : current;
    if (list.includes(entry)) return false;
    writeState(path, [...list, entry]);
    return true;
  }, sleep);
}

// pr-<pr>.json rebuilt from fields the run gathered (the pull request, its reviews and claim comment, worker-list, automations list), through change. Its version starts after now in milliseconds, so a version read before the rebuild never comes back. A file that was unreadable, or fields whose pull request merged (mergedAt) with no merge log line, also get mergeCommandAt and held "state rebuilt", which pause every merge until the owner's answer. A readable file is never replaced. Gives { held }.
export function rebuild(state, pr, fields, now, options) {
  if (!Number.isInteger(pr) || pr < 1) throw new Error('rebuild: no pull request number');
  if (!isRecord(fields) || fields.pr !== pr || typeof fields.repo !== 'string' || !/^\S+\/\S+$/.test(fields.repo)) throw new Error(`rebuild: the fields name no repo and pr ${pr}`);
  const path = join(state, `pr-${pr}.json`);
  let held;
  change(path, (current, unreadable) => {
    if (current) throw new Error(`${basename(path)} is readable: nothing to rebuild`);
    held = unreadable || (fields.mergedAt != null && !logged(state, fields.repo, pr));
    return { ...fields, version: now.getTime(), ...(held && { mergeCommandAt: now.toISOString(), held: 'state rebuilt' }) };
  }, options);
  return { held };
}

// The owner's answer to a maintain question in maintain.json, { <id>: { approved, issue } } by the maintain bot's finding id: each id of ids is decided, approved when approved lists it.
// approved null is a Hold, which decides none: its findings stay open and come back in a later maintain result. Gives the ids decided.
export function decide(state, ids, approved) {
  if (approved === null) return [];
  const path = join(state, 'maintain.json');
  const known = readState(path) ?? {};
  for (const id of ids) known[id] = { ...known[id], approved: approved.includes(id) };
  writeState(path, known);
  return ids;
}

export const appendLog = (state, line) => appendFileSync(join(state, LOG), `${line}\n`);
// An unreadable log counts as one without the line, so a merge command time without it keeps pausing merges.
export const logged = (state, repo, pr) => (text(join(state, LOG)) ?? '').split('\n').some((line) => line.includes(` ${repo} #${pr} `));

// A process's start time, which tells a reused process id from the holder: null when no process has that id, undefined when it cannot be read (ps did not run).
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

// Catch-up condition 1: the lock removed when it is still stale, reading its holder once more. Gives { removed, holder }.
export function unlock(state, now = new Date()) {
  const lock = inspectLock(state, now);
  if (!lock?.stale) return { removed: false, holder: lock?.holder ?? null };
  return { removed: removeLock(state, lock.raw), holder: lock.holder };
}

const USAGE = 'usage: node state.mjs count <state> [--pr <n>] [--catch-up] | count <state> --worker | read <file> | write <file> <fields file> | write <file> --add <entry> | decide <state> --ids <id,...> (--approved <id,...> | --hold) | rebuild <state> <n> <fields file> | unlock <state>';
const list = (value) => (value ? value.split(',') : []);
const ID = /^[\w.-]+$/;
const fieldsOf = (file) => {
  const fields = load(file);
  if (!isRecord(fields)) throw new Error(`${basename(file)} holds no JSON object`);
  return fields;
};

// Prints a JSON line; exit 1 for a start the limits refuse, a state file to rebuild or a write whose version another write passed, 2 for an error, which changes nothing.
export function main(argv, now = new Date()) {
  const [command, ...args] = argv;
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { pr: { type: 'string' }, 'catch-up': { type: 'boolean' }, worker: { type: 'boolean' }, add: { type: 'string' }, ids: { type: 'string' }, approved: { type: 'string' }, hold: { type: 'boolean' } } });
  const [target, second, third] = positionals, given = Object.keys(values);
  const shape = (count, ...flags) => { if (positionals.length !== count || given.some((k) => !flags.includes(k))) throw new Error(USAGE); };
  if (command === 'count') {
    shape(1, 'pr', 'catch-up', 'worker');
    if (values.worker && given.length > 1) throw new Error(USAGE);
    const pr = values.pr === undefined ? undefined : Number(values.pr);
    if (pr !== undefined && !(Number.isInteger(pr) && pr > 0)) throw new Error(`--pr ${escaped(values.pr)} is no pull request number`);
    const result = values.worker ? startWorker(target, now) : startRun(target, now, { pr, catchUp: values['catch-up'] });
    return { out: result, code: result.go ? 0 : 1 };
  }
  if (command === 'read') {
    shape(1);
    const value = isPrFile(basename(target)) ? loadPr(target) : load(target);
    if (value === MISSING || value === UNREADABLE) return { out: { rebuild: value === MISSING ? 'missing' : 'unreadable' }, code: 1 };
    return { out: value, code: 0 };
  }
  if (command === 'write') {
    if (values.add !== undefined) { shape(1, 'add'); return { out: { added: append(target, values.add) }, code: 0 }; }
    shape(2);
    const fields = fieldsOf(second);
    if (isPrFile(basename(target)) && fields.version === undefined) throw new Error(`${basename(second)} names no version: the one the last state read or write of ${basename(target)} printed`);
    const result = update(target, fields);
    return { out: result, code: result.written ? 0 : 1 };
  }
  if (command === 'decide') {
    shape(1, 'ids', 'approved', 'hold');
    const ids = list(values.ids), approved = values.hold ? null : list(values.approved);
    if (!ids.length || !ids.every((id) => ID.test(id)) || Boolean(values.hold) === (values.approved !== undefined) || (approved && !approved.every((id) => ids.includes(id)))) throw new Error(USAGE);
    return { out: { decided: decide(target, ids, approved) }, code: 0 };
  }
  if (command === 'rebuild') {
    shape(3);
    return { out: rebuild(target, Number(second), fieldsOf(third), now), code: 0 };
  }
  if (command === 'unlock') {
    shape(1);
    return { out: unlock(target, now), code: 0 };
  }
  throw new Error(USAGE);
}

if (isMain(import.meta.url)) {
  try {
    const { out, code } = main(process.argv.slice(2));
    console.log(json(out));
    process.exitCode = code;
  } catch (e) {
    console.error(escaped(e.message));
    process.exitCode = 2;
  }
}
