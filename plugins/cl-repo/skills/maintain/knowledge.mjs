#!/usr/bin/env node
// The maintain pass's local knowledge base in .cedarloom/knowledge/ (knowledge.md): `read` sorts the stored entries into reuse and re-check, `write` stores new ones.
// Usage, from the repository: node knowledge.mjs read | node knowledge.mjs write < entries.json
// read prints { reuse, recheck, ignored }; write takes { <kind>: [entry, ...] } on stdin and prints { written, dropped, excluded }. Exit 0 ok, 1 refused (a link in the base's path, a tracked base, a base git does not ignore), 2 bad input, 3 any other failure (git, the file system).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT, gitEnv } from '../debloat/token-budget.mjs';

export const KINDS = ['verdicts', 'tests', 'architecture', 'tools', 'questions'];
const VERDICTS = ['open', 'fixed', 'kept', 'rejected', 'issue'];
const BASE = '.cedarloom/knowledge';
const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 500;
const REJECTED_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const OBJECT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class Refused extends Error {}
export class BadInput extends Error {}

// No fsmonitor, which the repository's configuration could start; a git that hangs is killed after a minute.
const gitOptions = { env: gitEnv(), windowsHide: true, timeout: 60_000, killSignal: 'SIGKILL' };
const gitArgs = (root, args) => {
  if (!GIT) throw new Error('git is not in /usr/bin, /usr/local/bin, /opt/homebrew/bin or Program Files');
  return [GIT, ['-c', 'core.fsmonitor=false', '-C', root, ...args]];
};
const git = (root, ...args) => execFileSync(...gitArgs(root, args), { ...gitOptions, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Reads a regular file without following a link (which could lead out of the repository) or waiting on a FIFO, checked on the open file: { bytes }, or missing, other (no regular file) or large.
function readRegular(path, maxBytes = Infinity) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { missing: true };
    if (e.code === 'ELOOP') return { other: true };
    throw e;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { other: true };
    if (stat.size > maxBytes) return { large: true };
    return { bytes: readFileSync(fd) };
  } finally {
    closeSync(fd);
  }
}

// A proof file of the repository: readRegular, and missing when its folder resolves outside the repository, as through a linked folder.
function readProof(root, p) {
  const path = join(root, p);
  let folder;
  try { folder = realpathSync(dirname(path)); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { missing: true }; throw e; }
  const top = realpathSync(root);
  if (folder !== top && !folder.startsWith(top + sep)) return { missing: true };
  return readRegular(path);
}

// HEAD^{tree} stands for the files only while nothing outside the base differs from HEAD.
const clean = (root) => git(root, 'status', '--porcelain', '--untracked-files=all', '--', '.', `:(exclude)${BASE}`) === '';
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// A stored path names a file inside the repository: relative, with / separators and no .. segment.
const insidePath = (p) => nonEmpty(p) && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..') && posix.normalize(p) === p;

// A link in the base's path would let a write or a later delete of the folder leave the repository.
function refuseLinks(root) {
  for (const rel of ['.cedarloom', BASE, ...KINDS.map((k) => `${BASE}/${k}.json`)]) {
    let link = false;
    try { link = lstatSync(join(root, rel)).isSymbolicLink(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (link) throw new Refused(`${rel} is a link`);
  }
}

// The reason a verdict cannot stand, or '' when its fields are complete.
function verdictProblem(e) {
  if (!nonEmpty(e.part) || !nonEmpty(e.file) || !nonEmpty(e.name)) return 'a verdict needs part, file and name';
  if (!VERDICTS.includes(e.verdict)) return `verdict must be one of ${VERDICTS.join(', ')}`;
  if (e.verdict === 'kept' && (!nonEmpty(e.reason) || !nonEmpty(e.revisit))) return 'a kept verdict needs reason and revisit';
  if (e.verdict === 'issue' && !(Number.isInteger(e.issue) && e.issue > 0)) return 'an issue verdict needs the issue number';
  return '';
}

// The reason a stored entry is not usable, or '' when its shape holds.
function storedProblem(kind, e) {
  if (!isPlainObject(e) || !nonEmpty(e.id)) return 'no id';
  if (!OBJECT.test(e.commit ?? '') || !DATE.test(e.date ?? '')) return 'no commit or date';
  if (e.tree === undefined && !(isPlainObject(e.files) && Object.keys(e.files).length)) return 'neither files nor tree';
  if (e.files !== undefined && !(isPlainObject(e.files) && Object.entries(e.files).every(([p, h]) => insidePath(p) && SHA256.test(h)))) return 'files is not path to sha256';
  if (e.tree !== undefined && !OBJECT.test(e.tree)) return 'tree is no object name';
  return kind === 'verdicts' ? verdictProblem(e) : '';
}

// The entries of one kind's file, or the reason the whole file is ignored.
function load(root, kind) {
  const file = readRegular(join(root, BASE, `${kind}.json`), MAX_BYTES);
  if (file.missing) return { entries: [] };
  if (file.other) return { ignored: `${kind}.json is no regular file` };
  if (file.large) return { ignored: `${kind}.json is larger than 1 MiB` };
  let data;
  try { data = JSON.parse(file.bytes.toString('utf8')); } catch { return { ignored: `${kind}.json does not parse` }; }
  if (!isPlainObject(data) || !Array.isArray(data.entries)) return { ignored: `${kind}.json has no entries list` };
  return { entries: data.entries };
}

// Why a stored entry must be re-checked against the repository now, or '' when it can be reused.
function staleness(root, kind, e, tree, isClean, now) {
  const problem = storedProblem(kind, e);
  if (problem) return `invalid: ${problem}`;
  if (e.verdict === 'rejected' && now.getTime() - Date.parse(e.date) > REJECTED_DAYS * DAY_MS) return `rejected more than ${REJECTED_DAYS} days ago`;
  if (e.tree !== undefined && e.tree !== tree) return 'the tree changed';
  if (e.tree !== undefined && !isClean) return 'the working tree differs from HEAD';
  for (const [p, hash] of Object.entries(e.files ?? {})) {
    const { bytes } = readProof(root, p);
    if (!bytes) return `${p} is missing or no regular file`;
    if (sha256(bytes) !== hash) return `${p} changed`;
  }
  return '';
}

export function readBase(root, now) {
  refuseLinks(root);
  const tree = git(root, 'rev-parse', 'HEAD^{tree}');
  const isClean = clean(root);
  const out = { reuse: {}, recheck: {}, ignored: [] };
  for (const kind of KINDS) {
    const { entries, ignored } = load(root, kind);
    if (ignored) { out.ignored.push(ignored); continue; }
    out.reuse[kind] = [];
    out.recheck[kind] = [];
    for (const e of entries) {
      const why = staleness(root, kind, e, tree, isClean, now);
      if (why) out.recheck[kind].push({ id: isPlainObject(e) && nonEmpty(e.id) ? e.id : null, why });
      else out.reuse[kind].push(e);
    }
  }
  return out;
}

// One input entry as stored: files hashed now, tree recorded when asked for, commit and date of this pass.
function stored(root, kind, e, context) {
  if (!isPlainObject(e) || !nonEmpty(e.id)) throw new BadInput(`${kind}: an entry has no id`);
  const where = `${kind} ${e.id}`;
  if (e.files !== undefined && !(Array.isArray(e.files) && e.files.every(insidePath))) throw new BadInput(`${where}: files must list paths inside the repository`);
  if (e.tree !== undefined && e.tree !== true) throw new BadInput(`${where}: tree must be true or left out`);
  if (!e.files?.length && e.tree !== true) throw new BadInput(`${where}: needs files or tree, else nothing shows it is still current`);
  if (e.tree === true && !context.isClean) throw new BadInput(`${where}: tree needs a working tree that matches HEAD; commit or stash the changes, or give files`);
  const files = e.files?.length ? Object.fromEntries(e.files.map((p) => {
    const { bytes } = readProof(root, p);
    if (!bytes) throw new BadInput(`${where}: ${p} is no regular file`);
    return [p, sha256(bytes)];
  })) : undefined;
  const entry = { ...e, commit: context.commit, date: context.date };
  delete entry.files;
  delete entry.tree;
  if (files) entry.files = files;
  if (e.tree === true) entry.tree = context.tree;
  if (kind === 'verdicts') {
    const problem = verdictProblem(entry);
    if (problem) throw new BadInput(`${where}: ${problem}`);
  }
  return entry;
}

const serialized = (entries) => `${JSON.stringify({ entries }, null, 2)}\n`;
// An entry's bytes in serialized(): its lines indented by four spaces, plus the separating comma and newline.
const entryBytes = (e) => Buffer.byteLength(JSON.stringify(e, null, 2).replace(/^/gm, '    ')) + 2;
// The bytes of serialized() beyond its entries.
const FRAME = Buffer.byteLength(serialized([0])) - entryBytes(0);

// Drops the oldest entries by date (among equal dates the earlier written) until at most MAX_ENTRIES remain and the file stays within MAX_BYTES, which load() reads.
function capped(entries) {
  const oldestFirst = entries.map((e, i) => [String(e.date), i]).sort(([a, i], [b, j]) => (a < b ? -1 : a > b ? 1 : i - j)).map(([, i]) => i);
  const sizes = entries.map(entryBytes);
  let bytes = FRAME + sizes.reduce((sum, n) => sum + n, 0);
  const drop = new Set();
  for (const i of oldestFirst) {
    if (entries.length - drop.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    drop.add(i);
    bytes -= sizes[i];
  }
  return { entries: entries.filter((_, i) => !drop.has(i)), dropped: drop.size };
}

// Whether git ignores the file of every kind; check-ignore prints each ignored path and exits 0 when it printed one, 1 when none.
function allIgnored(root) {
  const paths = KINDS.map((k) => `${BASE}/${k}.json`);
  const check = spawnSync(...gitArgs(root, ['check-ignore', '--', ...paths]), { ...gitOptions, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (check.status !== 0 && check.status !== 1) throw new Error(`git check-ignore failed: ${check.error?.message ?? check.stderr.trim()}`);
  return check.stdout.split('\n').filter(Boolean).length === paths.length;
}

// Adds .cedarloom/knowledge/ to the repository's info/exclude unless git already ignores every file of the base; returns whether it added the line.
function keepLocal(root) {
  if (allIgnored(root)) return false;
  // --git-path answers relative to the repository root, or absolute in a linked worktree.
  const exclude = resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude'));
  mkdirSync(dirname(exclude), { recursive: true });
  let text = '';
  try { text = readFileSync(exclude, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}${BASE}/\n`);
  // A negation in .gitignore outranks info/exclude.
  if (!allIgnored(root)) throw new Refused(`git does not ignore ${BASE}/ even with the line in info/exclude: a .gitignore rule keeps it`);
  return true;
}

export function writeBase(root, input, now) {
  if (!isPlainObject(input)) throw new BadInput('input must be an object of kind to entries');
  for (const [kind, list] of Object.entries(input)) {
    if (!KINDS.includes(kind)) throw new BadInput(`unknown kind ${kind}; kinds: ${KINDS.join(', ')}`);
    if (!Array.isArray(list)) throw new BadInput(`${kind} must be a list of entries`);
  }
  refuseLinks(root);
  if (git(root, 'ls-files', '--', BASE)) throw new Refused(`${BASE} holds tracked files`);
  const context = { commit: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}'), isClean: clean(root), date: now.toISOString().slice(0, 10) };
  // Every entry is checked before the first write, so bad input changes nothing.
  const incoming = Object.fromEntries(Object.entries(input).map(([kind, list]) => [kind, list.map((e) => stored(root, kind, e, context))]));
  const excluded = keepLocal(root);
  const dir = join(root, BASE);
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o700);
  const out = { written: {}, dropped: {}, excluded };
  for (const [kind, list] of Object.entries(incoming)) {
    const byId = new Map((load(root, kind).entries ?? []).filter((e) => isPlainObject(e) && nonEmpty(e.id)).map((e) => [e.id, e]));
    for (const e of list) { byId.delete(e.id); byId.set(e.id, e); }
    const { entries, dropped } = capped([...byId.values()]);
    // A new file renamed over the old one replaces a link there instead of writing through it.
    const path = join(dir, `${kind}.json`);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, serialized(entries), { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
    chmodSync(path, 0o600);
    out.written[kind] = entries.length;
    out.dropped[kind] = dropped;
  }
  return out;
}

export function run(argv, { cwd, stdin, now, print }) {
  const [command, ...rest] = argv;
  if (rest.length || !['read', 'write'].includes(command)) throw new BadInput('usage: node knowledge.mjs read | node knowledge.mjs write < entries.json');
  const root = git(cwd, 'rev-parse', '--show-toplevel');
  if (command === 'read') return print(JSON.stringify(readBase(root, now), null, 2));
  let input;
  try { input = JSON.parse(stdin()); } catch (e) { throw new BadInput(`stdin is no JSON: ${e.message}`); }
  return print(JSON.stringify(writeBase(root, input, now), null, 2));
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    run(process.argv.slice(2), { cwd: process.cwd(), stdin: () => readFileSync(0, 'utf8'), now: new Date(), print: console.log });
  } catch (e) {
    console.error(e.message);
    process.exitCode = e instanceof Refused ? 1 : e instanceof BadInput ? 2 : 3;
  }
}
