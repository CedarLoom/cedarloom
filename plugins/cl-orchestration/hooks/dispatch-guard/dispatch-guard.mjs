// PreToolUse hook for Bash, Monitor and PowerShell, and for Write, Edit and MultiEdit (rule handoff-size). It refuses, in every
// session that loads this plugin, the commands that docs/worker-bounds.md lists, each refusal naming its rule; a command it cannot
// read for a rule (a variable, a command substitution) is refused under that rule. It reads the command text with the role guard's
// reading (shell-commands.mjs): a script, a file a command names or a program that runs git or gh as a child is not seen.
// Rule away-off: no session hands /cl-workflow:away off to another session through Orca's CLI (worker-start and send give a session
// its prompt, typed into its terminal). Such a session could set the answer flag of the local question queue, since its hook input
// looks like a typed command (cl-workflow's ask hook). This rule reads the text as written: a command that only mentions both words
// is refused.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { text } from 'node:stream/consumers';
import { ansiC } from '../ansi-c-quote.mjs';
import { CHANGE_DIR, LAUNCHERS, launcher, plain, program, programIndex, readings } from './shell-commands.mjs';

// The command's own and its short form, as cl-workflow's role guard reads them.
const QUESTIONS = /(^|[^\w-])\/(cl-workflow:)?away\s+off(?![\w.-])/i;
// A word ends at blanks, shell separators and quotes.
const WORDS = /[\s;&|()`'"{}<>=]+/;
// Inside double quotes bash drops a backslash only before these (https://www.gnu.org/software/bash/manual/html_node/Double-Quotes.html).
const QUOTED_ESCAPES = '$`"\\\n';

// The command as the shell of mode ('bash', 'bash3' or 'zsh') joins its words: quotes removed, backslash escapes and line
// continuations resolved and ANSI-C quoted strings ($'...') decoded (ansi-c-quote.mjs).
function joined(command, mode) {
  let out = '', quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else out += c;
    } else if (c === '"' && quote) quote = null;
    else if (c === '\\' && (!quote || QUOTED_ESCAPES.includes(command[i + 1] ?? ''))) {
      const next = command[++i] ?? '';
      if (next !== '\n') out += next;
    } else if (quote) out += c;
    else if (c === '$' && command[i + 1] === "'") {
      const { value, end } = ansiC(command, i + 2, mode);
      out += value;
      i = end;
    } else if (c === "'" || c === '"') quote = c;
    // bash reads $"..." as a double-quoted string, translated for the locale.
    else if (!(c === '$' && command[i + 1] === '"')) out += c;
  }
  return out;
}

// The text as written, as current bash and bash 3.2 join it, as zsh joins it for a program (each word up to its first NUL) and for a
// builtin (here without the NUL), and without any quote, a $ before one or a backslash, which PowerShell joins alike
// ("/cl-workflow:away"' off').
function awayOff(command) {
  const zsh = joined(command, 'zsh');
  const texts = [command, joined(command, 'bash'), joined(command, 'bash3'), zsh.replace(/\0\S*/g, ''), zsh.replaceAll('\0', ''), command.replace(/\$?["'\\]/g, '')];
  if (!texts.some((t) => QUESTIONS.test(t)) || !texts.some((t) => t.split(WORDS).some((word) => program(word) === 'orca'))) return [];
  return ['away-off: an Orca command with /cl-workflow:away off in it would hand that command to a session, which could then write answers into the local question queue (.cedarloom/questions/); only the owner runs it, typed into their own terminal session. Text a session receives names it without the leading slash. This rule reads text only, so a command that merely mentions orca and the command, as a commit message or a search may, is refused too: take that text from a file (git commit -F, gh --body-file, rg -f).'];
}

const ROLE = 'CEDARLOOM_ROLE';
const HANDOFF = '/.cedarloom/runs/handoff.md';
const HANDOFF_LIMIT = 8000;
// The folders the guard follows in one command, as the role guard does.
const MAX_FOLDERS = 64;
const SHA = /^[0-9a-f]{40}$/;
// A word the shell fills in when it runs: a variable, a command substitution or a backtick.
const expands = (word) => /[$`]/.test(word);
// Flags and values that bypass or skip permission prompts: Claude Code's --dangerously-skip-permissions,
// --allow-dangerously-skip-permissions and bypassPermissions mode (https://code.claude.com/docs/en/cli-reference), Codex's
// --dangerously-bypass-approvals-and-sandbox with its --yolo alias, the danger-full-access sandbox and the never approval policy
// (https://developers.openai.com/codex/cli/reference). --dan covers an abbreviation; disableBypassPermissionsMode, the setting
// that turns bypass mode off, passes.
const BYPASS = /^--(allow-)?dan|^--yolo(=|$)|(?<![a-z])bypass_?permissions(?!mode)|danger-full-access|approval_policy\W*never/i;
// Codex's approval flag, whose value never skips every prompt.
const APPROVAL = new Set(['-a', '--ask-for-approval']);
// git accepts an unambiguous abbreviation of a long option (--f for --force) and a cluster of short ones (-ff).
const forces = (w) => /^--f(o(r(ce?)?)?)?(=.*)?$/.test(w) || /^-[A-Za-z]*f[A-Za-z]*$/.test(w);
// The git commands that write the working files of a clone, which a scratch clone holds none of.
const CHECKOUTS = new Set(['checkout', 'switch', 'restore', 'worktree']);
// gh pr merge's options that take the next word as their value, and gh's repository option.
const MERGE_VALUES = new Set(['-b', '--body', '-F', '--body-file', '-t', '--subject', '-A', '--author-email', '--match-head-commit', '-R', '--repo']);
const GH_VALUES = new Set(['-R', '--repo']);
// A command whose program the guard cannot read is refused when it holds a word of a rule.
const TRIGGERS = new Map([
  ['merge', 'direct-merge'],
  ['--admin', 'no-admin'],
  ['--auto', 'no-auto'],
  ['--delete-branch', 'no-delete-branch'],
  ['update-branch', 'update-branch-rebase'],
  ['--rebase', 'update-branch-rebase'],
  ['checkout', 'clone-checkout'],
  ['switch', 'clone-checkout'],
  ['restore', 'clone-checkout'],
  ['worktree', 'worktree-force'],
  ['--command', 'launch-env'],
]);
const KNOWN = new Set(['gh', 'git', 'orca']);

// A word the guard cannot read where an option may stand: one that expands, unless it is the value of the option before it
// (--worktree "$p") or an option's own value after = (--subject="$s").
function unreadOption(words, j, values) {
  const w = words[j];
  if (!expands(w)) return false;
  if (/^--[\w-]+=/.test(w)) return expands(w.slice(0, w.indexOf('=')));
  const before = words[j - 1] ?? '';
  return !(values ? values.has(before) : /^--[\w-]+$/.test(before));
}

// The real path where it exists, so a link to a clone counts as the clone.
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
// A scratch clone: a folder in clones/ of a run folder (.cedarloom/runs/<run id>/clones/) or of a bot home (which holds
// .cedarloom/runs/). A clone with files, as a trial's, lies in checkouts/ instead (trial-merge.md).
function inClone(path) {
  const parts = real(path).split(/[/\\]/);
  return parts.some((part, i) => {
    if (part !== 'clones' || !parts[i + 1]) return false;
    const home = parts.slice(0, i).join('/') || '/';
    return (parts[i - 2] === 'runs' && parts[i - 3] === '.cedarloom') || existsSync(join(home, '.cedarloom', 'runs'));
  });
}
const isHandoff = (path) => real(path).replaceAll('\\', '/').toLowerCase().endsWith(HANDOFF);

// The folders a command may run in, null for one the guard cannot read. A folder change adds its folder to the ones before: it
// may fail with the next command still running (cd x; git ...), or run in a subshell that ends before that command.
function changeDir(places, words, at) {
  const name = program(words[at]);
  const arg = words.slice(at + 1).find((w) => !/^-\w/.test(w));
  const next = [...places].map((p) => (p === null || !arg || arg === '-' || expands(arg) || name === 'popd' || name === 'pop-location' ? null : resolve(p, arg)));
  const all = new Set([...places, ...next]);
  // Each change can double the folders; past the bound the folder is one the guard cannot read.
  return all.size > MAX_FOLDERS ? new Set([null]) : all;
}

function gitRules(words, at, places, refuse) {
  let dirs = [...places], unread = words.slice(0, at).some((w) => /^GIT_(DIR|WORK_TREE)=/.test(w)), alias = false, i = at + 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === '-C') {
      const d = words[++i] ?? '';
      dirs = dirs.map((p) => (p === null || expands(d) ? null : resolve(p, d)));
    } else if (/^--(git-dir|work-tree)$/.test(w)) {
      unread = true;
      i++;
    } else if (/^--(git-dir|work-tree|config-env)=/.test(w) || w === '--config-env') unread = true;
    else if (w === '-c') alias ||= /^alias\./i.test(words[++i] ?? '');
    else if (w === '--namespace' || w === '--super-prefix') i++;
    else if (!w.startsWith('-')) break;
  }
  const sub = words[i];
  if (sub === undefined) return;
  if (sub === 'worktree' && (words[i + 1] === 'remove' || expands(words[i + 1] ?? ''))) {
    const rest = words.slice(i + 2);
    if (rest.some(forces)) refuse('worktree-force', 'git worktree remove --force deletes a worktree with its changes and untracked files: remove it without --force, or through commit-push.mjs remove');
    else if (expands(words[i + 1]) || rest.some(expands)) refuse('worktree-force', 'a git worktree remove the guard cannot read (a variable or command substitution): write it out');
  }
  if (!CHECKOUTS.has(sub) && !expands(sub) && !alias) return;
  const folders = unread ? [null] : dirs;
  if (folders.includes(null)) refuse('clone-checkout', `git ${sub} in a folder the guard cannot read (a variable, cd -, --git-dir, GIT_DIR): name the folder as a path`);
  else if (folders.some(inClone)) refuse('clone-checkout', `git ${expands(sub) || alias ? 'with a command the guard cannot read' : sub} in a scratch clone would put the pull request's files on disk, where Claude Code may load them as instructions: read through git (diff, show, grep) only`);
}

function ghRules(words, at, refuse) {
  const positional = [];
  let j = at + 1;
  for (; j < words.length && positional.length < 2; j++) {
    if (GH_VALUES.has(words[j])) j++;
    else if (!words[j].startsWith('-')) positional.push(words[j]);
  }
  const [cmd, verb] = positional;
  if (cmd === undefined) return;
  if (expands(cmd) || (cmd === 'pr' && verb !== undefined && expands(verb))) return refuse('direct-merge', 'a gh command whose command or verb the guard cannot read: write them out');
  if (cmd !== 'pr') return;
  const rest = words.slice(j);
  if (verb === 'update-branch') {
    if (rest.some((w) => w === '--rebase' || w.startsWith('--rebase='))) refuse('update-branch-rebase', 'gh pr update-branch --rebase rewrites the branch and drops its review; update with a merge of the default branch: gh pr update-branch <n> -R <owner/repo>');
    else if (rest.some((_, k) => unreadOption(rest, k, GH_VALUES))) refuse('update-branch-rebase', 'a gh pr update-branch option the guard cannot read: write it out');
    return;
  }
  if (verb !== 'merge') return;
  // With --disable-auto or --help gh merges nothing.
  let pin, disable = false;
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k];
    if (MERGE_VALUES.has(w)) {
      if (w === '--match-head-commit') pin = rest[k + 1];
      k++;
    } else if (w.startsWith('--')) {
      const name = w.slice(2).split('=')[0];
      if (name === 'match-head-commit') pin = w.slice(w.indexOf('=') + 1);
      else if (name === 'admin') refuse('no-admin', 'gh pr merge --admin passes over the branch rules and their required checks');
      else if (name === 'auto') refuse('no-auto', 'gh pr merge --auto merges later, also a head pushed after the review');
      else if (name === 'delete-branch') refuse('no-delete-branch', 'gh pr merge --delete-branch deletes the branch and its local copy; Clean up deletes a merged branch by the policy (delete-branch.mjs)');
      // A boolean flag holds only without a value or with true (--disable-auto=false merges).
      else if (name === 'disable-auto' || name === 'help') disable ||= !w.includes('=') || /=true$/i.test(w);
      else if (expands(name)) refuse('direct-merge', 'a gh pr merge option the guard cannot read: write it out');
    } else if (w === '-h') disable = true;
    else if (/^-[A-Za-z]/.test(w)) {
      // A cluster of short flags (-sd): a flag that takes a value takes the rest of the word.
      for (const ch of w.slice(1)) {
        if (ch === 'd') refuse('no-delete-branch', 'gh pr merge -d deletes the branch; Clean up deletes a merged branch by the policy (delete-branch.mjs)');
        if ('bFtAR'.includes(ch)) break;
      }
    } else if (expands(w)) refuse('direct-merge', 'a gh pr merge argument the guard cannot read: write the number and the options out');
  }
  if (disable) return;
  if (pin === undefined) refuse('direct-merge', 'a gh pr merge without --match-head-commit <head> merges whatever the branch holds then: merge the reviewed head as merge.md step 5 writes it');
  else if (!SHA.test(pin)) refuse('direct-merge', 'gh pr merge takes --match-head-commit with the full 40-character head commit, written out');
}

function orcaRules(words, at, refuse) {
  const rest = words.slice(at + 1);
  const subs = rest.filter((w) => !w.startsWith('-')).slice(0, 2);
  if (subs[0] === 'worktree' && (subs[1] === 'rm' || subs[1] === 'remove' || (subs[1] !== undefined && expands(subs[1])))) {
    if (rest.some(forces)) refuse('worktree-force', 'orca worktree rm --force deletes a worktree with its changes and untracked files: remove it without --force (orca-clean-up.md)');
    else if (rest.some((_, k) => unreadOption(rest, k)) || expands(subs[1])) refuse('worktree-force', 'an orca worktree rm the guard cannot read: write its options out');
  }
  rest.forEach((w, k) => {
    const name = w.split('=')[0];
    if (name.length < 5 || !'--command'.startsWith(name)) return;
    const value = w.includes('=') ? w.slice(w.indexOf('=') + 1) : rest[k + 1];
    if (value === undefined) return;
    if (expands(value)) return refuse('launch-env', 'an Orca launch line the guard cannot read (a variable or command substitution): write it out');
    for (const parsed of readings(value, false)) {
      for (const { words: launch } of parsed) {
        const p = programIndex(launch, false);
        if (p < 0) continue;
        if (expands(launch[p])) refuse('launch-env', 'an Orca launch line whose program the guard cannot read: write it out');
        else if (LAUNCHERS.has(launcher(launch[p])) && !unsetsRole(launch.slice(0, p))) refuse('launch-env', `a launch line starts an agent without env -u ${ROLE} in front, so the session would inherit the coordinator's role: start it as orca.md writes it`);
      }
    }
  });
}

// env unsets the role before the program and nothing after sets it again.
function unsetsRole(before) {
  let inEnv = false, unset = false;
  for (let i = 0; i < before.length; i++) {
    const w = before[i];
    if (!w.startsWith('-') && !w.includes('=')) inEnv = program(w) === 'env';
    else if (inEnv && (w === '-u' || w === '--unset')) unset ||= before[++i] === ROLE;
    else if (inEnv && (w === `-u${ROLE}` || w === `--unset=${ROLE}`)) unset = true;
    else if (w.startsWith(`${ROLE}=`)) unset = false;
  }
  return unset;
}

function bypassRules(words, at, refuse) {
  const name = at < 0 ? undefined : launcher(words[at]);
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (BYPASS.test(w)) refuse('bypass-flag', `${w.length > 60 ? 'a word' : w} bypasses or skips permission prompts; no session writes such a flag, for any agent (the guard reads text only: take a message that names one from a file, git commit -F, gh --body-file)`);
    if (name === 'codex' && ((APPROVAL.has(w) && words[k + 1] === 'never') || /^(--ask-for-approval=|-a=?)never$/.test(w))) refuse('bypass-flag', 'codex with the never approval policy skips every prompt');
  }
  if (name !== undefined && LAUNCHERS.has(name) && words.slice(at + 1).some(expands)) refuse('bypass-flag', 'an agent launch with a word the guard cannot read (a variable or command substitution), which could hold a bypass flag: write it out');
}

function handoffRules({ words, targets }, at, places, powershell, refuse) {
  // An absolute path names one file in any folder; in a folder the guard cannot read, a relative path that ends in handoff.md may
  // be the handoff file.
  const named = (w) => (isAbsolute(w) ? isHandoff(w) : [...places].some((p) => (p === null ? /(^|[/\\])handoff\.md$/i.test(w) : isHandoff(resolve(p, w)))));
  if (targets.some((t) => expands(t) || named(t))) refuse('handoff-size', 'a redirection that writes the handoff file, or into a path the guard cannot read: write the handoff file with the Write or Edit tool, which this rule measures');
  else if (at >= 0 && !plain({ words }, powershell) && words.slice(at + 1).some((w) => named(w) || (expands(w) && /handoff/i.test(w)))) refuse('handoff-size', 'a command that may write the handoff file: write it with the Write or Edit tool, which this rule measures');
}

function commandRules(command, cwd, powershell) {
  const reasons = new Set();
  const refuse = (rule, why) => reasons.add(`${rule}: ${why}.`);
  const substituted = command.includes('$(') || (!powershell && command.includes('`'));
  for (const parsed of readings(command, powershell)) {
    let places = new Set([typeof cwd === 'string' && isAbsolute(cwd) ? cwd : null]);
    // readings() keeps a reader's quoted arguments only where text of the line may run as commands, a substitution among them.
    for (const c of parsed) {
      const at = programIndex(c.words, powershell);
      const name = at < 0 ? undefined : program(c.words[at]);
      handoffRules(c, at, places, powershell, refuse);
      // A plain reader or filter (grep, cat) runs none of its words.
      if (plain(c, powershell)) continue;
      bypassRules(c.words, at, refuse);
      if (name === undefined) continue;
      // A lone $ is where a substitution starts ($(...), $((...))); its commands are read on their own.
      // PowerShell runs a leading variable that no assignment operator follows (& $gh pr merge), which programIndex skips as a target.
      const called = powershell && /^\$[^=]*$/.test(c.words[0]) && !/^(\?\?|[-+*/%])?=$/.test(c.words[1] ?? '');
      if (called) refuse('unreadable-program', `the program ${c.words[0]} is a variable, so the guard cannot check it against its rules: write the program out`);
      else if (expands(c.words[at]) && c.words[at] !== '$') refuse('unreadable-program', `the program ${c.words[at].length > 40 ? 'of a command' : c.words[at]} is a variable or command substitution, so the guard cannot check it against its rules: write the program out`);
      else if (substituted && !KNOWN.has(name) && !LAUNCHERS.has(launcher(c.words[at]))) {
        for (const w of c.words) if (TRIGGERS.has(w)) refuse(TRIGGERS.get(w), `a command after a command substitution, whose program the guard cannot read, holds ${w}: write the program out`);
      }
      if (CHANGE_DIR.has(name)) places = changeDir(places, c.words, at);
      else if (name === 'git') gitRules(c.words, at, places, refuse);
      else if (name === 'gh') ghRules(c.words, at, refuse);
      else if (name === 'orca') orcaRules(c.words, at, refuse);
    }
  }
  return [...reasons];
}

// The handoff file as a Write, Edit or MultiEdit call leaves it, in characters (code points): null where the guard cannot work it out.
function handoffAfter(tool, input, path) {
  if (tool === 'Write') return typeof input.content === 'string' ? input.content : null;
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  for (const edit of tool === 'MultiEdit' ? (Array.isArray(input.edits) ? input.edits : [null]) : [input]) {
    const { old_string: from, new_string: to, replace_all: all } = edit ?? {};
    if (typeof from !== 'string' || typeof to !== 'string' || !from || !content.includes(from)) return null;
    content = all ? content.split(from).join(to) : content.slice(0, content.indexOf(from)) + to + content.slice(content.indexOf(from) + from.length);
  }
  return content;
}

function editRules(tool, input, cwd) {
  const file = input.file_path;
  if (typeof file !== 'string') return [];
  const path = isAbsolute(file) ? file : typeof cwd === 'string' ? resolve(cwd, file) : null;
  if (path === null) return ['handoff-size: an edit of a relative path without the session folder, which the guard cannot place.'];
  if (!isHandoff(path)) return [];
  const after = handoffAfter(tool, input, path);
  if (after === null) return ['handoff-size: an edit of the handoff file whose result the guard cannot work out: write the whole file with the Write tool.'];
  const size = [...after].length;
  return size > HANDOFF_LIMIT ? [`handoff-size: the handoff file would hold ${size} characters, over ${HANDOFF_LIMIT}; it comes back into the context as instructions: shorten it (run-files.md).`] : [];
}

// Exit 2 refuses the call; onFailure "block" also refuses it when the hook cannot start.
const fail = (why) => {
  process.stderr.write(`CedarLoom dispatch guard: ${why}, so the call is refused.\n`);
  process.exitCode = 2;
};
const input = await text(process.stdin).then(JSON.parse).catch(() => null);
if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('the hook input is no JSON object');
else {
  const tool = input.tool_name;
  const command = input.tool_input?.command;
  try {
    let reasons = [];
    if (['Write', 'Edit', 'MultiEdit'].includes(tool)) reasons = editRules(tool, input.tool_input ?? {}, input.cwd);
    // A Monitor call on a WebSocket runs no command.
    else if (command !== undefined && typeof command !== 'string') fail('the command is no string');
    else if (command) reasons = [...awayOff(command), ...commandRules(command, input.cwd, tool === 'PowerShell')];
    if (reasons.length) {
      const reason = `CedarLoom dispatch guard refused the call. ${reasons.join(' ')} See docs/worker-bounds.md of the CedarLoom repository.`;
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
    }
  } catch (error) {
    fail(`the guard failed (${error.message})`);
  }
}
