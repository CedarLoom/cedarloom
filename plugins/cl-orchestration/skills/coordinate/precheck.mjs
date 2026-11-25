// Usage: node precheck.mjs [--prompts <folder>] <project paths...>. Sample precheck for a scheduled coordinator run: exit 0 when a project has an issue to pick or a builder's build result in <folder> is unread, else 1. It starts and merges nothing.
// node precheck.mjs --catch-up <clone> [--state <folder>]: the project bot's catch-up precheck (catch-up.mjs).
// node precheck.mjs --host-limit <n> --working <m> [--reserve <prompt file> --result <result file> --lock <folder>] <prompts folders...>: the host limit before a start (bot-project.md, Start). It prints each unfinished role bot run in the folders, of every project bot on the host, and exits 0 when one more start fits within <n> beside <m> working Orca workers, 1 when not, 2 when it cannot count. With --reserve it counts and, when the start fits, creates the prompt file, both while it holds the lock folder, which every project bot on the host names alike.
// Pickable: open, carries startLabel and every issues.labels entry, not labeled cl:needs-human (an owner question), cl:in-progress (a worker holds it) or cl:deferred (the owner parked it), named by no question that waits for the owner (approval.mjs waiting), written by a trusted author (the repository owner, a trustedAuthors login, or a member or collaborator with write access), and no pull request for it: none merged or open in the repository with a head branch <type>/<number>-<slug> (an open one from a fork does not count, since anyone can open it).
// An issue that several of the given projects list starts in none of them: it is printed once on stderr, as "several projects: <owner/repo>#<number> (<paths>)".
// Unread: the prompt file of a builder run in round 0 (a build or plan from the spec, before its pull request) in the project bot's prompts folder whose result file holds text; the pick sweep deletes the prompt file once it read the result (bot-project.md, Start). Each is printed on stderr as "<folder>: <reason>".
import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readQueue, waiting } from './approval.mjs';
import { errorLine, escaped, isMain, json, read, sh } from './policy.mjs';
import { unique } from './state.mjs';

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

// Whether the author of an issue that gh issue list printed may ask a question: a trustedAuthors login or one with write access. gh prints an App as app/<slug>, which trustedAuthors names as <slug>[bot].
export const asks = (policy, writes) => (i) => {
  const login = i.author?.login?.replace(/^app\/(.+)$/, '$1[bot]');
  return (policy.trustedAuthors ?? []).includes(login) || writes(login);
};

// An issue with one of these waits for the owner, also after it gained the start label, is held by a worker or is parked.
const HELD = ['cl:needs-human', 'cl:in-progress', 'cl:deferred'];

// writes(login) is asked last, so only for an issue that is pickable otherwise. held: the numbers an open question waits on.
export function pickable(policy, issues, pulls, writes = () => false, held = new Set()) {
  if (!policy?.startLabel) return [];
  const labels = [policy.startLabel, ...(policy.issues?.labels ?? [])];
  return issues
    .filter((i) => !i.pull_request)
    .filter((i) => labels.every((label) => i.labels.some((l) => l.name.toLowerCase() === label.toLowerCase())))
    .filter((i) => !i.labels.some((l) => HELD.includes(l.name.toLowerCase())) && !held.has(i.number))
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

// GitHub's Priority issue field, highest first; an issue without it, or with another option, comes after Low.
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const rank = (option) => {
  const i = PRIORITIES.indexOf(option?.toLowerCase());
  return i < 0 ? PRIORITIES.length : i;
};

// { <number>: <option> }: the Priority issue field of each of the numbered issues of repo, read through GraphQL since the REST issue carries no issue fields. An API without issue fields (a schema error that names them) gives {}, so the order stays oldest first; any other failure throws. exec(cmd, args) gives stdout or throws.
export function priorities(repo, numbers, exec) {
  if (!numbers.length) return {};
  const [owner, name] = repo.split('/');
  const fields = 'issueFieldValues(first: 50) { nodes { ... on IssueFieldSingleSelectValue { name field { ... on IssueFieldSingleSelect { name } } } } }';
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${numbers.map((n) => `i${n}: issue(number: ${n}) { number ${fields} }`).join(' ')} } }`;
  let out;
  try { out = exec('gh', ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`]); } catch (e) {
    // stderr, not the message, which quotes the query.
    if (/issueField/i.test(String(e.stderr ?? ''))) return {};
    throw e;
  }
  const found = {};
  for (const issue of Object.values(JSON.parse(out).data.repository)) {
    const value = (issue?.issueFieldValues?.nodes ?? []).find((v) => v.field?.name?.toLowerCase() === 'priority');
    if (value) found[issue.number] = value.name;
  }
  return found;
}

// { tracker, numbers, priority }: the repository that holds the project's issues, the pickable ones and their Priority field; no tracker is read without a startLabel.
function picks(dir, run, env, queue) {
  const { policy, errors, warnings = [] } = read(dir, run);
  // Thrown, so the command line names the project and why nothing starts there, as it does for a failed command.
  if (!policy) throw new Error(errors.map(errorLine).join('; '));
  if (!policy.startLabel) return { tracker: null, numbers: [], warnings };
  const repo = originRepo(dir, run, env);
  const labels = [policy.startLabel, ...policy.issues.labels].map(encodeURIComponent).join(',');
  const issues = JSON.parse(run(dir, 'gh', ['api', '--paginate', '--slurp', `repos/${repo}/issues?state=open&per_page=100&labels=${labels}`])).flat();
  const pulls = JSON.parse(run(dir, 'gh', ['pr', 'list', '-R', repo, '--state', 'all', '--limit', '1000', '--json', 'headRefName,state,isCrossRepository']))
    .filter((p) => p.state === 'MERGED' || (p.state !== 'CLOSED' && !p.isCrossRepository));
  const writes = writers(repo, (cmd, args) => run(dir, cmd, args));
  const listed = (...filter) => JSON.parse(run(dir, 'gh', ['issue', 'list', '-R', repo, ...filter, '--state', 'open', '--limit', '1000', '--json', 'number,labels,comments,author,body']));
  // An answered question has lost cl:needs-human, and a new one may not be in the search index yet: both lists count.
  // Only a trusted author's question holds an issue back: anyone can open an issue that names one.
  const asked = [...listed('--label', 'cl:needs-human'), ...listed('--search', `"Issue: ${repo}#" in:body`)].filter(asks(policy, writes));
  const held = waiting(repo, asked, queue(), writes);
  // An answer that names no single option row holds its issue too: the line says why it is not picked.
  const said = [...held].sort((a, b) => a - b).map((n) => ({ rule: 'question', message: `a question without an answer that releases it holds ${repo}#${n}` }));
  const numbers = pickable(policy, issues, pulls, writes, held);
  return { tracker: repo, numbers, priority: priorities(repo, numbers, (cmd, args) => run(dir, cmd, args)), warnings: [...warnings, ...said] };
}

// queue() lists the local questions as approval.mjs queue does.
export const check = (dir, run = sh, env = process.env, queue = readQueue) => picks(dir, run, env, queue).numbers;

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
const PROMPT = /-(builder|reviewer|maintain)-(\d+)-\d{8}T\d{6}Z-[0-9a-f]{6}-[1-9]\d*\.md$/;
const RESULT_LINE = /^Result file: (.+)$/gm;

// shortcut: a fixed window of two ticks, since stallMinutes is read per project only after the precheck. Past it, a file the precheck cannot check is the sweep's to report, and no longer starts it every tick.
const CANNOT_CHECK_MS = 60 * 60_000;

// Milliseconds since file changed; one that stat cannot read counts as new, so it stays named.
function age(file, now) {
  try { return now - statSync(file).mtimeMs; } catch { return 0; }
}

// The reasons that the round 0 builder runs of folder have an unread result. A missing or unreadable folder counts too, and so does a file that cannot be read or checked while it or its result file changed within CANNOT_CHECK_MS, so a person sees it. An empty result file is a write not done, like a missing one. Reviewer results and the builder's fix rounds are read through their state files (catch-up.mjs, condition 7).
export function unread(folder, now = Date.now()) {
  let names;
  try { names = readdirSync(folder); } catch (e) { return [e.code === 'ENOENT' ? 'the folder does not exist' : `the folder is unreadable (${e.code})`]; }
  const found = [];
  for (const name of names.filter((n) => !n.startsWith('.')).sort()) {
    const cannot = (reason, ...files) => { if ([join(folder, name), ...files].some((f) => age(f, now) < CANNOT_CHECK_MS)) found.push(reason); };
    const [, role, round] = PROMPT.exec(name) ?? [];
    if (!role) { cannot(`${name} is no role bot prompt file`); continue; }
    if (role !== 'builder' || round !== '0') continue;
    let file;
    try { file = [...readFileSync(join(folder, name), 'utf8').matchAll(RESULT_LINE)].at(-1)?.[1]; } catch (e) { cannot(`${name} is unreadable (${e.code})`); continue; }
    if (!file || !isAbsolute(file)) { cannot(`${name} names no absolute result file`); continue; }
    let stat;
    try { stat = statSync(file); } catch (e) { if (e.code !== 'ENOENT') cannot(`${name}: its result file is unreadable (${e.code})`); continue; }
    if (!stat.isFile()) cannot(`${name}: its result file is no file`, file);
    else if (stat.size) found.push(`${name}: the ${role} result is unread`);
  }
  return found;
}

// The unfinished role bot runs of the project bots whose prompts folders are given, as "<folder>/<name>": each prompt file whose result file holds no text. A prompt file whose result line is missing counts too, so a start waits until the pick sweep reports it; a file or folder that cannot be read throws.
export function unfinished(folders) {
  const found = [];
  for (const folder of folders) for (const name of readdirSync(folder).filter((n) => PROMPT.test(n)).sort()) {
    const file = [...readFileSync(join(folder, name), 'utf8').matchAll(RESULT_LINE)].at(-1)?.[1];
    let done = false;
    if (file && isAbsolute(file)) try { const stat = statSync(file); done = stat.isFile() && stat.size > 0; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!done) found.push(join(folder, name));
  }
  return found;
}

// { limit, working, folders, reserve, result, lock } of the --host-limit command line; a count that is no whole number fails, so a typo never lifts the limit.
export function hostArgs(argv) {
  const options = { 'host-limit': { type: 'string' }, working: { type: 'string' }, reserve: { type: 'string' }, result: { type: 'string' }, lock: { type: 'string' } };
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const [limit, working] = [values['host-limit'], values.working].map((v) => (/^\d+$/.test(v ?? '') ? Number(v) : NaN));
  const { reserve, result, lock } = values;
  const given = [reserve, result, lock].filter((v) => v !== undefined).length;
  if (Number.isNaN(limit) || Number.isNaN(working) || (given && given < 3)) throw new Error('usage: node precheck.mjs --host-limit <n> --working <m> [--reserve <prompt file> --result <result file> --lock <folder>] <prompts folders...>');
  if (given && (!PROMPT.test(basename(reserve)) || !positionals.some((f) => resolve(f) === resolve(dirname(reserve))) || !isAbsolute(result) || !isAbsolute(lock))) throw new Error('--reserve names no role bot prompt file in a given folder, or --result or --lock no absolute path');
  return { limit, working, folders: positionals, reserve, result, lock };
}

// The host-wide lock of the count and the reservation, so one start at a time counts and creates its prompt file: a folder that holds one empty file named by its holder's token. A start takes it by renaming a folder of its own onto the path, which fails while a holder's folder is there, since a rename replaces only an empty folder. Nothing moves a holder's folder, so the path is never free while the lock is held.
const LOCK_STALE_MS = 30_000, LOCK_WAIT_MS = 10_000;
const own = (lock, token) => `${lock}-new-${token}`;

// A new token, its folder beside lock holding its token file. The folder that holds the lock is made on first use, so no bot home needs to hold it.
export function lockToken(lock) {
  const token = unique();
  mkdirSync(own(lock, token), { recursive: true });
  writeFileSync(join(own(lock, token), token), '');
  return token;
}

// One try to take lock with token: true when taken. A token file older than LOCK_STALE_MS was left by a run that died holding the lock: removing that very file empties the folder for the next try, and of two starts that saw it, one removes it and neither touches a lock taken since.
export function tryLock(lock, token, now) {
  try { renameSync(own(lock, token), lock); return true; } catch (e) { if (e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e; }
  let names = [];
  try { names = readdirSync(lock); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const name of names) {
    try { if (now() - statSync(join(lock, name)).mtimeMs > LOCK_STALE_MS) unlinkSync(join(lock, name)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return false;
}

// Frees the lock taken with token: its token file, then the folder, which stays when another start took the lock after a stale check removed that file.
export function unlock(lock, token) {
  try { unlinkSync(join(lock, token)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { rmdirSync(lock); } catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
}

function locked(lock, now, fn) {
  const token = lockToken(lock), until = now() + LOCK_WAIT_MS;
  try {
    while (!tryLock(lock, token, now)) {
      if (now() > until) throw new Error(`the host limit lock ${lock} is held`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  } catch (e) { rmSync(own(lock, token), { recursive: true, force: true }); throw e; }
  try { return fn(); } finally { unlock(lock, token); }
}

// { runs, fits }: with reserve, the count and the placeholder prompt file (its result line only) are one step under the lock, so starts at the same time never pass the limit; the project bot then writes the prompt into that file, which counts as unfinished meanwhile.
export function reserveStart({ limit, working, folders, reserve, lock, result }, now = Date.now) {
  const count = () => { const runs = unfinished(folders); return { runs, fits: working + runs.length < limit }; };
  if (reserve === undefined) return count();
  return locked(lock, now, () => {
    const got = count();
    if (got.fits) writeFileSync(reserve, `Result file: ${result}\n`, { flag: 'wx' });
    return got;
  });
}

// What the command line prints and its exit code: { out, err, code }. pick(dir) gives a project's { tracker, numbers, priority, warnings } or throws why nothing starts there; results are the lines on unread results, each of which starts the run.
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
  // By Priority, then oldest first, which is the lowest number; each number with a level is followed by it from PRIORITIES, never the field's own text.
  const level = (option) => (rank(option) < PRIORITIES.length ? ` (${PRIORITIES[rank(option)]})` : '');
  const out = lists.filter(({ numbers }) => numbers.length).map(({ dir, numbers, priority = {} }) => `${dir}: ${[...numbers].sort((a, b) => rank(priority[a]) - rank(priority[b]) || a - b).map((n) => `#${n}${level(priority[n])}`).join(' ')}`);
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
} else if (isMain(import.meta.url) && process.argv.slice(2).some((a) => a.startsWith('--host-limit'))) {
  let runs, fits;
  try { ({ runs, fits } = reserveStart(hostArgs(process.argv.slice(2)))); } catch (e) { console.error(escaped(e.message.split('\n')[0])); process.exit(2); }
  for (const run of runs) console.log(escaped(run));
  process.exit(fits ? 0 : 1);
} else if (isMain(import.meta.url)) {
  let dirs, prompts;
  try { ({ dirs, prompts } = argsOf(process.argv.slice(2))); } catch (e) { console.error(e.message); process.exit(1); }
  if (!dirs.length) { console.error('usage: node precheck.mjs [--prompts <folder>] <project paths...>'); process.exit(1); }
  const results = prompts === undefined ? [] : unread(prompts).map((reason) => `${prompts}: ${reason}`);
  const { out, err, code } = report(dirs, (dir) => picks(dir, sh, process.env, readQueue), results);
  for (const line of err) console.error(line);
  for (const line of out) console.log(line);
  process.exit(code);
}
