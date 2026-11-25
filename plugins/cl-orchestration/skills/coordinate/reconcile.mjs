// Usage: node reconcile.mjs --project <path> --repo <owner/name> --default-branch <name> --log <merge log> [--settings <file>], the paths absolute; --settings defaults to ~/.claude/settings.json.
// Steps 1 to 5 of the Reconciliation (run-files.md) for one project: merged pull requests since the last `reconciled` line of the repository against the merge log, then tags, rulesets, the local git config without `branch.` lines and the hash of the settings file, each against its last recorded value. Prints { repo, baseline, since, findings, reconciled } as JSON and exits 0; without an earlier `reconciled` line it takes the baseline, steps 2 to 5 with nothing to compare.
// It writes only the config listing git-config-<owner>-<repo>.txt beside the merge log and appends one `reconciled` line to the log, after every read succeeded. A failed read prints one line, exits 1 and writes nothing.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { gitProgram } from '../../hooks/git-program.mjs';
import { REPO } from './approval.mjs';
import { escaped, isMain, json, redacted, sh } from './policy.mjs';

const BRANCH = /^(?!-)(?!.*\.\.)(?!HEAD$)[A-Za-z0-9._/-]+$/;
// The base of the next reconciliation of that repository: tag names as a JSON array, which no ASCII space splits (a ref name holds none), and two SHA-256 hashes.
const LINE = /^reconciled (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) (\S+) tags=(\[.*\]) rulesets=([0-9a-f]{64}) settings=([0-9a-f]{64}|none)$/;
// Without the last reconciliation the merges are not compared; a result of this size may be cut off.
const LIMIT = 100;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const readOrNone = (path) => { try { return readFileSync(path); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; } };

// The last `reconciled` line of repo: { at, tags, rulesets, settings }, null without one, or { unreadable: true } for a line in another format.
export function lastBase(text, repo) {
  const mine = text.split('\n').filter((line) => line.split(' ')[0] === 'reconciled' && line.split(' ')[2]?.toLowerCase() === repo.toLowerCase());
  if (!mine.length) return null;
  const found = LINE.exec(mine.at(-1));
  if (!found) return { unreadable: true };
  let tags;
  try { tags = JSON.parse(found[3]); } catch { return { unreadable: true }; }
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) return { unreadable: true };
  return { at: found[1], tags, rulesets: found[4], settings: found[5] };
}

// A merge log line names the repository and the merge commit, as a word of its own.
export const logged = (text, repo, oid) => {
  const word = new RegExp(`(^|[^0-9a-fA-F])${oid}([^0-9a-fA-F]|$)`);
  return text.split('\n').some((line) => !line.startsWith('reconciled ') && line.toLowerCase().includes(repo.toLowerCase()) && word.test(line));
};

// Lines of `git config --list` as key: sorted values, so a key set twice compares as one.
const keyed = (lines) => {
  const map = new Map();
  for (const line of lines) {
    const at = line.indexOf('=');
    const key = at < 0 ? line : line.slice(0, at);
    map.set(key, [...(map.get(key) ?? []), at < 0 ? '' : line.slice(at + 1)].sort());
  }
  return map;
};
// The keys whose values differ, never the values: one can hold a token.
export const changedKeys = (before, after) => {
  const a = keyed(before), b = keyed(after);
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))).sort();
};

const stamp = (now) => now.toISOString().replace(/\.\d{3}Z$/, 'Z');

// exec(cmd, args) gives stdout or throws. Every read comes first, so a failed one writes nothing.
export function reconcile({ project, repo, defaultBranch, log, settings, now, exec }) {
  const text = readOrNone(log)?.toString('utf8') ?? '';
  const base = lastBase(text, repo);
  const findings = [];
  if (base?.unreadable) findings.push({ kind: 'base-unreadable' });
  const known = base && !base.unreadable ? base : null;
  const since = known ? known.at.slice(0, 10) : null;

  if (known) {
    const merged = JSON.parse(exec('gh', ['pr', 'list', '-R', repo, '--state', 'merged', '--base', defaultBranch, '--search', `merged:>=${since}`, '--limit', String(LIMIT), '--json', 'number,mergeCommit,mergedAt,mergedBy']));
    if (merged.length === LIMIT) findings.push({ kind: 'possibly-cut-off', since });
    for (const pr of merged) {
      const oid = pr.mergeCommit?.oid;
      if (!oid || !logged(text, repo, oid)) findings.push({ kind: 'unlogged-merge', number: pr.number, mergeCommit: oid ?? null, mergedAt: pr.mergedAt, mergedBy: pr.mergedBy?.login ?? null });
    }
  }

  const tags = exec('gh', ['api', `repos/${repo}/tags`, '--paginate', '--jq', '.[].name']).split('\n').filter(Boolean);
  const rulesets = sha256(exec('gh', ['api', `repos/${repo}/rulesets`, '--paginate']));
  const program = gitProgram();
  if (!program) throw new Error('git is in no absolute folder of PATH');
  // -z: a value can hold a line break, which the listing writes as \n (and a backslash as \\), one setting per line.
  const config = sh(project, program, ['-C', project, 'config', '--local', '--list', '-z']).split('\0').filter((entry) => entry && !entry.startsWith('branch.'))
    .map((entry) => { const at = entry.indexOf('\n'); return at < 0 ? entry : `${entry.slice(0, at)}=${entry.slice(at + 1).replaceAll('\\', '\\\\').replaceAll('\n', '\\n')}`; });
  // Lower case, as GitHub matches owner and name: one repository, one listing.
  const [owner, name] = repo.toLowerCase().split('/');
  const listing = join(dirname(log), `git-config-${owner}-${name}.txt`);
  const before = readOrNone(listing);
  const settingsFile = readOrNone(settings);
  const settingsHash = settingsFile === undefined ? 'none' : sha256(settingsFile);

  if (known) {
    for (const tag of tags.filter((t) => !known.tags.includes(t))) findings.push({ kind: 'new-tag', name: tag });
    for (const tag of known.tags.filter((t) => !tags.includes(t))) findings.push({ kind: 'removed-tag', name: tag });
    if (rulesets !== known.rulesets) findings.push({ kind: 'rulesets-changed' });
    if (before === undefined) findings.push({ kind: 'config-listing-missing' });
    // Redacted: a subsection can hold a URL with a token in it.
    else for (const key of changedKeys(before.toString('utf8').split('\n').filter(Boolean), config)) findings.push({ kind: 'config-changed', key: redacted(key) });
    if (settingsHash !== known.settings) findings.push({ kind: 'settings-changed' });
  }

  const line = `reconciled ${stamp(now)} ${repo} tags=${json(tags)} rulesets=${rulesets} settings=${settingsHash}`;
  // The line first: a new listing without its line would hide a config change from the next run, which an old listing still shows.
  appendFileSync(log, `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`);
  writeFileSync(listing, config.map((l) => `${l}\n`).join(''));
  return { repo, baseline: !known, since, findings, reconciled: line };
}

const FLAGS = { project: { type: 'string' }, repo: { type: 'string' }, 'default-branch': { type: 'string' }, log: { type: 'string' }, settings: { type: 'string' } };

export function optionsOf(argv) {
  const { values } = parseArgs({ args: argv, options: FLAGS, strict: true });
  for (const k of ['project', 'repo', 'default-branch', 'log']) if (values[k] === undefined) throw new Error(`usage: --${k} is missing`);
  for (const k of ['project', 'log', 'settings']) if (values[k] !== undefined && !isAbsolute(values[k])) throw new Error(`usage: --${k} must be an absolute path`);
  if (!REPO.test(values.repo)) throw new Error('usage: --repo must be owner/name');
  if (!BRANCH.test(values['default-branch'])) throw new Error('usage: --default-branch is no plain branch name');
  return { project: values.project, repo: values.repo, defaultBranch: values['default-branch'], log: values.log, settings: values.settings ?? join(homedir(), '.claude', 'settings.json') };
}

if (isMain(import.meta.url)) {
  try {
    const options = optionsOf(process.argv.slice(2));
    console.log(json(reconcile({ ...options, now: new Date(), exec: (cmd, args) => sh(options.project, cmd, args) })));
  } catch (e) {
    console.error(escaped((e.stderr?.toString().trim() || e.message).split('\n')[0]));
    process.exitCode = 1;
  }
}
