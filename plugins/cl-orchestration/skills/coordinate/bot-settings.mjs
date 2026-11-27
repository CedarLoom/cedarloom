// Usage: node bot-settings.mjs [--check] <role> <home> [--other <home>]... [--lock <host lock folder>], every path absolute. Writes <home>/.claude/settings.json of a bot (setup-bots.md, Bot homes) from its template in bot-settings.json: role is builder, reviewer, maintain or project; a role bot names every other bot's home with --other and the host lock folder with --lock, the project bot neither. A rule with <other home> repeats for each --other. With --check it writes nothing and exits 0 only when the file's text is exactly what it would write now. Any other input prints the error, exits 1 and writes nothing.
// The role templates deny file-tool writes to the instruction files of a home and its clones/ since Claude Code and Codex load CLAUDE.md, CLAUDE.local.md, AGENTS.md and .mcp.json from the folder a run starts in, and Claude Code loads CLAUDE.md and .claude/ from clones/ once a run reads files below it: a run that wrote one would steer the next. A refused MEMORY.md write keeps the builder's and reviewer's memory off.
import { lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { escaped, isMain } from './policy.mjs';
import { writeState } from './state.mjs';
import { PLAIN, readRegular } from './worker-settings.mjs';

const ROLES = ['builder', 'reviewer', 'maintain', 'project'];

// The settings of one bot from templates (bot-settings.json); paths are checked by the caller.
export function botSettings(templates, role, { home, others = [], lock }) {
  const template = templates[role === 'builder' || role === 'reviewer' ? 'role' : role];
  const fill = (text) => text.replaceAll('<role>', role).replaceAll('<home>', home).replaceAll('<host lock folder>', lock);
  const deny = template.permissions.deny.flatMap((rule) => (rule.includes('<other home>') ? others.map((other) => fill(rule.replaceAll('<other home>', other))) : [fill(rule)]));
  return { ...template, env: Object.fromEntries(Object.entries(template.env).map(([k, v]) => [k, fill(v)])), permissions: { ...template.permissions, deny } };
}

if (isMain(import.meta.url)) {
  try {
    const usage = 'usage: node bot-settings.mjs [--check] <role> <home> [--other <home>]... [--lock <host lock folder>]';
    const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true, options: { check: { type: 'boolean' }, other: { type: 'string', multiple: true }, lock: { type: 'string' } } });
    const [role, home, ...rest] = positionals;
    const others = values.other ?? [];
    const project = role === 'project';
    if (!ROLES.includes(role) || !home || rest.length || project !== (values.lock === undefined && !others.length) || (!project && (!values.lock || !others.length))) throw new Error(usage);
    // A pattern character or a bracket in a path would widen or break every rule with it.
    for (const path of [home, ...others, ...(values.lock ? [values.lock] : [])]) if (!PLAIN.test(path)) throw new Error(`${escaped(path)} is not an absolute path without a pattern character, a bracket or a trailing /`);
    if (others.includes(home)) throw new Error('--other names the bot\'s own home');
    const templates = JSON.parse(readFileSync(new URL('./bot-settings.json', import.meta.url), 'utf8'));
    const settings = botSettings(templates, role, { home, others, lock: values.lock });
    const file = join(home, '.claude', 'settings.json'), text = `${JSON.stringify(settings, null, 2)}\n`;
    if (lstatSync(dirname(file), { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${escaped(dirname(file))} is a link: not written or read`);
    if (values.check) {
      if (readRegular(file) !== text) throw new Error(`${escaped(file)} is not the settings file this script writes for those arguments`);
    } else {
      mkdirSync(dirname(file), { recursive: true });
      // A rename replaces the file, never a link's target.
      writeState(file, settings);
    }
  } catch (e) {
    console.error(escaped(e.message));
    process.exitCode = 1;
  }
}
