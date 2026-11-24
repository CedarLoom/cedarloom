// PreToolUse hook for Bash, Monitor and PowerShell: no session hands /cl-workflow:away off (or /cl-workflow:questions) to another session through Orca's CLI
// (worker-start and send give a session its prompt, typed into its terminal). Such a session could set the answer flag of the local
// question queue, since its hook input looks like a typed command (cl-workflow's ask hook).
// It reads the command's text only: a prompt in a file the command names, Orca's path in a variable and text the shell builds when
// it runs (eval, command substitution) are not seen, and a command that only mentions both words is refused.
import { text } from 'node:stream/consumers';
import { ansiC } from '../ansi-c-quote.mjs';

// The command's own and its short form, as cl-workflow's role guard reads them.
const QUESTIONS = /(^|[^\w-])\/(cl-workflow:)?(questions|away\s+off)(?![\w.-])/i;
// A word ends at blanks, shell separators and quotes; Orca's executable by its name, with a Windows suffix too.
const WORDS = /[\s;&|()`'"{}<>=]+/;
const program = (word) => word.split(/[/\\]/).pop().toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, '');
// Inside double quotes bash drops a backslash only before these (https://www.gnu.org/software/bash/manual/html_node/Double-Quotes.html).
const QUOTED_ESCAPES = '$`"\\\n';

// The command as bash, or with zsh as zsh, joins its words: quotes removed, backslash escapes and line continuations resolved and
// ANSI-C quoted strings ($'...') decoded (ansi-c-quote.mjs).
function joined(command, zsh) {
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
      const { value, end } = ansiC(command, i + 2, zsh);
      out += value;
      i = end;
    } else if (c === "'" || c === '"') quote = c;
    // bash reads $"..." as a double-quoted string, translated for the locale.
    else if (!(c === '$' && command[i + 1] === '"')) out += c;
  }
  return out;
}

// Exit 2 refuses the call; onFailure "block" also refuses it when the hook cannot start.
const input = await text(process.stdin).then(JSON.parse).catch(() => null);
if (input === null || typeof input !== 'object' || Array.isArray(input)) {
  process.stderr.write('CedarLoom dispatch guard: the hook input is no JSON object, so the call is refused.\n');
  process.exitCode = 2;
} else {
  const command = input.tool_input?.command;
  // A Monitor call on a WebSocket runs no command.
  if (command !== undefined && typeof command !== 'string') {
    process.stderr.write('CedarLoom dispatch guard: the command is no string, so the call is refused.\n');
    process.exitCode = 2;
  } else if (command) {
    // The text as written, as bash and zsh join it, and without any quote, a $ before one or a backslash, which PowerShell joins alike
    // ("/cl-workflow:away"' off').
    const texts = [command, joined(command, false), joined(command, true), command.replace(/\$?["'\\]/g, '')];
    if (texts.some((t) => QUESTIONS.test(t)) && texts.some((t) => t.split(WORDS).some((word) => program(word) === 'orca'))) {
      const reason = 'CedarLoom dispatch guard: an Orca command with /cl-workflow:away off or /cl-workflow:questions in it would hand that command to a session, which could then write answers into the local question queue (.cedarloom/questions/); only the owner runs it, typed into their own terminal session. Text a session receives names it without the leading slash. The guard reads text only, so a command that merely mentions orca and the command, as a commit message or a search may, is refused too: take that text from a file (git commit -F, gh --body-file, rg -f).';
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
    }
  }
}
