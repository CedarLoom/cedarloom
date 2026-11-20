// Usage, the paths absolute, each flag once unless it says "repeated":
//   node commit-push.mjs sync --project <path> --worktree <path> --branch <name> [--merge]
//   node commit-push.mjs commit --project <path> --worktree <path> --repo <owner/name> --branch <name> --default-branch <name> --message <file> --file <path> (repeated) --owned <path> (repeated) [--merged <sha>] [--title <text> --body <file>]
//   node commit-push.mjs supervised --project <path> --worktree <path> --repo <owner/name> --branch <name> --default-branch <name> --commit <sha> --owned <path> (repeated) [--title <text> --body <file>]
// Commit and push of modes.md for a worker's worktree. sync is steps 4 and 5: it merges origin's branch (with --merge, origin's default branch, without a commit) into the worktree and prints { merged, conflicts }. commit is steps 1 to 3 for an automatic worker: it checks the base and the staged files, commits from the message file, checks that commit, pushes it, opens the draft pull request when --title and --body are given (the first round) and prints { commit, pullRequest }; --merged names the sha sync merged, for a merge round. supervised checks a supervised worker's reported commit and every file it publishes, then pushes and opens the pull request the same way.
// Every refusal, and every failed command, prints one line naming its step and exits 1; nothing is pushed before every check passed.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';
import { gitProgram } from '../../hooks/git-program.mjs';
import { REPO } from './approval.mjs';
import { escaped, isMain, json, OWN, redacted, redirecting, settings, sh } from './policy.mjs';
import { linkedWorktree } from './worker-settings.mjs';

const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\.)(?!.*\.lock$)(?!HEAD$)[A-Za-z0-9._/-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;

// A check that fails names the step of modes.md it belongs to.
class Refused extends Error {
  constructor(step, message) {
    // Escaped here, so a path with a line break still ends as one line.
    super(escaped(message));
    this.step = step;
  }
}
const refuse = (step, message) => { throw new Refused(step, message); };
// A command that fails is a refusal of the step that ran it.
const failure = (e) => (e.stderr?.toString().trim() || e.message).split('\n')[0];
const during = (step, fn) => { try { return fn(); } catch (e) { if (e instanceof Refused) throw e; return refuse(step, failure(e)); } };

// Missing gives undefined; a link, a FIFO or a folder is refused, so the read neither follows nor waits. One descriptor for the check and the read: the worker can swap the path between two calls.
const plainFile = (step, path) => {
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    if (e.code === 'ELOOP') refuse(step, `${path} is not a regular file`);
    throw e;
  }
  try {
    if (!fstatSync(fd).isFile()) refuse(step, `${path} is not a regular file`);
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
};

// The worktree's folder in the shared .git, after the reads of modes.md: git would otherwise load configuration, and so commands, that the worker wrote.
export function checkWorktree(project, worktree) {
  const step = 'commondir';
  during(step, () => {
    // The folder git opens, each link followed before a `..` applies: a lexical resolve could read a decoy.
    const { commonDir: common, folder } = linkedWorktree(worktree, project, (path) => plainFile(step, path) ?? refuse(step, `${path} is missing`));
    if (plainFile(step, join(folder, 'commondir'))?.replace(/\n$/, '') !== '../..') refuse(step, "the worktree's commondir does not hold ../..");
    // An empty file is accepted: the Linux sandbox binds one over each deny path that does not exist while another worker's command runs.
    if (plainFile(step, join(folder, 'config.worktree'))) refuse(step, "the worktree's config.worktree is not empty");
    if (lstatSync(join(common, 'commondir'), { throwIfNoEntry: false })) refuse(step, 'the shared .git holds a commondir');
  });
}

// git in the worktree with no hook, no fsmonitor, no ext:: remote and no replace object: each would run or show what the worker wrote.
export const gitIn = (worktree, program = gitProgram()) => {
  if (!program) refuse('git', 'git is in no absolute folder of PATH');
  return (...args) => sh(worktree, program, ['--no-replace-objects', '-C', worktree, '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', ...args]);
};
// Keys of the repository's own config, which the worker shares, that make a merge, commit or push run a command or send it elsewhere, beside those the policy reader refuses.
const RUNS = /^(hook\..*|filter\..*|merge\..*\.driver|diff\.external|diff\..*\.(command|textconv)|gpg(\..*)?\.program|gpg\.ssh\.defaultkeycommand|core\.(pager|editor|askpass|alternaterefscommand|gitproxy)|remote\.origin\.(pushurl|push))$/i;
// Returns git with each hook.<name> of the user's or system's config turned off: core.hooksPath does not reach those (git 2.54).
function checkConfig(git) {
  const found = settings(during('config', () => git('config', '--show-scope', '-z', '--list')));
  const refused = [...new Set([...redirecting(found), ...found.filter(([scope, key]) => OWN.includes(scope) && RUNS.test(key)).map(([, key]) => redacted(key))])];
  if (refused.length) refuse('config', `the repository's own git config sets ${refused.join(', ')}, which can run a command or send the push elsewhere`);
  const hooks = [...new Set(found.map(([, key]) => /^hook\.(.+)\.[^.]+$/is.exec(key)?.[1]).filter((name) => name !== undefined))];
  // -c splits at the first =, so such a name could not be turned off.
  if (hooks.some((name) => name.includes('='))) refuse('config', 'git config defines a hook whose name holds =, which -c cannot turn off');
  const off = hooks.flatMap((name) => ['-c', `hook.${name}.enabled=false`]);
  return (...args) => git(...off, ...args);
}
const names = (output) => output.split('\0').filter(Boolean);
const sameSet = (a, b) => { const x = new Set(a), y = new Set(b); return x.size === y.size && [...x].every((v) => y.has(v)); };
const under = (file, entry) => { const folder = entry.replace(/\/$/, ''); return file === folder || file.startsWith(`${folder}/`); };

// Step 2's rule: no path under .github/ (in any letter case, as macOS opens it), every path under an owned entry.
function ownedOnly(step, files, owned) {
  const github = files.find((file) => file.toLowerCase().startsWith('.github/'));
  if (github !== undefined) refuse(step, `${github} is under .github/, which is the owner's`);
  const outside = files.find((file) => !owned.some((entry) => under(file, entry)));
  if (outside !== undefined) refuse(step, `${outside} is in no owned path`);
}

// The sha origin's branch points at, or undefined while origin has no such branch.
const remoteTip = (git, branch) => git('ls-remote', 'origin', `refs/heads/${branch}`).split('\n').find((line) => line.endsWith(`\trefs/heads/${branch}`))?.split('\t')[0];

// GitHub's compare of sha with ref: identical or ahead means origin's ref holds sha.
const onOrigin = (exec, repo, sha, ref) => ['identical', 'ahead'].includes(exec('gh', ['api', `repos/${repo}/compare/${sha}...${ref}`, '--jq', '.status']).trim());

// Steps 4 and 5: origin's branch (or default branch) merged into the worktree, the sha ls-remote printed and not a ref the worker can move.
export function sync({ project, worktree, branch, merge = false }, gitInW = gitIn(worktree)) {
  checkWorktree(project, worktree);
  const step = merge ? 'step 5' : 'step 4';
  const git = checkConfig(gitInW);
  const sha = during(step, () => remoteTip(git, branch)) ?? refuse(step, `origin has no branch ${branch}`);
  during(step, () => git('fetch', '--quiet', '--no-tags', '--no-recurse-submodules', 'origin', `refs/heads/${branch}`));
  if (!merge) {
    during(step, () => git('merge', '--quiet', '--ff-only', sha));
    return { merged: sha, conflicts: false };
  }
  // Already in HEAD: --no-ff would have nothing to merge, so there is no merge round.
  try { git('merge-base', '--is-ancestor', sha, 'HEAD'); return { merged: null, conflicts: false }; } catch (e) { if (e.status !== 1) refuse(step, failure(e)); }
  // --no-ff: a fast-forward would leave no merge to commit, and step 3 checks two parents.
  let conflicts = false;
  // Exit 1 is a conflict for the worker to resolve; the MERGE_HEAD check below tells it from a merge that did not start.
  try { git('merge', '--quiet', '--no-commit', '--no-ff', sha); } catch (e) { if (e.status !== 1) refuse(step, failure(e)); conflicts = true; }
  const head = during(step, () => git('rev-parse', '--verify', 'MERGE_HEAD').trim());
  if (head !== sha) refuse(step, `MERGE_HEAD is ${head}, not the merged ${sha}`);
  return { merged: sha, conflicts };
}

// The end of step 3: the checked sha pushed, never HEAD, and on the first round the draft pull request.
function publish(git, exec, { repo, branch, defaultBranch, title, body }, sha) {
  // No tag and no submodule commit beside the checked one, whatever push.followTags or push.recurseSubmodules say.
  during('push', () => git('push', '--quiet', '--no-follow-tags', '--no-recurse-submodules', 'origin', `${sha}:refs/heads/${branch}`));
  if (title === undefined) return { commit: sha, pullRequest: null };
  // The push is done by now, so the line names the pushed sha.
  const url = during(`pull request after the push of ${sha}`, () => exec('gh', ['pr', 'create', '-R', repo, '--draft', '--base', defaultBranch, '--head', branch, '--title', title, '--body-file', body]).trim());
  return { commit: sha, pullRequest: url };
}

// gh runs in the run folder, never the worktree: it reads the git config of its working folder, and -R and --head name all it needs.
const ghOutside = (options) => (cmd, args) => sh(dirname(options.body ?? options.message), cmd, args);

// Steps 1 to 3 for an automatic worker's staged change. exec runs gh, gitInW runs git in the worktree (gitIn).
export function commit(options, exec = ghOutside(options), gitInW = gitIn(options.worktree)) {
  const { project, worktree, repo, branch, defaultBranch, message, files, owned, merged } = options;
  checkWorktree(project, worktree);
  const git = checkConfig(gitInW);
  const base = during('step 1', () => git('rev-parse', '--verify', 'HEAD^{commit}').trim());
  const ref = during('step 1', () => remoteTip(git, branch)) === undefined ? defaultBranch : branch;
  if (!during('step 1', () => onOrigin(exec, repo, base, ref))) refuse('step 1', `HEAD ${base} is no commit of origin's ${ref}`);
  if (merged !== undefined) {
    const head = during('step 1', () => git('rev-parse', '--verify', 'MERGE_HEAD').trim());
    if (head !== merged) refuse('step 1', `MERGE_HEAD is ${head}, not the merged ${merged}`);
    if (!during('step 1', () => onOrigin(exec, repo, merged, defaultBranch))) refuse('step 1', `the merged ${merged} is no commit of origin's ${defaultBranch}`);
  }
  const against = merged ?? base;
  // --ignore-submodules=none: the worker's .gitmodules or a diff.ignoreSubmodules would hide a changed gitlink.
  const staged = names(during('step 2', () => git('diff', '--cached', '--no-renames', '--ignore-submodules=none', '--name-only', '-z', ...(merged ? [merged] : []))));
  if (!staged.length) refuse('step 2', 'nothing is staged');
  // git commit would take the author of the commit a CHERRY_PICK_HEAD names, which the worker can write.
  let picking = true;
  try { git('rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD'); } catch (e) { if (e.status !== 1) refuse('step 2', failure(e)); picking = false; }
  if (picking) refuse('step 2', 'a CHERRY_PICK_HEAD is set, whose author git commit would take');
  ownedOnly('step 2', staged, owned);
  if (!sameSet(staged, files)) refuse('step 2', `the staged files ${staged.join(', ')} are not the reported ${files.join(', ')}`);
  during('step 3', () => git('commit', '--quiet', '-F', message));
  // Read once: the worker can move HEAD, so every check and the push take this sha.
  const sha = during('step 3', () => git('rev-parse', '--verify', 'HEAD^{commit}').trim());
  // The raw commit, never rev-list or log: a grafts file changes the parents they show.
  const raw = during('step 3', () => git('cat-file', 'commit', sha));
  const parents = raw.slice(0, raw.indexOf('\n\n')).split('\n').filter((line) => line.startsWith('parent ')).map((line) => line.slice('parent '.length));
  const want = merged ? [base, merged] : [base];
  if (parents.join(' ') !== want.join(' ')) refuse('step 3', `commit ${sha} has the parents ${parents.join(' ') || 'none'}, not ${want.join(' ')}`);
  const committed = names(during('step 3', () => git('diff', '--no-renames', '--ignore-submodules=none', '--name-only', '-z', against, sha)));
  if (!sameSet(committed, staged)) refuse('step 3', `commit ${sha} changes ${committed.join(', ')}, not the checked ${staged.join(', ')}`);
  return publish(git, exec, options, sha);
}

// The supervised paragraph: the reported commit is the branch's, and every file any of its commits touches is owned.
export function supervised(options, exec = ghOutside(options)) {
  const { project, worktree, branch, defaultBranch, commit: reported, owned } = options;
  const step = 'supervised';
  checkWorktree(project, worktree);
  const git = checkConfig(gitIn(worktree));
  const sha = during(step, () => git('rev-parse', '--verify', `refs/heads/${branch}^{commit}`).trim());
  if (sha !== reported) refuse(step, `refs/heads/${branch} is ${sha}, not the reported ${reported}`);
  // The sha ls-remote printed, not the tracking ref, which the worker can move.
  const tip = during(step, () => remoteTip(git, defaultBranch)) ?? refuse(step, `origin has no branch ${defaultBranch}`);
  during(step, () => git('fetch', '--quiet', '--no-tags', '--no-recurse-submodules', 'origin', `refs/heads/${defaultBranch}`));
  // The diff covers the branch as a whole; the log covers a file one commit adds and a later one removes, and with --cc the files a merge's resolution changed.
  const files = [...new Set([
    ...names(during(step, () => git('diff', '--no-renames', '--ignore-submodules=none', '--name-only', '-z', `${tip}...${sha}`))),
    // --no-show-signature: log.showSignature would add lines read as file names.
    ...names(during(step, () => git('log', '--format=', '--name-only', '--cc', '--no-renames', '--ignore-submodules=none', '--no-show-signature', '-z', `${tip}..${sha}`))),
  ])];
  if (!files.length) refuse(step, `${sha} changes no file against origin's ${defaultBranch}`);
  ownedOnly(step, files, owned);
  return publish(git, exec, options, sha);
}

const FLAGS = {
  project: { type: 'string' }, worktree: { type: 'string' }, repo: { type: 'string' }, branch: { type: 'string' }, 'default-branch': { type: 'string' },
  message: { type: 'string' }, file: { type: 'string', multiple: true }, owned: { type: 'string', multiple: true }, merged: { type: 'string' },
  commit: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, merge: { type: 'boolean' },
};
const NEEDS = {
  sync: ['project', 'worktree', 'branch'],
  commit: ['project', 'worktree', 'repo', 'branch', 'default-branch', 'message', 'file', 'owned'],
  supervised: ['project', 'worktree', 'repo', 'branch', 'default-branch', 'commit', 'owned'],
};
const ALLOWED = { sync: [...NEEDS.sync, 'merge'], commit: [...NEEDS.commit, 'merged', 'title', 'body'], supervised: [...NEEDS.supervised, 'title', 'body'] };
const PATHS = ['project', 'worktree', 'message', 'body'];

// The options of one mode, each checked where it enters: a value git or gh would read as an option, or a path that is not absolute, is refused.
export function optionsOf(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: FLAGS, allowPositionals: true, strict: true });
  const usage = (message) => refuse('usage', message);
  if (positionals.length !== 1 || !Object.hasOwn(NEEDS, positionals[0])) usage('the first argument is sync, commit or supervised');
  const [mode] = positionals;
  const extra = Object.keys(values).find((k) => !ALLOWED[mode].includes(k));
  if (extra) usage(`--${extra} is no option of ${mode}`);
  const missing = NEEDS[mode].find((k) => values[k] === undefined);
  if (missing) usage(`${mode} needs --${missing}`);
  if ((values.title === undefined) !== (values.body === undefined)) usage('--title and --body go together');
  for (const k of PATHS) if (values[k] !== undefined && !isAbsolute(values[k])) usage(`--${k} must be an absolute path`);
  if (values.repo !== undefined && !REPO.test(values.repo)) usage('--repo must be owner/name');
  for (const k of ['branch', 'default-branch']) if (values[k] !== undefined && !BRANCH.test(values[k])) usage(`--${k} is no plain branch name`);
  // sync --merge takes the default branch as --branch; commit and supervised push to --branch.
  if (mode !== 'sync' && values.branch === values['default-branch']) usage(`--branch is the default branch ${values.branch}, which ${mode} never pushes to`);
  for (const k of ['merged', 'commit']) if (values[k] !== undefined && !COMMIT.test(values[k])) usage(`--${k} must be a full commit id, 40 hex characters`);
  if (values.title !== undefined && !values.title.trim()) usage('--title is empty');
  const { 'default-branch': defaultBranch, file: files, ...rest } = values;
  return { mode, options: { ...rest, defaultBranch, files, merge: values.merge ?? false } };
}

if (isMain(import.meta.url)) {
  try {
    const { mode, options } = optionsOf(process.argv.slice(2));
    console.log(json({ sync, commit, supervised }[mode](options)));
  } catch (e) {
    console.error(escaped(`${e.step ?? 'usage'}: ${e.message.split('\n')[0]}`));
    process.exitCode = 1;
  }
}
