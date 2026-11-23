// PreToolUse hook for Bash, Monitor and PowerShell: no session hands /cl-workflow:questions to another session through Orca's CLI
// (worker-start and send give a session its prompt, typed into its terminal). Such a session could set the answer flag of the local
// question queue, since its hook input looks like a typed command (cl-workflow's ask hook).
// It reads the command's text only: a prompt in a file the command names, Orca's path in a variable, and a spelling the shell joins
// (o""rca, an escape) are not seen, and a command that only mentions both words is refused.
import { text } from 'node:stream/consumers';

// The command's own and its short form, as cl-workflow's role guard reads them.
const QUESTIONS = /(^|[^\w-])\/(cl-workflow:)?questions(?![\w.-])/i;
// A word ends at blanks, shell separators and quotes; Orca's executable by its name, with a Windows suffix too.
const WORDS = /[\s;&|()`'"{}<>=]+/;
const program = (word) => word.split(/[/\\]/).pop().toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, '');

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
  } else if (command && QUESTIONS.test(command) && command.split(WORDS).some((word) => program(word) === 'orca')) {
    const reason = 'CedarLoom dispatch guard: an Orca command with /cl-workflow:questions in it would hand that command to a session, which could then write answers into the local question queue (.cedarloom/questions/); only the owner runs it, typed into their own terminal session. Text a session receives names it without the leading slash. The guard reads text only, so a command that merely mentions orca and the command, as a commit message or a search may, is refused too: take that text from a file (git commit -F, gh --body-file, rg -f).';
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  }
}
