// Usage: node precheck.mjs [--prompts <folder>] <project paths...>. Sample precheck for a scheduled coordinator run: exit 0 when a project has an issue to pick or a planner or worker result in <folder> is unread, else 1. It starts and merges nothing.
// node precheck.mjs --catch-up <clone> [--state <folder>]: the project bot's catch-up precheck (catch-up.mjs).
// Pickable: open, carries startLabel and every issues.labels entry, not labeled cl:needs-human (an owner question), cl:in-progress (a worker holds it) or cl:deferred (the owner parked it), written by a trusted author (the repository owner, a trustedAuthors login, or a member or collaborator with write access), and no pull request for it: none merged or open in the repository with a head branch <type>/<number>-<slug> (an open one from a fork does not count, since anyone can open it).
// An issue that several of the given projects list starts in none of them: it is printed once on stderr, as "several projects: <owner/repo>#<number> (<paths>)".
// Unread: a planner or worker prompt file in the project bot's prompts folder whose result file exists; the pick sweep deletes the prompt file once it read the result (bot-project.md, Start). Each is printed on stderr as "<folder>: <reason>".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { errorLine, escaped, isMain, json, read, sh } from './policy.mjs';

// MEMBER is any member of the owning organization and COLLABORATOR any invited collaborator: either may have only the Read role, so each counts only with write access.
const ASSOCIATED = ['MEMBER', 'COLLABORATOR'];

// writes(login): true when the login has write access to repo, as the REST API's legacy permission (maintain reads as write). exec(cmd, args) gives stdout or throws; a failed lookup throws, so nobody counts on a guess.
export const writers = (repo, exec) => {
  const known = new Map();
  return (login) => {
    if (typeof login !== 'string' || !/^[A-Za-z0-9_-]+$/.test(login)) return false;
    if (!known.has(login)) known.set(login, ['admin', 'write'].includes(JSON.parse(exec('gh', ['api', `repos/${repo}/collaborators/${login}/permission`])).permission));
    return known.get(login);
  };
};

// The trust decision for an issue or a comment of the REST API: its author is the repository owner, a trustedAuthors login, or a member or collaborator with write access.
export const trusts = (policy, writes) => {
  const trusted = new Set(policy.trustedAuthors ?? []);
  return (i) => i.author_association === 'OWNER' || trusted.has(i.user?.login) || (ASSOCIATED.includes(i.author_association) && writes(i.user?.login));
};

// An issue with one of these waits for the owner, also after it gained the start label, is held by a worker or is parked.
const HELD = ['cl:needs-human', 'cl:in-progress', 'cl:deferred'];

// writes(login) is asked last, so only for an issue that is pickable otherwise.
export function pickable(policy, issues, pulls, writes = () => false) {
  if (!policy?.startLabel) return [];
  const labels = [policy.startLabel, ...(policy.issues?.labels ?? [])];
  return issues
    .filter((i) => !i.pull_request)
    .filter((i) => labels.every((label) => i.labels.some((l) => l.name.toLowerCase() === label.toLowerCase())))
    .filter((i) => !i.labels.some((l) => HELD.includes(l.name.toLowerCase())))
    .filter((i) => !pulls.some((p) => p.headRefName.includes(`/${i.number}-`)))
    .filter(trusts(policy, writes))
    .map((i) => i.number);
}

const LOCAL = 'origin is a local path or a file: URL: gh would list the repository of the same path on its own host';
// { host, scp } of an origin URL: the host of a URL with a scheme, or the name before the colon of [user@]host:path. Only a URL that every reader splits the same way gives a host: user text that holds @ / ? # \ or a space, where git, curl and a browser disagree, gives none, and neither does a local path. No error holds the URL, which can carry a credential.
function hostOf(url) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const host = /^(?!file:)[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#\\\s]*@)?([a-z0-9._-]+)(?::\d*)?(?:[/?#]|$)/i.exec(url)?.[1];
    if (!host) throw new Error(/^file:/i.test(url) ? LOCAL : "origin's URL names no host that can be compared with the one gh asks");
    return { host: host.toLowerCase(), scp: false };
  }
  // A drive letter is a local path on Windows.
  const host = /^[a-z]:[\\/]/i.test(url) ? null : /^(?:[^@/:\\\s]+@)?([a-z0-9._-]+):/i.exec(url)?.[1];
  if (!host) throw new Error(LOCAL);
  return { host: host.toLowerCase(), scp: true };
}

// gh resolves a bare `gh pr list` and {owner}/{repo} through an upstream remote or a set default; the policy came from origin, so origin's repository is named.
// gh asks github.com, or the host GH_HOST names: for an origin on another host it would list the repository of the same path there.
export const originRepo = (dir, run, env = process.env) => {
  const url = run(dir, 'git', ['remote', 'get-url', 'origin']).trim();
  const repo = /[:/]([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url)?.[1];
  if (!repo || /\/\.\.?$/.test(repo)) throw new Error("origin's URL names no repository as owner/repo");
  const { host, scp } = hostOf(url), gh = (env.GH_HOST || 'github.com').toLowerCase();
  // An alias of ~/.ssh/config names no host: a name without a dot, or gh's host, a hyphen and a suffix without one (github.com-work).
  const alias = scp && !(host.startsWith(`${gh}-`) ? host.slice(gh.length) : host).includes('.');
  // ssh.github.com is github.com's ssh endpoint on port 443.
  if (!alias && host !== gh && !(gh === 'github.com' && host === 'ssh.github.com')) throw new Error(`origin's URL names the host ${host}, and gh asks ${gh}: set GH_HOST for an origin on another host`);
  return repo;
};

// { tracker, numbers }: the repository that holds the project's issues and the pickable ones; no tracker is read without a startLabel.
function picks(dir, run, env) {
  const { policy, errors, warnings = [] } = read(dir, run);
  // Thrown, so the command line names the project and why nothing starts there, as it does for a failed command.
  if (!policy) throw new Error(errors.map(errorLine).join('; '));
  if (!policy.startLabel) return { tracker: null, numbers: [], warnings };
  const repo = originRepo(dir, run, env);
  const labels = [policy.startLabel, ...policy.issues.labels].map(encodeURIComponent).join(',');
  const issues = JSON.parse(run(dir, 'gh', ['api', '--paginate', '--slurp', `repos/${repo}/issues?state=open&per_page=100&labels=${labels}`])).flat();
  const pulls = JSON.parse(run(dir, 'gh', ['pr', 'list', '-R', repo, '--state', 'all', '--limit', '1000', '--json', 'headRefName,state,isCrossRepository']))
    .filter((p) => p.state === 'MERGED' || (p.state !== 'CLOSED' && !p.isCrossRepository));
  return { tracker: repo, numbers: pickable(policy, issues, pulls, writers(repo, (cmd, args) => run(dir, cmd, args))), warnings };
}

export const check = (dir, run = sh, env = process.env) => picks(dir, run, env).numbers;

// A label per project does not make the labels distinct: an issue listed for two projects would get a worker in each. lists: [{ dir, tracker, numbers }]; shared: [{ tracker, number, dirs }].
export function distinct(lists) {
  const key = (tracker, number) => `${tracker.toLowerCase()}#${number}`;
  const seen = new Map();
  for (const { dir, tracker, numbers } of lists) for (const number of numbers) {
    const had = seen.get(key(tracker, number));
    seen.set(key(tracker, number), { tracker: had?.tracker ?? tracker, number, dirs: [...(had?.dirs ?? []), dir] });
  }
  const shared = [...seen.values()].filter(({ dirs }) => dirs.length > 1);
  const gone = new Set(shared.map(({ tracker, number }) => key(tracker, number)));
  return { lists: lists.map((list) => ({ ...list, numbers: list.numbers.filter((number) => !gone.has(key(list.tracker, number))) })), shared };
}

// A role bot run's prompt file name, <repo>-<n>-<role>-<round>-<run id>-<k>.md, and the line that names its result file: the last one, since the spec before it may hold such a line.
const PROMPT = /-(planner|worker|reviewer|fixer|maintainer)-\d+-\d{8}T\d{6}Z-[0-9a-f]{6}-[1-9]\d*\.md$/;
const RESULT_LINE = /^Result file: (.+)$/gm;

// The reasons that the planner and worker runs of folder have an unread result. A file that cannot be read or checked, or an empty result (a write not done), counts too, so a person sees it. Reviewer and fixer results are read through their state files (catch-up.mjs, condition 7).
export function unread(folder) {
  let names;
  try { names = readdirSync(folder); } catch (e) { return e.code === 'ENOENT' ? [] : [`the folder is unreadable (${e.code})`]; }
  const found = [];
  for (const name of names.filter((n) => !n.startsWith('.')).sort()) {
    const role = PROMPT.exec(name)?.[1];
    if (!role) { found.push(`${name} is no role bot prompt file`); continue; }
    if (role !== 'planner' && role !== 'worker') continue;
    let file;
    try { file = [...readFileSync(join(folder, name), 'utf8').matchAll(RESULT_LINE)].at(-1)?.[1]; } catch (e) { found.push(`${name} is unreadable (${e.code})`); continue; }
    if (!file || !isAbsolute(file)) { found.push(`${name} names no absolute result file`); continue; }
    let stat;
    try { stat = statSync(file); } catch (e) { if (e.code !== 'ENOENT') found.push(`${name}: its result file is unreadable (${e.code})`); continue; }
    if (!stat.isFile()) found.push(`${name}: its result file is no file`);
    else found.push(stat.size ? `${name}: the ${role} result is unread` : `${name}: its result file is empty`);
  }
  return found;
}

// What the command line prints and its exit code: { out, err, code }. pick(dir) gives a project's { tracker, numbers, warnings } or throws why nothing starts there; results are the lines on unread results, each of which starts the run.
export function report(dirs, pick, results = []) {
  const found = [], err = [];
  for (const dir of dirs) {
    try {
      const { warnings = [], ...list } = pick(dir);
      found.push({ dir, ...list });
      for (const warning of warnings) err.push(`${dir}: ${errorLine(warning)}`);
    } catch (e) { err.push(`${dir}: ${e.message.split('\n')[0]}`); }
  }
  const { lists, shared } = distinct(found);
  for (const { tracker, number, dirs: listing } of shared) err.push(`several projects: ${tracker}#${number} (${listing.join(', ')})`);
  err.push(...results);
  // Oldest first, which is the lowest number.
  const out = lists.filter(({ numbers }) => numbers.length).map(({ dir, numbers }) => `${dir}: ${[...numbers].sort((a, b) => a - b).map((n) => `#${n}`).join(' ')}`);
  return { out: out.map((line) => escaped(line)), err: err.map((line) => escaped(line)), code: out.length || results.length ? 0 : 1 };
}

// { dirs, prompts }: the project paths and the prompts folder; another option fails, so an old schedule's arguments are not read as a path.
export function argsOf(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { prompts: { type: 'string' } }, allowPositionals: true });
  return { dirs: positionals, prompts: values.prompts };
}

if (isMain(import.meta.url) && process.argv.slice(2).includes('--catch-up')) {
  // catch-up.mjs imports this file: an await here would wait on itself, so the import resolves after this file is done.
  import('./catch-up.mjs').then(({ catchUpLine }) => {
    const { line, code } = catchUpLine(process.argv.slice(2).filter((a) => a !== '--catch-up'));
    console.log(line);
    process.exit(code);
  }, (e) => {
    // A catch-up precheck that fails starts the run, which reports it.
    console.log(json({ start: true, condition: 'failed', reason: e.message.split('\n')[0], probe: false }));
    process.exit(0);
  });
} else if (isMain(import.meta.url)) {
  let dirs, prompts;
  try { ({ dirs, prompts } = argsOf(process.argv.slice(2))); } catch (e) { console.error(e.message); process.exit(1); }
  if (!dirs.length) { console.error('usage: node precheck.mjs [--prompts <folder>] <project paths...>'); process.exit(1); }
  const results = prompts === undefined ? [] : unread(prompts).map((reason) => `${prompts}: ${reason}`);
  const { out, err, code } = report(dirs, (dir) => picks(dir, sh, process.env), results);
  for (const line of err) console.error(line);
  for (const line of out) console.log(line);
  process.exit(code);
}
