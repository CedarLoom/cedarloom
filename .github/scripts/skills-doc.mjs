// Writes the skill table of docs/skills.md from the SKILL.md front matter of the plugins' skills, and the site's copy of the cedarloom.json schema from the plugin's.
// Usage: node .github/scripts/skills-doc.mjs [--check]   (--check: exit 1 when a file differs)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './main.mjs';
import { frontMatter } from './skill-lint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const START = '<!-- generated:skills -->';
const END = '<!-- /generated:skills -->';

const row = (cells) => `| ${cells.join(' | ')} |`;
const unquote = (v) => (v ?? '').replace(/^"(.*)"$/, '$1');

// One skill's row fields; the "when" comes from `metadata.when`, else from the description after its first sentence.
export function skillEntry(text, plugin) {
  const fm = frontMatter(text);
  const name = fm?.name;
  const metadata = fm?.metadata ?? {};
  const writes = unquote(metadata.writes);
  if (!name || !fm.description || !writes) throw new Error(`${name ?? 'a skill'}: front matter needs name, description and metadata.writes`);
  // The first sentence ends at the first period followed by white space or the end.
  const description = unquote(fm.description), end = /\.(?:\s+|$)/.exec(description);
  if (!end) throw new Error(`${name}: the description needs a sentence that ends with a period`);
  const purpose = description.slice(0, end.index + 1), rest = description.slice(end.index + end[0].length);
  const when = unquote(metadata.when) || rest;
  if (!when) throw new Error(`${name}: needs metadata.when or a second sentence in the description`);
  const user = fm['disable-model-invocation'] === 'true';
  // `metadata.codex: "false"` marks a skill that runs only in Claude Code.
  const codex = unquote(metadata.codex) === 'false' ? '' : ` (Codex \`$${plugin}:${name}\`)`;
  // `user-invocable: false` hides the skill from the / menu: only the agent starts it.
  const start = user ? `you: \`/${plugin}:${name}\`${codex}` : fm['user-invocable'] === 'false' ? 'the agent' : `the agent, or you with \`/${plugin}:${name}\``;
  return { name, plugin, purpose, start, when, writes };
}

export function render(skills) {
  const out = [row(['Skill', 'What it is for', 'Started by', 'When it runs', 'What it writes']), row(['---', '---', '---', '---', '---'])];
  for (const s of skills) out.push(row([`[${s.name}](../plugins/${s.plugin}/skills/${s.name}/SKILL.md)`, s.purpose, s.start, s.when, s.writes]));
  return out.join('\n');
}

export function update(page, skills) {
  const a = page.indexOf(START);
  const b = page.indexOf(END);
  if (a < 0 || b < a) throw new Error(`docs/skills.md needs ${START} and ${END}`);
  return `${page.slice(0, a + START.length)}\n${render(skills)}\n${page.slice(b)}`;
}

// Every plugin's skills in one table, sorted by name.
export function sources() {
  const plugins = readdirSync(`${root}/plugins`).sort();
  return plugins.filter((p) => existsSync(`${root}/plugins/${p}/skills`))
    .flatMap((p) => readdirSync(`${root}/plugins/${p}/skills`).map((n) => skillEntry(readFileSync(`${root}/plugins/${p}/skills/${n}/SKILL.md`, 'utf8'), p)))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

if (isMain(import.meta.url)) {
  // The site serves its copy at the URL a cedarloom.json names in "$schema"; the plugin validates against its own.
  const files = [
    ['docs/skills.md', 'the skill front matter', (page) => update(page, sources())],
    ['site/static/schema/cedarloom.json', 'plugins/cl-orchestration/skills/coordinate/cedarloom.schema.json', () => readFileSync(`${root}/plugins/cl-orchestration/skills/coordinate/cedarloom.schema.json`, 'utf8')],
  ];
  for (const [name, source, expected] of files) {
    const file = `${root}/${name}`;
    // A missing copy reads as empty: --check then fails and the write creates it.
    let page = '';
    try { page = readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const next = expected(page);
    if (process.argv[2] !== '--check') {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, next);
    } else if (next !== page) {
      console.log(`::error::${name} differs from ${source}: run node .github/scripts/skills-doc.mjs`);
      process.exitCode = 1;
    }
  }
}
