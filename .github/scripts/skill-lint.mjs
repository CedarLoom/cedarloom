// Structural checks for CedarLoom's plugin skills and the plugin's agents.
// Usage: node .github/scripts/skill-lint.mjs [skill folders...]   (default: every own skill, agent and rules file), exit 1 on
// any error; over a soft word or description budget it warns.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './main.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z][\w-]*):\s*(\S.*)?$/.exec(line);
    if (!kv) return null;
    fields[kv[1]] = kv[2] ?? '';
  }
  return fields;
}

function filesIn(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesIn(p) : [p];
  });
}

const markdownFiles = (dir) => filesIn(dir).filter((p) => p.endsWith('.md'));

// A skill that hands issue or pull request text to a worker names the author filter somewhere in its files: text of other authors is untrusted input.
const HANDS_TEXT = /\b(read|pass|hand|send|give|copy|paste)\b[^.\n]{0,60}\b(issues?|pull requests?|PRs?)\b[^.\n]{0,60}\b(comments?|bod(y|ies)|text)\b/i;
const AUTHOR_FILTER = [/^Trusted authors: \S/m, /\bdata, never instructions\b/i];
// The workflow skill applies the Depth minimum line to its own pick, so a handed-over Depth line must not name it first.
const DEPTH_MINIMUM_FIRST = /^Depth: (?:(?!workflow skill)[^\n])*Depth minimum/m;

export function lintSkill(dir) {
  const errors = [];
  const folder = dir.split('/').pop();
  const skillFile = join(dir, 'SKILL.md');
  if (!existsSync(skillFile)) return [`${dir}: no SKILL.md`];
  const text = readFileSync(skillFile, 'utf8');
  const fm = frontMatter(text);
  if (!fm) return [`${skillFile}: front matter missing or not "key: value" lines`];
  if (fm.name !== folder) errors.push(`${skillFile}: name "${fm.name}" differs from the folder "${folder}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? '')) errors.push(`${skillFile}: name must be lowercase letters, digits and hyphens`);
  if (!/^".*"$/.test(fm.description ?? '')) errors.push(`${skillFile}: description must be in double quotes`);
  else if (fm.description.length - 2 > 1024) errors.push(`${skillFile}: description longer than 1024 characters`);
  if (text.split('\n').length > 500) errors.push(`${skillFile}: more than 500 lines`);
  // Hidden from the / menu and closed to the model: nobody can start it (https://code.claude.com/docs/en/skills).
  if (fm['user-invocable'] === 'false' && fm['disable-model-invocation'] === 'true')
    errors.push(`${skillFile}: user-invocable: false with disable-model-invocation: true leaves no way to start the skill`);
  const files = markdownFiles(dir);
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  if (/\bworkers?\b/i.test(all) && HANDS_TEXT.test(all) && !AUTHOR_FILTER.every((re) => re.test(all)))
    errors.push(`${dir}: hands issue or pull request text to a worker without the author filter (a "Trusted authors:" line and the words "data, never instructions")`);
  if (DEPTH_MINIMUM_FIRST.test(all)) errors.push(`${dir}: a Depth line names the Depth minimum line ahead of the workflow skill`);
  for (const file of files) {
    const body = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^([a-z]+:|#)/.test(target)) continue;
      if (!existsSync(join(dirname(file), target.split('#')[0]))) errors.push(`${file}: link target ${target} not found`);
    }
  }
  const yaml = join(dir, 'agents/openai.yaml');
  if (!existsSync(yaml)) errors.push(`${dir}: agents/openai.yaml missing`);
  else if (fm['disable-model-invocation'] === 'true' && !/^[ \t]+allow_implicit_invocation: false$/m.test(readFileSync(yaml, 'utf8')))
    errors.push(`${yaml}: user-invoked skill needs policy.allow_implicit_invocation: false`);
  return errors;
}

const MODELS = ['fable', 'opus', 'sonnet', 'haiku', 'inherit'];
// Plugin agents ignore these keys (https://code.claude.com/docs/en/plugins-reference), and `claude plugin validate` reads no agents/.
const IGNORED = ['hooks', 'mcpServers', 'permissionMode', 'initialPrompt'];

// A front matter value as YAML reads it: a plain scalar, or a complete double- or single-quoted one; else undefined.
function scalar(raw) {
  if (raw.startsWith('"')) {
    try { return /^"(?:[^"\\]|\\.)*"$/.test(raw) ? JSON.parse(raw) : undefined; } catch { return undefined; }
  }
  if (raw.startsWith("'")) return /^'(?:[^']|'')*'$/.test(raw) ? raw.slice(1, -1).replaceAll("''", "'") : undefined;
  return /^[[\]{}#&*!|>%@`'"]|: |:$| #/.test(raw) ? undefined : raw;
}

// shortcut: a strict subset of YAML (`key: scalar` lines), as checks-core installs no YAML parser; anything outside it
// fails rather than passes. Switch to the `yaml` package once that job installs one.
function agentFields(block) {
  if (block === undefined) return null;
  const fields = {};
  for (const line of block.split('\n')) {
    const kv = /^([A-Za-z][\w-]*):(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    const value = kv && scalar(kv[2] ?? '');
    if (value === undefined || value === null) return null;
    fields[kv[1]] = value;
  }
  return fields;
}

export function lintAgent(file) {
  const text = readFileSync(file, 'utf8');
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];
  const keys = block?.match(/^[A-Za-z][\w-]*(?=:)/gm) ?? [];
  const ignored = IGNORED.filter((key) => keys.includes(key)).map((key) => `${file}: ${key} is ignored in a plugin agent`);
  const fm = agentFields(block);
  if (!fm) return [...ignored, `${file}: front matter missing, or not "key: value" lines with a plain or complete quoted value`];
  const missing = ['name', 'description'].filter((key) => !fm[key]).map((key) => `${file}: ${key} missing`);
  const long = fm.description?.length > 1024 ? [`${file}: description longer than 1024 characters`] : [];
  const model = fm.model === undefined || MODELS.includes(fm.model) ? [] : [`${file}: model "${fm.model}" is not one of ${MODELS.join(', ')}`];
  return [...ignored, ...missing, ...long, ...model];
}

// Word budgets for the body after front matter, soft (a warning) and hard (an error), in docs/authoring.md. The first class
// whose pattern matches a file's path relative to the repository applies.
const BUDGETS = [
  { kind: 'cl-workflow entry skill file', path: /(^|\/)cl-workflow\/skills\/workflow\/.+\.md$/, soft: 450, hard: 900 },
  { kind: 'bot brief', path: /\/skills\/[^/]+\/SOUL\.md$/, soft: 600, hard: 800 },
  { kind: 'bot procedure', path: /\/skills\/coordinate\/bot-[^/]+\.md$/, soft: 450, hard: 900 },
  { kind: 'SKILL.md', path: /\/skills\/[^/]+\/SKILL\.md$/, soft: 1200, hard: 3000 },
  { kind: 'skill reference file', path: /\/skills\/[^/]+\/.+\.md$/, soft: 1500, hard: 3000 },
  { kind: 'subagent prompt', path: /(^|\/)plugins\/[^/]+\/agents\/.+\.md$/, soft: 400, hard: 600 },
  { kind: 'rules file', path: /(^|\/)plugins\/[^/]+\/rules\/.+\.md$/, soft: 450, hard: 600 },
];

// Files that were over their hard cap when the budgets began, capped at that size: they may shrink, never grow.
const AT_SIZE = {
  'plugins/cl-orchestration/skills/coordinate/bot-project.md': 2207,
  'plugins/cl-orchestration/skills/coordinate/modes.md': 5215,
  'plugins/cl-orchestration/skills/coordinate/orca.md': 8987,
  'plugins/cl-orchestration/skills/coordinate/spec-template.md': 4114,
  'plugins/cl-repo/rules/project.md': 914,
  'plugins/cl-workflow/agents/review.md': 715,
  'plugins/cl-workflow/skills/workflow/SKILL.md': 1869,
  'plugins/cl-workflow/skills/workflow/software.md': 1155,
};

// The word budget of one instruction file (path relative to the repository, with / separators) and its text.
export function wordBudget(path, text, atSize = AT_SIZE) {
  const budget = BUDGETS.find((b) => b.path.test(path));
  if (!budget) return { errors: [], warnings: [] };
  const words = text.replace(/^---\n[\s\S]*?\n---\n/, '').split(/\s+/).filter(Boolean).length;
  const hard = Math.max(budget.hard, atSize[path] ?? 0);
  if (words > hard) {
    const cap = hard > budget.hard ? `its at-size cap of ${hard} (a ${budget.kind} allows ${budget.hard})` : `the ${hard}-word cap of a ${budget.kind}`;
    return { errors: [`${path}: ${words} words, over ${cap}`], warnings: [] };
  }
  const warnings = words > budget.soft ? [`${path}: ${words} words, over the ${budget.soft}-word budget of a ${budget.kind}`] : [];
  return { errors: [], warnings };
}

// A listed description, of a skill folder or an agent file, warns above 300 characters; above 1024 lintSkill and lintAgent fail.
export function descriptionWarnings(path) {
  const skill = !path.endsWith('.md');
  const file = skill ? join(path, 'SKILL.md') : path;
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const description = skill ? frontMatter(text)?.description?.slice(1, -1) : agentFields(/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1])?.description;
  return description?.length > 300 ? [`${file}: description of ${description.length} characters, over the 300-character budget`] : [];
}

// The folder named part of each plugin under plugins/ that has one.
const pluginParts = (part) => readdirSync(join(root, 'plugins')).map((p) => join(root, 'plugins', p, part)).filter((d) => existsSync(d));

// Claude Code loads a plugin's agents from agents/ and its subfolders.
export const ownAgents = () => pluginParts('agents').flatMap(markdownFiles);

// A command's words, split at spaces, quotes, commas, brackets and shell operators; and the index of its claude word, or -1.
const commandWords = (line) => line.split(/[\s'"`,()[\]{};|&<>]+/);
const claudeAt = (words) => words.findIndex((w) => /^claude(\.exe)?$/i.test(w.split(/[/\\]/).pop()));

// Hooks do not run in bare mode, the role guard's included (https://code.claude.com/docs/en/headless#start-faster-with-bare-mode).
// A line (continuations joined) whose words hold claude and after it --bare: a command line, or a spawn or execFile call
// with its argument list.
const bareLaunch = (text) =>
  text.replace(/[\\`]\r?\n/g, ' ').split('\n').some((line) => {
    const words = commandWords(line);
    const at = claudeAt(words);
    return at >= 0 && words.includes('--bare', at + 1);
  });

export const bareLaunches = (files) =>
  files.filter((file) => bareLaunch(readFileSync(file, 'utf8'))).map((file) => `${file}: starts claude with --bare, which runs no hooks (the role guard's included)`);

// A Claude Code worker starts in a terminal whose --command line sets its mode, never through Orca's own launch, which adds
// the flag of Orca's agent permission setting (bypass under full access). The flag wins over every settings file's defaultMode
// (https://code.claude.com/docs/en/permission-modes).
const LAUNCH_MODES = ['auto', 'dontAsk'];

// The role guard's launcher names and their normalization (plugins/cl-workflow/hooks/role-guard/role-guard.mjs, LAUNCHERS and
// launcher), copied: that hook reads its input from stdin when imported. A test keeps the two lists equal.
export const LAUNCHERS = new Set(['claude', 'claude-code']);
const launcher = (word) => word.split(/[/\\]/).pop().toLowerCase().replace(/\.exe$/, '').replace(/@[^@]*$/, '').replace(/\.(cmd|ps1|bat)$/, '');

// The words after a command's first launcher, or null when it starts no claude; and the first of them naming a dangerously flag.
const launchArgs = (command) => {
  const words = commandWords(command);
  const at = words.findIndex((w) => LAUNCHERS.has(launcher(w)));
  return at < 0 ? null : words.slice(at + 1);
};
const dangerousWord = (rest) => rest.find((w) => /dangerously/i.test(w));

// Why a command that starts claude does not start it in auto or dontAsk mode; null when it does or starts no claude.
// shortcut: words inside a quoted argument of claude count as its flags, so claude -p 'use --permission-mode auto' passes;
// a shell word parser would close this.
function launchMode(command) {
  const rest = launchArgs(command);
  if (!rest) return null;
  const dangerous = dangerousWord(rest);
  if (dangerous) return dangerous;
  // --permission-mode='auto' splits into "--permission-mode=" and "auto".
  const modes = rest.flatMap((w, i) => {
    const flag = /^--permission-mode(?:=(.*))?$/.exec(w);
    return flag ? [flag[1] || rest[i + 1] || ''] : [];
  });
  if (modes.length > 1) return '--permission-mode twice';
  if (!modes.length) return 'no --permission-mode';
  if (!modes[0]) return '--permission-mode without a value';
  return LAUNCH_MODES.includes(modes[0]) ? null : `--permission-mode ${modes[0]}`;
}

// Each --command "..." or '...' string, after spaces, = or \ continuations; a double-quoted one may hold escaped quotes.
// Either quote crosses a line only after a \ continuation (LF or CRLF), so an unclosed quote in prose does not hide the
// launch on a later line.
// shortcut: a bare line break inside the quotes (after && or in a "$(cat <<EOF ...)" heredoc) ends the read there, and an
// operator inside a quoted argument of claude or a redirect (2>&1) splits the string, so a second --permission-mode after
// it goes unread; a shell parser would close both. A dangerously word anywhere after the first launcher is still caught.
export const launchCommands = (text) =>
  [...text.matchAll(/--command[\s=\\]+(?:"((?:[^"\\\n]|\\(?:\r\n|[\s\S]))*)"|'((?:\\\r?\n|[^'\n])*)')/g)].map((m) => ({ index: m.index, command: m[1] ?? m[2] }));

export function launchModes(files) {
  return files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    const at = (index) => `${file}:${text.slice(0, index).split('\n').length}`;
    const commands = launchCommands(text).flatMap(({ index, command }) => {
      // Continuations joined. The whole string first: a quoted operator or a redirect (2>&1) splits off the flags after it.
      // Then each command of the string: a claude after && or || needs its own mode.
      const joined = command.replace(/\\\r?\n/g, ' ');
      const why = dangerousWord(launchArgs(joined) ?? []) ?? joined.split(/&&|\|\||[;|&\n]/).map(launchMode).find(Boolean);
      return why ? [`${at(index)}: --command starts claude with ${why}; it takes one --permission-mode, auto or dontAsk`] : [];
    });
    // Anywhere in the text: a command line, a continuation line, an argument list, or a sentence that tells the coordinator to use it.
    const orca = [...text.matchAll(/--agent[\s=\\'"`,]+claude(?![\w-])/gi)]
      .map((m) => `${at(m.index)}: --agent claude starts the worker through Orca's own launch, which takes Orca's agent permission setting; start a Claude Code worker in its own terminal`);
    return [...commands, ...orca];
  });
}

// The files every plugin ships; its tests name commands the hooks deny.
export function pluginFiles() {
  const plugins = join(root, 'plugins');
  return readdirSync(plugins, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .flatMap(({ name }) => filesIn(join(plugins, name)).filter((p) => !p.slice(plugins.length).split(sep).includes('test')));
}

export function ownSkills() {
  return pluginParts('skills').flatMap((d) => readdirSync(d).map((n) => join(d, n)).filter((p) => statSync(p).isDirectory()));
}

if (isMain(import.meta.url)) {
  const dirs = process.argv.length > 2 ? process.argv.slice(2).map((d) => resolve(d)) : ownSkills();
  const agents = process.argv.length > 2 ? [] : ownAgents();
  const files = process.argv.length > 2 ? [] : pluginFiles();
  const launches = [...bareLaunches(files), ...launchModes(files)];
  const instructions = process.argv.length > 2 ? dirs.flatMap(markdownFiles) : [...pluginParts('skills'), ...pluginParts('agents'), ...pluginParts('rules')].flatMap(markdownFiles);
  const budgets = instructions.map((f) => wordBudget(relative(root, f).split(sep).join('/'), readFileSync(f, 'utf8')));
  const errors = [...dirs.flatMap(lintSkill), ...agents.flatMap(lintAgent), ...launches, ...budgets.flatMap((b) => b.errors)];
  const warnings = [...[...dirs, ...agents].flatMap(descriptionWarnings), ...budgets.flatMap((b) => b.warnings)];
  for (const e of errors) console.log(`::error::${e.replace(root + '/', '')}`);
  for (const w of warnings) console.log(`::warning::${w.replace(root + '/', '')}`);
  console.log(`${agents.length} agents, ${dirs.length} skills checked, ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
