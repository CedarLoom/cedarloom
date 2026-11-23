#!/usr/bin/env node
// Token budget for instruction files and docs: estimated tokens per file, protected spans, cuts by line range, dead references.
// Usage: node token-budget.mjs <measure|protect|cut|baseline|check> [options]   (USAGE below; exit 0 ok, 1 check failed, 2 usage error)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `node token-budget.mjs <command> [--root <dir>]
  measure [files...] [--json]        lines, bytes, estimated, always-loaded and listed tokens and sha256 per file
  protect --suggest [files...]       candidate spans that must stay, as JSON line ranges
  protect --add <file>:<start>-<end> ...   copy these lines into the protect list of the config
  cut --plan <plan.json> [--apply]   check a cut plan; write the cuts only with --apply
  baseline [--write]                 print the current counts; --write stores them in the config
  check [--against <measure.json>]   token change, protected spans, dead references, budgets
        [--budget-only]              fail only above a budget; the rest becomes a warning`;

export const CONFIG = '.github/token-budget.json';
const INCLUDE = [
  '**/CLAUDE.md', '**/AGENTS.md', '.claude/rules/**/*.md', '.claude/skills/**/*.md', '.claude/agents/**/*.md', '.claude/commands/**/*.md',
  'plugins/*/skills/**/*.md', 'plugins/*/agents/**/*.md', 'plugins/*/rules/**/*.md',
  'README.md', 'docs/**/*.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/*.md',
];
const EXCLUDE = ['**/node_modules/**', '**/CHANGELOG.md'];

// A token is counted as four bytes: an offline estimate. Compare changes, not absolute values.
export const tokensOf = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const linesOf = (text) => (text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/));
const sum = (values) => values.reduce((n, v) => n + v, 0);
// Code-unit order, the same on every machine: localeCompare would follow the locale and reorder the stored baseline.
const byCodeUnit = (a, b) => Number(a > b) - Number(a < b);

export function globRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// The raw config is what `protect --add` and `baseline --write` write back; the defaults never land in the file.
export function loadConfig(root) {
  const file = join(root, CONFIG);
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return { raw, include: raw.include ?? INCLUDE, exclude: raw.exclude ?? EXCLUDE, budget: raw.budget ?? {}, alwaysLoadedFiles: raw.alwaysLoadedFiles ?? [], protect: raw.protect ?? [], baseline: raw.baseline ?? {}, ignoreRefs: (raw.ignoreRefs ?? []).map((p) => new RegExp(p)) };
}

function saveConfig(root, raw) {
  mkdirSync(dirname(join(root, CONFIG)), { recursive: true });
  writeFileSync(join(root, CONFIG), `${JSON.stringify(raw, null, 2)}\n`);
}

function walk(root, dir = '') {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(root, path) : [path];
  });
}

// git from a system folder, so the PATH search does not decide which program runs.
const GIT = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe')].find((p) => existsSync(p));

// Started from a hook or `git rebase --exec`, these variables name another repository or index and carry that command's -c settings;
// outside a hook the GIT_CONFIG_* ones are the caller's own settings (safe.directory of a checkout another user owns) and reach git.
const REPO_VARS = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/i;
const CONFIG_VARS = /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/i;
const gitEnv = () => {
  const fromHook = Object.keys(process.env).some((k) => REPO_VARS.test(k));
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !REPO_VARS.test(k) && !(fromHook && CONFIG_VARS.test(k))));
};

// Tracked and untracked files that git does not ignore; outside a git repository or without git, every file.
function repoFiles(root) {
  if (!GIT) return walk(root);
  try {
    return execFileSync(GIT, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, env: gitEnv(), encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch {
    return walk(root);
  }
}

// Whether git ignores `path`; false outside a git repository, without git, or when git cannot check the path (exit 128).
function ignored(root, path) {
  if (!GIT) return false;
  try {
    execFileSync(GIT, ['check-ignore', '-q', '--', path], { cwd: root, env: gitEnv(), stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function scope(root, cfg) {
  const inc = cfg.include.map(globRegex);
  const exc = cfg.exclude.map(globRegex);
  return [...new Set(repoFiles(root))].filter((p) => inc.some((re) => re.test(p)) && !exc.some((re) => re.test(p)) && existsSync(join(root, p))).sort(byCodeUnit);
}

// Front matter as `key: value` fields (quotes dropped) with their first and last line, and the number of its closing `---` line;
// end 0 when there is none. Indented lines continue the field above: a folded or literal block, or a wrapped value.
export function frontMatter(lines) {
  if (lines[0] !== '---') return { fields: {}, end: 0 };
  const close = lines.indexOf('---', 1);
  if (close < 0) return { fields: {}, end: 0 };
  const fields = {};
  let last;
  for (let i = 1; i < close; i++) {
    const kv = /^([A-Za-z][\w-]*):(.*)$/.exec(lines[i]);
    if (kv) last = fields[kv[1]] = { parts: [kv[2].trim()], line: i + 1, end: i + 1 };
    else if (last && /^\s+\S/.test(lines[i])) { last.parts.push(lines[i].trim()); last.end = i + 1; }
  }
  for (const f of Object.values(fields)) {
    const parts = /^[|>][1-9+-]*$/.test(f.parts[0]) ? f.parts.slice(1) : f.parts;
    f.value = parts.join(' ').replace(/^(["'])(.*)\1$/, '$2');
    delete f.parts;
  }
  return { fields, end: close + 1 };
}

const SKILL = /(^|\/)skills\/[^/]+\/SKILL\.md$/;
const AGENT = /(^|\/)(\.claude|plugins\/[^/]+)\/agents\/.+\.md$/;
const COMMAND = /^\.claude\/commands\/.+\.md$/;

// A skill whose agents/openai.yaml sets `allow_implicit_invocation: false` as a direct child of `policy` is not listed in Codex;
// Codex does not read .claude/skills.
function codexHides(root, path) {
  if (path.startsWith('.claude/')) return true;
  const yaml = join(root, dirname(path), 'agents', 'openai.yaml');
  if (!existsSync(yaml)) return false;
  let policy = false;
  let indent;
  for (const line of linesOf(readFileSync(yaml, 'utf8'))) {
    if (/^\s*(#|$)/.test(line)) continue;
    const lead = /^ */.exec(line)[0].length;
    if (!lead) { policy = /^policy:\s*(#.*)?$/.test(line); indent = undefined; }
    else if (policy && lead === (indent ??= lead) && /^\s*allow_implicit_invocation:\s*false\s*(#.*)?$/.test(line)) return true;
  }
  return false;
}

// The description line of a skill or command the model can start, or of a subagent: it sits in every session's listing.
// A skill counts as listed when either host lists it; Claude Code hides one with `disable-model-invocation: true`
// (https://code.claude.com/docs/en/skills). A .claude/commands file is a skill to Claude Code; Codex does not read it.
function routing(path, lines, root) {
  const { fields } = frontMatter(lines);
  const hidden = fields['disable-model-invocation']?.value === 'true';
  const listed = (SKILL.test(path) && !(hidden && codexHides(root, path))) || (COMMAND.test(path) && !hidden) || AGENT.test(path);
  return listed && fields.description ? fields : null;
}

// Listing cost: name and description, and for a skill `when_to_use`, cut at 1,536 characters as Claude Code cuts them.
// A command has no `name` field: the file name is its name.
export function listedTokens(path, lines, root = '.') {
  const fields = routing(path, lines, root);
  if (!fields) return 0;
  const text = [fields.description.value, fields.when_to_use?.value].filter(Boolean).join(' ');
  const command = COMMAND.test(path);
  return tokensOf(`${command ? posix.basename(path, '.md') : fields.name?.value ?? ''}: ${SKILL.test(path) || command ? text.slice(0, 1536) : text}`);
}

const ROOT_INSTRUCTIONS = /^(\.claude\/)?(CLAUDE|AGENTS)\.md$/;
const IMPORT = /(^|\s)@([\w./-]*[/.][\w/-]+)/g;
const importsOf = (path, text) => [...prose(linesOf(text))].flatMap(([, line]) => [...line.replace(/`[^`]*`/g, ' ').matchAll(IMPORT)].map((m) => posix.join(posix.dirname(path), m[2])));

// Text every session loads in at least one host, so the sum is an upper bound. Counted whole: root CLAUDE.md and AGENTS.md
// (also in .claude/), root .claude/rules without `paths`, the files in alwaysLoadedFiles, and in-scope files these import up to
// four hops (https://code.claude.com/docs/en/memory). Every other file counts its listing text.
// Returns the always-loaded text it cannot count: imported files in the repository that git does not ignore outside the
// measured set, and alwaysLoadedFiles patterns that match no measured file.
function classify(root, cfg, files, texts) {
  const extra = cfg.alwaysLoadedFiles.map(globRegex);
  const unscopedRule = (p) => /^\.claude\/rules\/.+\.md$/.test(p) && !('paths' in frontMatter(linesOf(texts[p])).fields);
  const paths = Object.keys(files);
  const unmeasured = cfg.alwaysLoadedFiles.filter((_, i) => !paths.some((p) => extra[i].test(p))).map((g) => `alwaysLoadedFiles ${g} matches no measured file`);
  let hop = paths.filter((p) => ROOT_INSTRUCTIONS.test(p) || unscopedRule(p) || extra.some((re) => re.test(p)));
  const whole = new Set(hop);
  for (let depth = 0; depth < 4 && hop.length; depth++) {
    const next = new Set();
    for (const from of hop) {
      for (const p of importsOf(from, texts[from])) {
        if (Object.hasOwn(files, p)) { if (!whole.has(p)) next.add(p); }
        else if (!p.startsWith('../') && isFile(join(root, p)) && !ignored(root, p)) unmeasured.push(`${p}: loads every session (imported by ${from}) but is not measured (include, exclude)`);
      }
    }
    hop = [...next];
    for (const p of hop) whole.add(p);
  }
  // A CLAUDE.md that links to AGENTS.md is one text: count each target once.
  const seen = new Set();
  for (const [p, f] of Object.entries(files)) {
    const real = whole.has(p) ? realpathSync(join(root, p)) : null;
    f.always = real && !seen.has(real) ? f.tokens : f.listed;
    if (real) seen.add(real);
  }
  return [...new Set(unmeasured)];
}

export function measure(root, cfg, only = []) {
  const files = {};
  const texts = {};
  for (const path of only.length ? only.map((p) => posix.normalize(p)) : scope(root, cfg)) {
    const text = texts[path] = readFileSync(join(root, path), 'utf8');
    files[path] = { lines: linesOf(text).length, bytes: Buffer.byteLength(text, 'utf8'), tokens: tokensOf(text), listed: listedTokens(path, linesOf(text), root), sha256: sha256(text) };
  }
  const unmeasured = classify(root, cfg, files, texts);
  const all = Object.values(files);
  return { files, total: sum(all.map((f) => f.tokens)), listed: sum(all.map((f) => f.listed)), alwaysLoaded: sum(all.map((f) => f.always)), unmeasured };
}

// The 1-based line range that holds a protected span, whatever the line breaks and spacing are now; null when the text is gone.
export function locate(lines, span) {
  const starts = [];
  let joined = '';
  lines.forEach((line, i) => {
    const n = norm(line);
    if (!n) return;
    if (joined) joined += ' ';
    starts.push([joined.length, i + 1]);
    joined += n;
  });
  const at = joined.indexOf(span);
  if (at < 0) return null;
  const lineAt = (offset) => starts.findLast(([o]) => o <= offset)[1];
  return { start: lineAt(at), end: lineAt(at + span.length - 1) };
}

// Lines outside code fences, as [1-based number, text].
function* prose(lines) {
  let fence;
  for (let i = 0; i < lines.length; i++) {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i])?.[1];
    if (mark) {
      if (!fence) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = undefined;
    } else if (!fence) yield [i + 1, lines[i]];
  }
}

const RULE = /\b(never|must not|do not|don't|may not|forbidden|prohibited)\b/i;
const LEGAL = /\b(licen[sc]e[sd]?|copyright|SPDX-License-Identifier|warranty|liabilit(y|ies)|trademarks?)\b/i;
const SECTION = /\b(never|safety|security|legal|licen[sc]e|constraints?|rules|decisions?)\b/i;
const ITEM = /^\s*([-*+]|\d+[.)])\s/;
const HEADING = /^ {0,3}(#{1,6})[ \t](.*)$/;

// Candidates only: the patterns miss rules worded another way, so the reader of the file adds those by hand.
// A listed description is one line whose trigger and boundary sentences ("Use when", "Do not use") route every session.
export function suggest(lines, path = '', root = '.') {
  const ranges = [];
  const text = (n) => lines[n - 1] ?? '';
  const description = routing(path, lines, root)?.description;
  if (description) ranges.push({ start: description.line, end: description.end, reason: 'routing description' });
  for (const [no, line] of prose(lines)) {
    const h = HEADING.exec(line);
    if (h && h[1].length > 1 && SECTION.test(h[2])) {
      let end = no;
      while (end < lines.length && !(HEADING.exec(text(end + 1))?.[1].length <= h[1].length)) end++;
      while (end > no && !text(end).trim()) end--;
      ranges.push({ start: no, end, reason: `section "${h[2].trim()}"` });
    } else if (!h && (RULE.test(line) || LEGAL.test(line))) {
      let start = no;
      let end = no;
      while (start > 1 && !ITEM.test(text(start)) && text(start - 1).trim() && !HEADING.test(text(start - 1))) start--;
      while (end < lines.length && text(end + 1).trim() && !ITEM.test(text(end + 1)) && !HEADING.test(text(end + 1))) end++;
      ranges.push({ start, end, reason: RULE.test(line) ? 'prohibition' : 'legal or license text' });
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

export function addProtected(root, cfg, refs) {
  const protect = [...cfg.protect];
  for (const ref of refs) {
    const m = /^(.+):(\d+)-(\d+)$/.exec(ref);
    if (!m) throw new Error(`protect --add takes <file>:<start>-<end>, got ${ref}`);
    const [, file, start, end] = m;
    const lines = linesOf(readFileSync(join(root, file), 'utf8'));
    if (+start < 1 || +end > lines.length || +start > +end) throw new Error(`${ref}: the file has ${lines.length} lines`);
    const text = norm(lines.slice(start - 1, end).join(' '));
    if (text && !protect.some((p) => p.file === file && p.text === text)) protect.push({ file, text });
  }
  saveConfig(root, { ...cfg.raw, protect });
  return protect;
}

export function missingProtected(root, cfg, contents = {}) {
  const out = [];
  const read = (path) => contents[path] ?? (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '');
  for (const { file, text } of cfg.protect) {
    if (locate(linesOf(read(file)), text)) continue;
    const moved = scope(root, cfg).find((p) => p !== file && locate(linesOf(read(p)), text));
    out.push(`${file}: protected text is gone${moved ? ` (found in ${moved}: change the entry's file if the move is intended)` : ''}: "${text.slice(0, 80)}"`);
  }
  return out;
}

// A plan is { "cuts": [{ "file", "start", "end", "reason", "sha256" }] }. Cuts delete whole lines; nothing is reworded.
export function planCuts(root, cfg, plan) {
  const errors = [];
  const contents = {};
  const rows = [];
  const inScope = new Set(scope(root, cfg));
  const byFile = Map.groupBy(plan.cuts ?? [], (c) => c.file);
  for (const [file, cuts] of byFile) {
    // The config holds the protect list: a cut there could remove the guard that checks this plan.
    if (!inScope.has(file) || file === CONFIG) { errors.push(`${file}: not an instruction file or doc in scope`); continue; }
    // A write follows a symlink, of the file or of a folder above it, to a target that can lie outside the repository or the scope.
    if (realpathSync(join(root, file)) !== join(realpathSync(root), file)) { errors.push(`${file}: a symlink or in a symlinked folder: cut the file it points to`); continue; }
    const text = readFileSync(join(root, file), 'utf8');
    const lines = linesOf(text);
    // Each line with its own line break, so that the kept lines stay byte for byte (CRLF, a missing last break).
    const raw = text.split(/(?<=\n)/).filter(Boolean);
    cuts.sort((a, b) => a.start - b.start);
    const head = frontMatter(lines).end;
    const inFile = (c) => Number.isInteger(c.start) && Number.isInteger(c.end) && c.start >= 1 && c.end <= lines.length && c.start <= c.end;
    for (const [i, c] of cuts.entries()) {
      const at = `${file}:${c.start}-${c.end}`;
      if (!inFile(c)) errors.push(`${at}: not a line range of this file (${lines.length} lines)`);
      if (c.start <= head) errors.push(`${at}: cuts into the front matter (lines 1-${head}); a description or setting changes through a reviewed rewrite, not a cut`);
      if (!c.reason?.trim()) errors.push(`${at}: no reason`);
      if (!c.sha256) errors.push(`${at}: no sha256: take it from measure --json`);
      else if (c.sha256 !== sha256(text)) errors.push(`${at}: the file changed since the plan was made; measure again`);
      if (i && c.start <= cuts[i - 1].end) errors.push(`${at}: overlaps ${file}:${cuts[i - 1].start}-${cuts[i - 1].end}`);
    }
    // Only ranges inside the file: an end far beyond it would allocate one entry per line number.
    const drop = new Set(cuts.filter(inFile).flatMap((c) => Array.from({ length: Math.max(0, c.end - c.start + 1) }, (_, k) => c.start + k)));
    const kept = lines.filter((_, i) => !drop.has(i + 1));
    contents[file] = raw.filter((_, i) => !drop.has(i + 1)).join('');
    for (const c of cuts) rows.push({ file, start: c.start, end: c.end, freed: tokensOf(raw.slice(c.start - 1, c.end).join('')), reason: c.reason });
    if (!kept.some((l) => l.trim())) errors.push(`${file}: every line would be cut; this tool does not empty or delete files`);
  }
  errors.push(...missingProtected(root, cfg, contents).map((e) => `refused, a cut removes protected text: ${e}`));
  const before = measure(root, cfg);
  const after = { ...Object.fromEntries(Object.entries(before.files).map(([p, f]) => [p, f.tokens])), ...Object.fromEntries(Object.entries(contents).filter(([p]) => before.files[p]).map(([p, t]) => [p, tokensOf(t)])) };
  // The floor: what stays when everything but the protected text is cut. A budget below it cannot be reached.
  // Per file the lines its spans cover, so overlapping spans count once.
  const floor = sum([...Map.groupBy(cfg.protect.filter((p) => before.files[p.file]), (p) => p.file)].map(([file, spans]) => {
    const lines = linesOf(readFileSync(join(root, file), 'utf8'));
    const keep = new Set(spans.map((p) => locate(lines, p.text)).filter(Boolean).flatMap((r) => Array.from({ length: r.end - r.start + 1 }, (_, k) => r.start + k)));
    return tokensOf(lines.filter((_, i) => keep.has(i + 1)).map((l) => `${l}\n`).join(''));
  }));
  return { errors, contents, rows, before: before.total, after: sum(Object.values(after)), floor, budget: cfg.budget.total ?? null };
}

// A heading's text without its closing `#` sequence.
const headingText = (text) => {
  const t = text.trim();
  let end = t.length;
  while (end > 0 && t[end - 1] === '#') end--;
  return t.slice(0, end).trimEnd();
};
const slug = (heading) => heading.replace(/\[([^[\]]*)\]\([^()]*\)/g, '$1').replace(/[`*]/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');

// Heading anchors as GitHub builds them (a repeated heading gets -1, -2), plus explicit name and id attributes.
export function anchorsOf(text) {
  const out = new Set();
  const seen = new Map();
  for (const [, line] of prose(linesOf(text))) {
    for (const [, id] of line.matchAll(/<[a-z]+\s[^>]*\b(?:name|id)="([^"]+)"/g)) out.add(id.toLowerCase());
    const h = HEADING.exec(line);
    if (!h) continue;
    const base = slug(headingText(h[2]));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// The path in a backticked token, without trailing punctuation, a `#fragment` or a `:line` or `:start-end` suffix.
function pathOf(token) {
  let end = token.length;
  while (end > 0 && '.,;:'.includes(token[end - 1])) end--;
  const t = token.slice(0, end);
  const hash = t.indexOf('#');
  if (hash >= 0) return t.slice(0, hash);
  const colon = t.lastIndexOf(':');
  return colon >= 0 && /^\d+(?:-\d+)?$/.test(t.slice(colon + 1)) ? t.slice(0, colon) : t;
}

// Link destinations as CommonMark reads them (https://spec.commonmark.org/0.31.2/#links): inside `<>` with spaces and escapes,
// or bare with backslash escapes and balanced parentheses (three levels, the depth the spec asks for); an inline link may
// close with a title in "", '' or (), where a backslash escapes the delimiter.
const CHAR = String.raw`\\.|[^()\s\\]`;
const nest = (inner) => String.raw`\((?:${CHAR}${inner})*\)`;
const DESTINATION = String.raw`(?:<((?:\\.|[^<>\n\\])*)>|(?!<)((?:${CHAR}|${nest(`|${nest(`|${nest('')}`)}`)})+))`;
const INLINE = new RegExp(String.raw`\]\(\s*${DESTINATION}(?:\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\)))?\s*\)`, 'g');
const DEFINITION = new RegExp(String.raw`^ {0,3}\[(?!\^)[^\]]+\]:\s*${DESTINATION}`);
const unescape = (s) => s.replace(/\\([!-/:-@[-`{-~])/g, '$1');

// Dead references: links, heading anchors and CLAUDE.md imports are errors; a backticked path is a warning, as that match is a heuristic.
export function deadRefs(root, cfg, paths = scope(root, cfg)) {
  const out = [];
  const anchors = new Map();
  const anchorsIn = (abs) => anchors.get(abs) ?? anchors.set(abs, anchorsOf(readFileSync(abs, 'utf8'))).get(abs);
  const ignored = (target) => cfg.ignoreRefs.some((re) => re.test(target));
  for (const file of paths) {
    const abs = join(root, file);
    const dir = dirname(abs);
    const imports = /(^|\/)CLAUDE(\.local)?\.md$/.test(file);
    for (const [line, raw] of prose(linesOf(readFileSync(abs, 'utf8')))) {
      const plain = raw.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
      const dead = (kind, target, level = 'error') => { if (!ignored(target)) out.push({ file, line, kind, target, level }); };
      // Inline links, and the definition of a reference link (`[s]: #setup`); a footnote (`[^1]:`) is no link.
      const definition = DEFINITION.exec(plain);
      for (const target of [...plain.matchAll(INLINE), ...(definition ? [definition] : [])].map((m) => unescape(m[1] ?? m[2]))) {
        if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
        const [path, fragment] = target.split('#');
        const clean = decode(path.split('?')[0]);
        const to = !clean ? abs : clean.startsWith('/') ? join(root, clean) : join(dir, clean);
        if (!existsSync(to)) dead('link', target);
        else if (fragment && to.endsWith('.md') && isFile(to) && !anchorsIn(to).has(decode(fragment).toLowerCase())) dead('anchor', target);
      }
      if (imports) for (const [, , target] of plain.matchAll(IMPORT)) if (!existsSync(join(dir, target))) dead('import', `@${target}`);
      for (const [, token] of raw.matchAll(/`([^`\s]+)`/g)) {
        const path = pathOf(token);
        if (!/^(\.{1,2}\/)?[\w@.-]+(\/[\w@.-]+)+\/?$/.test(path)) continue;
        if ([dir, root].some((base) => existsSync(join(base, path)))) continue;
        const first = path.split('/')[0];
        if (first.startsWith('.') ? /^\.{1,2}$/.test(first) || existsSync(join(root, first)) : [dir, root].some((base) => existsSync(join(base, first)))) dead('path', token, 'warning');
      }
    }
  }
  return out;
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// A budget the caps cannot read would pass silently: a misspelled key, a string, a capped file that is no longer measured.
function budgetErrors(budget, files) {
  if (!isObject(budget)) return ['budget is not an object'];
  const out = Object.keys(budget).filter((k) => !['total', 'alwaysLoaded', 'files'].includes(k)).map((k) => `budget.${k} is not a budget key (total, alwaysLoaded, files)`);
  out.push(...['total', 'alwaysLoaded'].filter((k) => k in budget && !isNumber(budget[k])).map((k) => `budget.${k} is not a number`));
  if (!('files' in budget)) return out;
  if (!isObject(budget.files)) return [...out, 'budget.files is not an object'];
  for (const [p, max] of Object.entries(budget.files)) {
    if (!isNumber(max)) out.push(`budget.files ${p} is not a number`);
    else if (max < 0) out.push(`budget.files ${p} is negative`);
    if (!Object.hasOwn(files, p)) out.push(`budget.files ${p} is not a measured file`);
  }
  return out;
}
const change = (before, now) => `${before == null ? '' : `${before} before, `}${now} now`;

// The report of the CI check and of the skill's verify step, as Markdown.
export function check(root, cfg, against, budgetOnly = false) {
  const now = measure(root, cfg);
  const prev = against ? Object.fromEntries(Object.entries(against.files).map(([p, f]) => [p, f.tokens])) : cfg.baseline;
  const known = Object.keys(prev).length > 0;
  const paths = [...new Set([...Object.keys(prev), ...Object.keys(now.files)])].sort(byCodeUnit);
  const changed = paths.filter((p) => (prev[p] ?? 0) !== (now.files[p]?.tokens ?? 0));
  const before = sum(Object.values(prev));
  const out = ['### Token budget', ''];
  if (!known) out.push(`No baseline: ${now.total} estimated tokens in ${paths.length} files. Store one with \`baseline --write\`.`);
  else {
    out.push('| File | Before | After | Change |', '| --- | ---: | ---: | ---: |');
    for (const p of changed) out.push(`| ${p} | ${prev[p] ?? 0} | ${now.files[p]?.tokens ?? 0} | ${signed((now.files[p]?.tokens ?? 0) - (prev[p] ?? 0))} |`);
    out.push(`| **Total (${paths.length} files)** | ${before} | ${now.total} | ${signed(now.total - before)} |`);
  }
  const refs = deadRefs(root, cfg);
  const broken = [...missingProtected(root, cfg), ...refs.filter((r) => r.level === 'error').map((r) => `${r.file}:${r.line}: dead ${r.kind} ${r.target}`)];
  const failures = [
    // The raw value: loadConfig reads a null budget as none.
    ...(Object.hasOwn(cfg.raw, 'budget') ?budgetErrors(cfg.raw.budget, now.files) : []),
    ...now.unmeasured,
    ...(budgetOnly ? [] : broken),
    ...(cfg.budget.total != null && now.total > cfg.budget.total ? [`total ${now.total} is above the budget ${cfg.budget.total}`] : []),
    ...(cfg.budget.alwaysLoaded != null && now.alwaysLoaded > cfg.budget.alwaysLoaded ? [`always loaded ${now.alwaysLoaded} is above the budget ${cfg.budget.alwaysLoaded}`] : []),
    ...Object.entries(cfg.budget.files ?? {}).filter(([p, max]) => max >= 0 && Object.hasOwn(now.files, p) && now.files[p].tokens > max).map(([p, max]) => `${p}: ${now.files[p].tokens} is above its budget ${max}`),
  ];
  const warnings = [...(budgetOnly ? broken : []), ...refs.filter((r) => r.level === 'warning').map((r) => `${r.file}:${r.line}: path ${r.target} not found`)];
  // Against the stored baseline (path to tokens) or an older measure file there is no earlier always-loaded sum.
  out.push('', `Always loaded in every session: ${change(against?.alwaysLoaded, now.alwaysLoaded)}${cfg.budget.alwaysLoaded == null ? '' : `, budget ${cfg.budget.alwaysLoaded}`}. Of it listed (descriptions of agents and of skills a host lists): ${change(against?.listed, now.listed)}.`);
  out.push(`Protected spans: ${cfg.protect.length}. Counts are estimates (4 bytes per token).`);
  if (failures.length) out.push('', '**Failed**', ...failures.map((f) => `- ${f}`));
  if (warnings.length) out.push('', 'Warnings', ...warnings.map((w) => `- ${w}`));
  return { ok: failures.length === 0, failures, warnings, text: out.join('\n'), total: now.total };
}

function options(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (['--root', '--plan', '--against'].includes(argv[i])) opts[argv[i].slice(2)] = argv[++i];
    else if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = true;
    else opts._.push(argv[i]);
  }
  return opts;
}

export function run(argv, print = console.log) {
  const [command, ...rest] = argv;
  const opts = options(rest);
  const root = resolve(opts.root ?? '.');
  const cfg = loadConfig(root);
  if (command === 'measure') {
    const m = measure(root, cfg, opts._);
    if (opts.json) print(JSON.stringify(m, null, 2));
    else {
      for (const [path, f] of Object.entries(m.files).sort((a, b) => b[1].tokens - a[1].tokens)) print(`${String(f.tokens).padStart(7)}  ${String(f.lines).padStart(5)} lines  ${path}`);
      print(`${String(m.total).padStart(7)}  estimated tokens in ${Object.keys(m.files).length} files`);
      print(`${String(m.alwaysLoaded).padStart(7)}  of them always loaded in every session`);
      print(`${String(m.listed).padStart(7)}  of them listed in every session (descriptions of agents and of skills a host lists)`);
    }
    return 0;
  }
  if (command === 'protect' && opts.suggest) {
    const out = (opts._.length ? opts._ : scope(root, cfg)).flatMap((file) => {
      const lines = linesOf(readFileSync(join(root, file), 'utf8'));
      return suggest(lines, file, root).map((r) => ({ file, ...r, text: norm(lines.slice(r.start - 1, r.end).join(' ')).slice(0, 100) }));
    });
    print(JSON.stringify(out, null, 2));
    return 0;
  }
  if (command === 'protect' && opts.add) {
    print(`${addProtected(root, cfg, opts._).length} protected spans in ${CONFIG}`);
    return 0;
  }
  if (command === 'cut' && opts.plan) {
    const plan = JSON.parse(readFileSync(opts.plan, 'utf8'));
    const p = planCuts(root, cfg, plan);
    for (const r of p.rows) print(`${String(-r.freed).padStart(7)}  ${r.file}:${r.start}-${r.end}  ${r.reason ?? ''}`);
    print(`total ${p.before} -> ${p.after} estimated tokens; protected floor ${p.floor}${p.budget == null ? '' : `; budget ${p.budget}`}`);
    if (p.budget != null && p.after > p.budget) print(p.floor > p.budget ? `the budget cannot be reached: the protected text alone is ${p.floor}` : `still ${p.after - p.budget} above the budget`);
    for (const e of p.errors) print(`error: ${e}`);
    if (p.errors.length) return 1;
    if (!opts.apply) { print('dry run: nothing written (add --apply)'); return 0; }
    // A save since planCuts read the files would be overwritten: check every file again, then write all or nothing.
    const changed = Object.keys(p.contents).filter((file) => sha256(readFileSync(join(root, file), 'utf8')) !== plan.cuts.find((c) => c.file === file).sha256);
    for (const file of changed) print(`error: ${file}: the file changed since the plan was checked; measure again`);
    if (changed.length) return 1;
    for (const [file, text] of Object.entries(p.contents)) writeFileSync(join(root, file), text);
    print(`${p.rows.length} cuts written; run check`);
    return 0;
  }
  if (command === 'baseline') {
    const m = measure(root, cfg);
    const baseline = Object.fromEntries(Object.entries(m.files).map(([p, f]) => [p, f.tokens]));
    if (opts.write) saveConfig(root, { ...cfg.raw, baseline });
    print(opts.write ? `baseline of ${m.total} estimated tokens written to ${CONFIG}` : JSON.stringify(baseline, null, 2));
    return 0;
  }
  if (command === 'check') {
    const c = check(root, cfg, opts.against ? JSON.parse(readFileSync(opts.against, 'utf8')) : undefined, opts['budget-only']);
    print(c.text);
    return c.ok ? 0 : 1;
  }
  print(USAGE);
  return 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
