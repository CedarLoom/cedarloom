// Usage: node models.mjs [<project path>] [--depth quick|standard|deep] [--risk low|medium|high|critical] [--json]   or   node models.mjs [<project path>] --hook
// Prints the model and effort of each task at that depth and risk (standard and low by default), with the row and file that set each: CedarLoom's defaults (models.json beside this file), then the user file, then the project's cedarloom.json. A file it refuses prints each error and exits 1.
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Rank for "only raises": the model first, then the effort.
export const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Implement and fix run only on this model, and a call whose model the account refuses reruns once on it.
export const BUILD_MODEL = 'opus';
const BUILD_TASKS = ['implement', 'fix'];
const DEPTHS = ['quick', 'standard', 'deep'];
// The risk rows a lookup applies, in order: a critical lookup takes the high row first.
const RISK_ROWS = { low: [], medium: [], high: ['high'], critical: ['high', 'critical'] };
const DEFAULTS = fileURLToPath(new URL('models.json', import.meta.url));
const ROLE_NAME = /^[a-z][a-z0-9-]*$/;

export class Refused extends Error {}

// The user file by the XDG base directory spec: $XDG_CONFIG_HOME when it is an absolute path, else ~/.config.
export const userFile = (env) => join(env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(env.HOME || homedir(), '.config'), 'cedarloom', 'cedarloom.json');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Comment keys start with //, as in cedarloom.json.
const entries = (o) => Object.entries(o ?? {}).filter(([k]) => !k.startsWith('//'));

// The errors of one file's models section, each "<path>: <rule>".
function refusals(models, tasks) {
  const found = [];
  const keys = (value, path, allowed) => {
    if (!isObject(value)) return found.push(`${path}: must be an object`), false;
    for (const [k] of entries(value)) if (allowed && !allowed.includes(k)) found.push(`${path}.${k}: unknown key, expected one of ${allowed.join(', ')}`);
    return true;
  };
  const pair = (value, path) => {
    if (!keys(value, path, ['model', 'effort'])) return;
    if (!MODELS.includes(value.model)) found.push(`${path}.model: must be one of ${MODELS.join(', ')}`);
    if (!EFFORTS.includes(value.effort)) found.push(`${path}.effort: must be one of ${EFFORTS.join(', ')}`);
  };
  const row = (value, path) => {
    if (!keys(value, path, tasks)) return;
    for (const [task, v] of entries(value)) if (typeof v !== 'string') pair(v, `${path}.${task}`);
  };
  if (!keys(models, 'models', ['roles', 'tasks', 'depth', 'risk'])) return found;
  if (models.roles !== undefined && keys(models.roles, 'models.roles')) {
    for (const [role, v] of entries(models.roles)) ROLE_NAME.test(role) ? pair(v, `models.roles.${role}`) : found.push(`models.roles.${role}: a role name is lowercase letters, digits and hyphens`);
  }
  if (models.tasks !== undefined) row(models.tasks, 'models.tasks');
  if (models.depth !== undefined && keys(models.depth, 'models.depth', ['quick', 'deep'])) for (const [d, v] of entries(models.depth)) row(v, `models.depth.${d}`);
  if (models.risk !== undefined && keys(models.risk, 'models.risk', ['high', 'critical'])) for (const [r, v] of entries(models.risk)) row(v, `models.risk.${r}`);
  return found;
}

// The parsed file, or undefined when it does not exist.
function readJson(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Refused(`${path}: cannot be read: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Refused(`${path}: not valid JSON: ${error.message}`);
  }
}

// The layers in order, each { file, path, models }; a file that does not exist is left out, and so are the user file without env and the repository file without project. The user file holds models only.
export function layers({ project, env }) {
  const defaults = readJson(DEFAULTS);
  const tasks = Object.keys(defaults.models.tasks);
  const found = [{ file: 'default', path: DEFAULTS, models: defaults.models }];
  const user = env ? userFile(env) : undefined;
  const userDoc = user ? readJson(user) : undefined;
  if (userDoc !== undefined) {
    if (!isObject(userDoc)) throw new Refused(`${user}: must be a JSON object`);
    const other = entries(userDoc).map(([k]) => k).filter((k) => !['$schema', 'models'].includes(k));
    if (other.length) throw new Refused(`${user}: ${other.join(', ')}: the user file holds models only`);
    found.push({ file: 'user', path: user, models: userDoc.models ?? {} });
  }
  const repository = project ? join(resolve(project), 'cedarloom.json') : undefined;
  const repoDoc = repository ? readJson(repository) : undefined;
  if (repoDoc !== undefined) found.push({ file: 'repository', path: repository, models: isObject(repoDoc) ? repoDoc.models ?? {} : repoDoc });
  const errors = found.flatMap(({ path, models }) => refusals(models, tasks).map((e) => `${path}: ${e}`));
  if (errors.length) throw new Refused(errors.join('\n'));
  return found;
}

// Each entry of every layer, the later file replacing the earlier one entry by entry.
function merged(found) {
  const map = { roles: {}, tasks: {}, depth: {}, risk: {} };
  for (const { file, models } of found) {
    for (const [role, v] of entries(models.roles)) map.roles[role] = { model: v.model, effort: v.effort, file };
    for (const [task, value] of entries(models.tasks)) map.tasks[task] = { value, file };
    for (const key of ['depth', 'risk']) for (const [name, row] of entries(models[key])) for (const [task, value] of entries(row)) (map[key][name] ??= {})[task] = { value, file };
  }
  return map;
}

function valueOf(map, { value, file }, row) {
  if (typeof value !== 'string') return { model: value.model, effort: value.effort, row, file };
  const role = map.roles[value];
  if (!role) throw new Refused(`${row} in the ${file} file names the role ${value}, which no file defines`);
  return { model: role.model, effort: role.effort, row, file, role: `roles.${value}`, roleFile: role.file };
}

// Where a value comes from: its row and file, and for a role name the role's file.
const source = (v) => `${v.row} (${v.file})${v.role ? `, ${v.role} (${v.roleFile})` : ''}`;

const rank = (v) => MODELS.indexOf(v.model) * EFFORTS.length + EFFORTS.indexOf(v.effort);

// One task's value: its tasks row, then the depth row, which may lower or raise it, then each risk row, which only raises it.
function lookup(map, task, depth, risk) {
  let value = valueOf(map, map.tasks[task], `tasks.${task}`);
  const lowered = map.depth[depth]?.[task];
  if (lowered) value = valueOf(map, lowered, `depth.${depth}.${task}`);
  for (const name of RISK_ROWS[risk]) {
    const raised = map.risk[name]?.[task];
    if (!raised) continue;
    const candidate = valueOf(map, raised, `risk.${name}.${task}`);
    if (rank(candidate) > rank(value)) value = candidate;
  }
  return value;
}

// The defaults file alone, at standard depth and low risk: what the plugin ships.
export const defaultMap = () => resolveMap({ project: null, env: null });

// { files, tasks }: every task's { model, effort, row, file, role?, roleFile? } at that depth and risk. Refuses a map that puts implement or fix on another model than BUILD_MODEL at any depth and risk.
export function resolveMap({ project = '.', depth = 'standard', risk = 'low', env = process.env } = {}) {
  if (!DEPTHS.includes(depth)) throw new Refused(`depth must be one of ${DEPTHS.join(', ')}`);
  if (!Object.hasOwn(RISK_ROWS, risk)) throw new Refused(`risk must be one of ${Object.keys(RISK_ROWS).join(', ')}`);
  const found = layers({ project, env });
  const map = merged(found);
  // Every row's role name is checked, not only the rows this lookup reads.
  for (const [task, entry] of Object.entries(map.tasks)) valueOf(map, entry, `tasks.${task}`);
  for (const key of ['depth', 'risk']) for (const [name, row] of Object.entries(map[key])) for (const [task, entry] of Object.entries(row)) valueOf(map, entry, `${key}.${name}.${task}`);
  for (const d of DEPTHS) for (const r of Object.keys(RISK_ROWS)) for (const task of BUILD_TASKS) {
    const v = lookup(map, task, d, r);
    if (v.model !== BUILD_MODEL) throw new Refused(`${source(v)} puts ${task} on ${v.model} at depth ${d}, risk ${r}: ${task} runs only on ${BUILD_MODEL}`);
  }
  return {
    depth,
    risk,
    files: Object.fromEntries(found.map(({ file, path }) => [file, path])),
    tasks: Object.fromEntries(Object.keys(map.tasks).map((task) => [task, lookup(map, task, depth, risk)])),
  };
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { depth: { type: 'string' }, risk: { type: 'string' }, json: { type: 'boolean' }, hook: { type: 'boolean' } },
  });
  if (positionals.length > 1 || (values.hook && (values.json || values.depth || values.risk))) throw new Refused('usage: node models.mjs [<project path>] [--depth quick|standard|deep] [--risk low|medium|high|critical] [--json] | node models.mjs [<project path>] --hook');
  const project = positionals[0] ?? '.';
  const at = (depth, risk) => resolveMap({ project, depth: depth ?? 'standard', risk: risk ?? 'low' });
  const pairs = (tasks, only = Object.keys(tasks)) => only.map((task) => `${task} ${tasks[task].model} ${tasks[task].effort}`).join(', ');
  if (values.hook) {
    // A session without the skill loader still knows the map at standard depth; other depths and the sources come from the script.
    const base = at().tasks;
    const raisedAt = (risk) => { const tasks = at(undefined, risk).tasks; return pairs(tasks, Object.keys(tasks).filter((t) => rank(tasks[t]) !== rank(base[t]))); };
    return console.log(`CedarLoom model map (task model effort), standard depth: ${pairs(base)}. Risk high raises ${raisedAt('high') || 'nothing'}; critical ${raisedAt('critical') || 'nothing'}. Other depths and sources: node ${fileURLToPath(import.meta.url)} --depth <depth> --risk <risk>.`);
  }
  const result = at(values.depth, values.risk);
  if (values.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`Depth ${result.depth}, risk ${result.risk}. Files: ${Object.entries(result.files).map(([file, path]) => `${file} ${path}`).join('; ')}`);
  for (const [task, v] of Object.entries(result.tasks)) console.log(`${task}: ${v.model} ${v.effort} from ${source(v)}`);
}

// Compared as real paths, so the command line also runs through a symlinked folder.
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  try {
    main();
  } catch (error) {
    if (!(error instanceof Refused) && error.code !== 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && error.code !== 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
