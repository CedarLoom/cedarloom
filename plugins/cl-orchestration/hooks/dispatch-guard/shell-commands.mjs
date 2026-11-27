// A shell text read as the commands it runs, the reading of cl-workflow's role guard (hooks/role-guard/role-guard.mjs there),
// kept as one copy per plugin since a plugin imports nothing from another.
import { ansiC } from '../ansi-c-quote.mjs';

export const program = (word) => word.split(/[/\\]/).pop().toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, '');
// A launcher also goes by its package with a version (npx @anthropic-ai/claude-code@latest).
export const LAUNCHERS = new Set(['claude', 'claude-code', 'codex']);
export const launcher = (word) => program(word).replace(/@[^@]*$/, '');
// Commands that change the folder the following commands run in, in bash and PowerShell.
export const CHANGE_DIR = new Set(['cd', 'pushd', 'popd', 'chdir', 'set-location', 'sl', 'push-location', 'pop-location']);
// The words the guard acts on: gh, git, orca, a launcher and a folder change.
const acted = (word) => ['gh', 'git', 'orca'].includes(program(word)) || LAUNCHERS.has(launcher(word)) || CHANGE_DIR.has(word.toLowerCase());

// Programs that run the program after them, each with its options whose value is the next word.
const WRAPPERS = new Map([
  ['env', ['-u', '--unset', '-C', '--chdir', '-S', '--split-string', '-P']],
  ['sudo', ['-u', '--user', '-g', '--group', '-C', '--close-from', '-D', '--chdir', '-h', '--host', '-p', '--prompt', '-r', '--role', '-t', '--type', '-U', '--other-user', '-T', '--command-timeout']],
  ['doas', ['-u', '-C']],
  // --eof and --max-lines take their optional value only after =.
  ['xargs', ['-I', '-d', '--delimiter', '-E', '-a', '--arg-file', '-L', '-n', '--max-args', '-P', '--max-procs', '-s', '--max-chars', '--process-slot-var', '-J', '-R', '-S']],
  ['time', ['-f', '--format', '-o', '--output']],
  ['timeout', ['-k', '--kill-after', '-s', '--signal']],
  ['gtimeout', ['-k', '--kill-after', '-s', '--signal']],
  ['nice', ['-n', '--adjustment']],
  ['stdbuf', ['-i', '--input', '-o', '--output', '-e', '--error']],
  ['exec', ['-a']],
  ['command', []],
  ['nohup', []],
  ['builtin', []],
  ['eval', []],
  ['noglob', []],
  // PowerShell's dot-source operator runs the command after it in the current scope, as & does in a child scope.
  ['.', []],
  // PowerShell's flow-control keywords that take a pipeline (https://learn.microsoft.com/en-us/powershell/scripting/lang-spec/chapter-08#85-flow-control-statements).
  ...['return', 'throw', 'exit'].map((word) => [word, []]),
  // The reserved words a command can follow (bash, zsh).
  ...['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{'].map((word) => [word, []]),
]);
// A PowerShell assignment takes the output of the command after it: its target ($r, $script:r, [string]$r) and operator
// (=, +=, ??=) as words before the command.
const PS_TARGET = /^(\[[^\]]*\])*\$\S+$/;
const PS_OPERATOR = /^(\?\?|[-+*/%])?=$/;
// The index of the word that runs as the program, -1 for none: every word before it is an env assignment, a wrapper, a wrapper's
// option with its value, a duration (timeout 10), or in PowerShell an assignment's target or operator.
export function programIndex(words, powershell) {
  let values = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (WRAPPERS.has(program(w))) values = WRAPPERS.get(program(w));
    else if (w.startsWith('-')) i += values.includes(w) ? 1 : 0;
    else if (powershell && (PS_TARGET.test(w) || PS_OPERATOR.test(w))) values = [];
    else if (!/^([A-Za-z_]\w*=|\d+(\.\d+)?[smhd]?$)/.test(w)) return i;
  }
  return -1;
}
// Word j may run as the command: it stands at or before the program, so the words before it are all ones programIndex skips.
function runs(words, j, powershell) {
  const at = programIndex(words, powershell);
  return at < 0 || at >= j;
}


// Inside double quotes bash drops a backslash only before these (https://www.gnu.org/software/bash/manual/html_node/Double-Quotes.html).
const BASH_QUOTED_ESCAPES = '$`"\\';

// The commands of a shell text, each a list of words with quotes and escapes resolved, as the shell splits them: a line
// continuation joins its lines, a quoted word stays whole, and the targets of redirections are kept apart from the words. The text
// of a quoted word is read again as commands, so `bash -c "gh pr merge 1"` shows its gh; text that only names such a command is denied as well.
// A command from quoted text, parentheses, backticks, a pipeline or a background job is marked nested: a folder change there
// may not reach the commands after it.
// PowerShell escapes and continues lines with the backtick and keeps the backslash as a plain character
// (https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_special_characters).
// A PowerShell script block ({ } as in ForEach-Object { }, %{ }, try { }, catch [X]{ } and -Process:{ }) holds commands of its own,
// nested; a brace after $, @, / or ^ (${n}, @{ }, stash@{0}, repos/{owner}, HEAD^{commit}) only ends a word. The block ends the
// command it follows: a program takes a script block as -encodedCommand with base64 text, never as its verb, method or branch
// (https://github.com/PowerShell/PowerShell/blob/ba2221aed027041b6620c5fe1c0675567f14452a/src/System.Management.Automation/engine/MinishellParameterBinderController.cs#L177-L192).
// PowerShell also runs the command after an assignment operator, whatever its target ($r =gh, ${r}=gh, [int] $a[0] += gh,
// @{ a = gh }): the words after each = of a command are read as a command of their own as well.
// An ANSI-C quoted string ($'...') holds its decoded value, as the shell of mode reads it (ansi-c-quote.mjs).
function commands(source, powershell, nested = false, mode = 'bash') {
  /** @type {{ words: string[], targets: string[], nested: boolean, data?: boolean }[]} */
  const out = [];
  const escape = powershell ? '`' : '\\';
  const s = source.replace(powershell ? /`\r?\n/g : /\\\r?\n/g, '');
  let words = [], targets = [], word = '', started = false, quoted = false, quote = null, redirect = false, depth = 0, backticks = false, piped = false;
  // Per open brace in PowerShell, whether it opened a script block.
  const blocks = [];
  const endWord = () => {
    if (started) {
      // An argument of a program that only reads (grep "gh release create" f) is marked data: readings() drops it where no
      // text of the line runs as commands.
      const at = redirect ? -1 : programIndex(words, powershell);
      const owner = at >= 0 ? program(words[at]) : undefined;
      const data = !powershell && READERS.has(owner);
      if (redirect) {
        redirect = false;
        targets.push(word);
      } else words.push(word);
      if (quoted && /[\s;&|()`<>]/.test(word)) {
        const inner = powershell ? commands(word, true, true) : nestedCommands(word);
        out.push(...inner.map((c) => ({ ...c, owner: c.owner ?? owner, ...(data && { data: true }) })));
      }
    }
    word = '';
    started = quoted = false;
  };
  const endCommand = (subshell = false) => {
    endWord();
    const inner = nested || subshell || depth > 0 || backticks;
    if (words.length || targets.length) {
      out.push({ words, targets, nested: inner, piped });
      piped = false;
    }
    if (powershell) {
      // Where no word after the = is one the guard acts on, the reading keeps only the word joined to it, a path the command may reach.
      const last = words.findLastIndex(acted);
      words.forEach((w, i) => {
        for (let at = w.indexOf('='); at >= 0; at = w.indexOf('=', at + 1)) {
          const head = w.slice(at + 1);
          // Of a run of = (a ruler in quoted text) only the last one can end an operator.
          if (head.startsWith('=')) continue;
          const after = [...(head ? [head] : []), ...(i < last || acted(head) ? words.slice(i + 1) : [])];
          if (after.length) out.push({ words: after, targets: [], nested: inner });
        }
      });
    }
    words = [];
    targets = [];
    redirect = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === escape && quote === '"' && i + 1 < s.length && (powershell || BASH_QUOTED_ESCAPES.includes(s[i + 1]))) word += s[++i];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = quoted = true;
    } else if (c === '$' && !powershell && s[i + 1] === "'") {
      const { value, end } = ansiC(s, i + 2, mode);
      word += value;
      i = end;
      started = quoted = true;
    } else if (c === '$' && !powershell && s[i + 1] === '"') {
      // bash reads $"..." as a double-quoted string, translated for the locale.
      started = true;
    } else if (c === escape) {
      word += s[++i] ?? '';
      started = quoted = true;
    } else if (c === '<' || c === '>' || (c === '&' && s[i + 1] === '>')) {
      // A file descriptor number in front (2>&1) and the target after are no words of the command.
      if (!quoted && /^\d+$/.test(word)) started = false;
      endWord();
      while (/[<>&|]/.test(s[i + 1] ?? '')) i++;
      redirect = true;
    } else if (c === '\n' || ';&|()'.includes(c) || (c === '`' && !powershell)) {
      // A command before a single | or & runs in a subshell: a pipeline part or a background job.
      endCommand('|&'.includes(c) && s[i + 1] !== c);
      // The next command reads this one's output: a single | or |& (not ||), also across the empty command before a (, & or line break.
      if (c === '|' && s[i + 1] !== '|' && s[i - 1] !== '|') piped = true;
      if (c === '(') depth++;
      else if (c === ')' && depth) depth--;
      else if (c === '`') backticks = !backticks;
    } else if (powershell && '{}'.includes(c)) {
      // The braces of a script block may stand next to its first and last word: {gh pr merge 1}.
      const block = c === '{' ? !'$@/^'.includes(s[i - 1] ?? ' ') : blocks.pop() ?? true;
      if (c === '{') blocks.push(block);
      if (!block) endWord();
      else {
        endCommand();
        if (c === '{') depth++;
        else if (depth) depth--;
      }
    } else if (/\s/.test(c)) endWord();
    else {
      word += c;
      started = true;
    }
  }
  endCommand();
  return out;
}

// Programs whose arguments are text they search for, never commands they run (GNU sed is not one: its e command runs one).
const READERS = new Set(['grep', 'egrep', 'fgrep', 'rg']);
// Programs that run text as commands: their arguments (eval, sh -c, xargs) or their input (a pipe into a shell, source).
const RUNNERS = new Set(['eval', 'xargs', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'source', '.']);
// The line runs text as commands that the guard may not read as such, what a reading program prints among it: a backtick or
// $( substitution, or a runner.
const runsText = (parsed, source, powershell) =>
  source.includes('$(') || (!powershell && source.includes('`')) || parsed.some(({ words }) => words.some((w, j) => RUNNERS.has(program(w)) && runs(words, j, powershell)));

// The readers and the filters, programs that print what they read and run none of it, each with its long options that name
// no program and read no config, written out in full: rg --pre,
// sort --compress-program and an abbreviation such as sort --co are left out, so they make the command no plain one.
const GREP_LONG = ['line-number', 'count', 'files-with-matches', 'files-without-match', 'ignore-case', 'no-filename', 'with-filename', 'fixed-strings', 'word-regexp', 'line-regexp', 'invert-match', 'only-matching', 'recursive', 'include', 'exclude', 'exclude-dir', 'label', 'color', 'null', 'text', 'regexp', 'extended-regexp', 'perl-regexp', 'max-count', 'context', 'after-context', 'before-context', 'quiet', 'silent'];
const HEAD_LONG = ['lines', 'bytes', 'quiet', 'silent', 'verbose'];
const SAFE_LONG = new Map(
  Object.entries({
    grep: GREP_LONG,
    egrep: GREP_LONG,
    fgrep: GREP_LONG,
    rg: ['line-number', 'count', 'files-with-matches', 'files-without-match', 'ignore-case', 'smart-case', 'no-heading', 'heading', 'no-filename', 'with-filename', 'fixed-strings', 'word-regexp', 'line-regexp', 'invert-match', 'only-matching', 'replace', 'glob', 'type', 'type-not', 'hidden', 'no-ignore', 'sort', 'sortr', 'max-count', 'context', 'after-context', 'before-context', 'color', 'null', 'json', 'column', 'text', 'regexp', 'max-depth', 'multiline'],
    head: HEAD_LONG,
    tail: HEAD_LONG,
    wc: ['lines', 'words', 'bytes', 'chars'],
    sort: ['numeric-sort', 'reverse', 'unique', 'key', 'field-separator', 'stable', 'version-sort', 'human-numeric-sort', 'ignore-case'],
    uniq: ['count', 'repeated', 'unique', 'skip-fields', 'skip-chars', 'ignore-case'],
    cat: [],
    cut: ['delimiter', 'fields', 'characters', 'bytes'],
  }).map(([name, options]) => [name, new Set(options)]),
);
// A reader or filter after nothing but wrapper names and durations, so no wrapper option or env assignment (env -S can set
// RIPGREP_CONFIG_PATH, which can name a config with --pre), and with only its safe long options.
export const plain = ({ words }, powershell) => {
  const at = programIndex(words, powershell);
  const safe = at < 0 ? undefined : SAFE_LONG.get(program(words[at]));
  if (!safe || words.slice(0, at).some((w) => !WRAPPERS.has(program(w)) && !/^\d+(\.\d+)?[smhd]?$/.test(w))) return false;
  return words.slice(at + 1).every((w) => !w.startsWith('--') || w === '--' || safe.has(w.slice(2).split('=')[0]));
};
// Some command of the line may run what a reader prints: one that is no plain reader or filter (an unknown program fails closed), or a redirect.
const opaque = (parsed, powershell) => parsed.some((c) => !c.data && (c.targets.length || (c.words.length && !plain(c, powershell))));
// The commands of a command text in each reading a shell may give it: PowerShell's, or those of current bash, bash 3.2 and zsh,
// which differ only in ANSI-C quoting and a NUL; every check runs on each. A reading program's quoted arguments are left out
// only in one line (a comment or a here-document on another line could end its quote) that runs no text as commands.
export function readings(source, powershell) {
  const all = powershell ? [commands(source, true)] : shellReadings(source, false);
  return all.map((parsed) => (source.includes('\n') || runsText(parsed, source, powershell) || opaque(parsed, powershell) ? parsed : parsed.filter((c) => !c.data)));
}

// The readings of a POSIX shell text. A quoted word read again as commands gets every reading too: the shell that runs it
// (bash -c, zsh -c, eval) may be another one than the shell around it.
function shellReadings(source, nested) {
  const bash = commands(source, false, nested);
  if (!source.includes("$'") && !source.includes('\0')) return [bash];
  const zsh = commands(source, false, nested, 'zsh');
  // zsh hands a program each word up to its first NUL; a builtin reads it whole, here without the NUL.
  const each = (f) => zsh.map((c) => ({ ...c, words: c.words.map(f), targets: c.targets.map(f) }));
  const all = [bash, commands(source, false, nested, 'bash3'), each((w) => w.split('\0')[0]), each((w) => w.replaceAll('\0', ''))].map((r) => [JSON.stringify(r), r]);
  return [...new Map(all).values()];
}

// The commands of a quoted word read again: each distinct reading whole and in its order, one after the other, so that a
// switch or cd only one reading holds still comes before that reading's push. Each word is read once.
const nestedCache = new Map();
function nestedCommands(word) {
  if (!nestedCache.has(word)) nestedCache.set(word, shellReadings(word, true).flat());
  return nestedCache.get(word);
}

