// Usage: node start-checks.mjs --project <path> [--worktree <path>] [--config-dir <path>] [--claude-json <file>] [--managed <folder>], the paths absolute.
// Checks 3 and 4 of Automatic start (modes.md) for an automatic worker of the project checked out at <project>, starting in <worktree>: the settings files are the managed ones (<managed>/managed-settings.json and managed-settings.d/*.json), the user's (<config dir>/settings.json), and .claude/settings.json and .claude/settings.local.json of the main checkout and of the worktree; the MCP servers those of <managed>/managed-mcp.json, <claude json>, .mcp.json of the main checkout and of the worktree, and the installed plugins'. The network allow list adds the policy's sandbox.allowedDomains, read from origin's default branch.
// --config-dir defaults to $CLAUDE_CONFIG_DIR, else ~/.claude; --claude-json to .claude.json in a config dir that is set, else ~/.claude.json; --managed to the platform's folder. Without --worktree, an absolute allowRead, allowWrite or additionalDirectories entry counts as outside the worktree.
// Prints { failed, read, unresolved, allowRules, allowedDomains } as JSON. Exit 0: both checks pass for what the script reads. Exit 1: a check failed (failed names each entry) or a file could not be read (one line on stderr). Exit 2: nothing failed, but each command of read runs outside the sandbox and is not one the script can judge, or unresolved names a source or entry the script could not resolve: the checks pass only when your read of each clears it.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { escaped, isMain, json, read } from './policy.mjs';

// Tools that load the code or configuration of the folder they run in: a formatter, a linter, a package script, a build.
const TOOLS = new Set(['npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'deno', 'make', 'just', 'task', 'prettier', 'eslint', 'biome', 'oxlint', 'dprint', 'stylelint', 'tsc', 'ruff', 'black', 'isort', 'flake8', 'mypy', 'pylint', 'pytest', 'uv', 'uvx', 'poetry', 'pipenv', 'tox', 'nox', 'pre-commit', 'lefthook', 'husky', 'lint-staged', 'cargo', 'rustfmt', 'gofmt', 'goimports', 'golangci-lint', 'go', 'mvn', 'gradle', 'gradlew', 'dotnet', 'composer', 'bundle', 'rake', 'rubocop', 'swiftformat', 'swiftlint', 'ktlint', 'clang-format', 'shfmt', 'terraform', 'direnv']);
// Settings keys whose value is a command Claude Code runs, besides hooks.
const COMMAND_KEYS = ['statusLine', 'apiKeyHelper', 'otelHeadersHelper', 'awsAuthRefresh', 'gcpAuthRefresh', 'awsCredentialExport', 'fileSuggestion'];
// Sandbox keys of check 4 that defeat a bound whenever they are set to anything but false.
const SWITCHES = ['allowAppleEvents', 'allowNestedUserNamespaces', 'enableWeakerNestedSandbox', 'enableWeakerNetworkIsolation', 'network.allowLocalBinding', 'filesystem.disabled', 'network.allowAllUnixSockets'];
// Sandbox keys of check 4 that defeat a bound with any entry or value.
const ENTRIES = ['excludedCommands', 'network.allowUnixSockets', 'network.allowMachLookup', 'network.httpProxyPort', 'network.socksProxyPort', 'ripgrep', 'bwrapPath', 'socatPath'];
// Settings keys that must hold an object; another type is a shape the script cannot read.
const OBJECTS = ['hooks', 'sandbox', 'permissions', 'enabledPlugins', 'env'];
// Plugin manifest keys that hold definitions of commands or name files of them, with the file read when the key is absent.
const PARTS = [['hooks', 'hooks/hooks.json'], ['mcpServers', '.mcp.json'], ['lspServers', '.lsp.json'], ['monitors', 'monitors/monitors.json'], ['experimental.monitors']];
// Environment variables that add plugins the script does not read.
const PLUGIN_VARS = ['CLAUDE_CODE_PLUGIN_DIRS', 'CLAUDE_CODE_PLUGIN_CACHE_DIR'];
const PLATFORMS = { darwin: 'macos', linux: 'linux', win32: 'windows' };
const MANAGED = { darwin: '/Library/Application Support/ClaudeCode', linux: '/etc/claude-code' };

const at = (object, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), object);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// A value of another type than a list counts as one entry: a wrong type must not pass as empty.
const entries = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

// The parsed JSON file, or undefined when it does not exist; any other failure throws.
function readJson(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return undefined; throw new Error(`${file} could not be read: ${e.code}`); }
  try { return JSON.parse(text); } catch { throw new Error(`${file} is not valid JSON`); }
}

// Every command found under value: an object's command (after its env, with its args) or headersHelper, at any depth. A command that is no string is shown as JSON, so it is listed, never dropped.
function commands(value, out = []) {
  if (Array.isArray(value)) for (const v of value) commands(v, out);
  else if (plain(value)) {
    if (value.command !== undefined) {
      const env = plain(value.env) ? Object.entries(value.env).map(([k, v]) => `${k}=${v}`) : entries(value.env).map((v) => JSON.stringify(v));
      out.push([...env, typeof value.command === 'string' ? value.command : JSON.stringify(value.command), ...entries(value.args).map(String)].join(' '));
    }
    if (typeof value.headersHelper === 'string') out.push(value.headersHelper);
    for (const [k, v] of Object.entries(value)) if (k !== 'command' && k !== 'args' && k !== 'env') commands(v, out);
  }
  return out;
}

// An entry that reaches github.com, one of its subdomains or githubusercontent.com, with a port or as a wildcard that covers one (`*.com`); a wildcard of another form counts too.
const GITHUB = (domain) => {
  const entry = String(domain).toLowerCase().replace(/:\d+$/, '');
  const wild = entry.startsWith('*.') ? entry.slice(2) : null;
  if (entry.slice(wild === null ? 0 : 2).includes('*')) return true;
  return ['github.com', 'githubusercontent.com'].some((d) => entry === d || entry.endsWith(`.${d}`) || (wild !== null && (d === wild || d.endsWith(`.${wild}`))));
};
// The entry forms the script reads: a host name or `*.` before one, each with an optional port. Another (an address, a trailing dot, a space, a URL, a non-ASCII letter) may name a GitHub host.
const HOST = /^(\*\.)?([a-z0-9-]+\.)*[a-z][a-z0-9-]*(:\d+)?$/;
const inside = (folder, path) => { const r = relative(folder, path); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
// The real path of the deepest part that exists, the rest appended: a link in any parent is followed. null for a link that leads nowhere, whose target the script cannot test.
const real = (path) => {
  try { return realpathSync(path); } catch { /* not there, or a link that leads nowhere */ }
  try { lstatSync(path); return null; } catch { /* not there */ }
  const up = dirname(path), r = up === path ? null : real(up);
  return r && join(r, basename(path));
};

export function startChecks({ project, worktree, configDir, claudeJson, managedDir, home, platform, domains, env = {} }) {
  const failed = [], toRead = [], unresolved = [], allowRules = [], allowedDomains = [];
  const fail = (check, source, entry) => failed.push({ check, source, entry: escaped(String(entry)) });
  const cannot = (source, reason) => unresolved.push({ source, reason: escaped(String(reason)) });
  const checkouts = [project, ...(worktree ? [worktree] : [])];
  for (const folder of [configDir, ...checkouts]) if (!existsSync(folder)) cannot(folder, 'the folder does not exist');

  const managedD = join(managedDir, 'managed-settings.d');
  let dropIns = [];
  try { dropIns = readdirSync(managedD).filter((n) => n.endsWith('.json')).sort().map((n) => join(managedD, n)); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`${managedD} could not be listed: ${e.code}`); }
  const files = [
    ...[join(managedDir, 'managed-settings.json'), ...dropIns].map((file) => ({ file, scope: 'managed' })),
    { file: join(configDir, 'settings.json'), scope: 'user' },
    ...checkouts.flatMap((root) => [{ file: join(root, '.claude/settings.json'), scope: 'project' }, { file: join(root, '.claude/settings.local.json'), scope: 'local' }]),
  ].map((f) => ({ ...f, settings: readJson(f.file) })).filter(({ file, settings }) => {
    if (settings === undefined) return false;
    if (!plain(settings)) { cannot(file, 'holds no JSON object'); return false; }
    for (const key of OBJECTS) if (settings[key] !== undefined && !plain(settings[key])) cannot(file, `${key} is no object`);
    return true;
  });
  const object = (v) => (plain(v) ? v : {});

  // Check 3: what runs outside the sandbox.
  const found = [];
  for (const { file, settings } of files) {
    for (const c of commands(settings.hooks)) found.push({ source: file, command: c });
    for (const key of COMMAND_KEYS) for (const c of typeof settings[key] === 'string' ? [settings[key]] : commands(settings[key])) found.push({ source: `${file} ${key}`, command: c });
    // The session's environment reaches every command Claude Code starts (NODE_OPTIONS, PATH).
    const vars = Object.entries(object(settings.env));
    if (vars.length) found.push({ source: `${file} env`, command: vars.map(([k, v]) => `${k}=${v}`).join(' ') });
  }
  const repoPaths = checkouts.flatMap((p) => [p, real(p) ?? p]);
  const user = readJson(claudeJson);
  // Local-scope servers sit under the folder they were added in: each folder that holds the project or the worktree counts.
  const local = Object.entries(object(user?.projects)).filter(([folder]) => isAbsolute(folder) && repoPaths.some((p) => inside(folder, p)));
  const mcpFiles = [join(managedDir, 'managed-mcp.json'), ...checkouts.map((root) => join(root, '.mcp.json'))];
  for (const [source, servers] of [[claudeJson, user?.mcpServers], ...local.map(([folder, p]) => [`${claudeJson} projects ${folder}`, p?.mcpServers]), ...mcpFiles.map((file) => [file, readJson(file)?.mcpServers])]) {
    for (const c of commands(servers)) found.push({ source, command: c });
  }
  for (const name of PLUGIN_VARS) if (env[name]) cannot(name, 'adds plugins the script does not read');
  // An installed plugin is on unless a file turns it off; one turned on in any file counts: a later scope may turn it off, but failing closed checks it anyway.
  const switched = files.flatMap(({ settings }) => Object.entries(object(settings.enabledPlugins)));
  const installedFile = join(configDir, 'plugins/installed_plugins.json');
  const installed = object(readJson(installedFile)?.plugins);
  for (const key of new Set([...Object.keys(installed), ...switched.map(([k]) => k)])) {
    const named = switched.filter(([k]) => k === key);
    if (named.length && named.every(([, on]) => on === false)) continue;
    const source = `plugin ${key}`;
    const roots = entries(installed[key]).map((i) => i?.installPath);
    if (!roots.length) cannot(source, `${installedFile} names no folder of it`);
    for (const root of roots) {
      if (typeof root !== 'string' || !isAbsolute(root) || !existsSync(root)) { cannot(source, `its folder ${root} does not exist`); continue; }
      const manifest = object(readJson(join(root, '.claude-plugin/plugin.json')));
      // A manifest key holds the definitions or names files of them, relative to the plugin's folder.
      const defined = PARTS.flatMap(([key2, file]) => [...(file ? [readJson(join(root, file))] : []), ...entries(at(manifest, key2)).map((v) => {
        if (plain(v)) return v;
        const text = typeof v === 'string' ? readJson(resolve(root, v)) : undefined;
        if (text === undefined) cannot(source, `${key2} names nothing the script can read: ${JSON.stringify(v)}`);
        return text;
      })]);
      // Shown with the plugin's folder in place of the variable, so the reader finds the file the command runs.
      for (const c of commands(defined)) found.push({ source, command: c.replaceAll('${CLAUDE_PLUGIN_ROOT}', root).replaceAll('$CLAUDE_PLUGIN_ROOT', root) });
    }
  }
  for (const { source, command } of found) {
    // Quotes and a redirection's operator off each word, so `2>/dev/null` reads as the path it names.
    const words = command.replace(/&&|\|\||[;|]/g, ' ; ').split(/\s+/).map((w) => w.replace(/^\d*[<>]+&?/, '').replace(/^['"(]+|['")]+$/g, '')).filter(Boolean);
    // A relative path runs from the session's folder, the repository; a URL is no path. An option's value (`--config=x/y`) and each part of a variable's value (`PATH=/usr/bin:./bin`) is tested on its own.
    const relativePath = words.flatMap((w) => (/^\w+=/.test(w) ? w.replace(/^\w+=/, '').split(':') : [w])).map((w) => w.replace(/^-[^=]*=/, '')).some((w) => w.includes('/') && !/^([/~$]|[a-z][a-z0-9+.-]*:)/i.test(w));
    // A program: the first word, or the first after a separator, past variable assignments and env, exec or command.
    const programs = [];
    let next = true;
    for (const w of words) {
      if (w === ';') next = true;
      else if (next && !/^(\w+=.*|env|exec|command)$/.test(w)) { programs.push(w); next = false; }
    }
    if (relativePath || command.includes('CLAUDE_PROJECT_DIR') || repoPaths.some((p) => command.includes(p))) fail(3, source, `runs a file inside the repository: ${command}`);
    else if (programs.some((w) => TOOLS.has(w.split('/').at(-1)))) fail(3, source, `runs a tool that loads the repository's code or configuration: ${command}`);
    else toRead.push({ source, command: escaped(command) });
  }

  // Check 4: entries that defeat a bound.
  const host = PLATFORMS[platform];
  const outside = (scope, entry) => {
    const p = String(entry);
    let path = p.startsWith('~') ? join(home, p.slice(1)) : p.startsWith('//') ? p.slice(1) : p;
    // A relative entry of the committed settings resolves in the worker's own checkout; of any other file, elsewhere.
    if (!isAbsolute(path)) {
      if (scope !== 'project') return true;
      if (!worktree) return path.split(/[\\/]/).includes('..');
      path = join(worktree, path);
    }
    if (!worktree) return true;
    // Both spellings must lie inside: a link in the worktree, at any depth of the path, can lead out of it.
    const r = real(resolve(path)), w = real(worktree);
    return !inside(worktree, resolve(path)) || !r || !w || !inside(w, r);
  };
  const domain = (file, d, inRule) => {
    if (GITHUB(d)) fail(4, file, inRule ? `a GitHub host in a WebFetch allow rule: ${inRule}` : `a GitHub host in sandbox.network.allowedDomains: ${d}`);
    else if (!HOST.test(String(d).toLowerCase())) cannot(file, `no plain host name: ${inRule ?? d}`);
    else return true;
    return false;
  };
  for (const { file, scope, settings } of files) {
    const sandbox = object(settings.sandbox), permissions = object(settings.permissions);
    for (const key of SWITCHES) if (at(sandbox, key) !== undefined && at(sandbox, key) !== false) fail(4, file, `sandbox.${key}`);
    for (const key of ENTRIES) if (entries(at(sandbox, key)).length) fail(4, file, `sandbox.${key}`);
    if (sandbox.enabledPlatforms !== undefined && !entries(sandbox.enabledPlatforms).includes(host)) fail(4, file, 'sandbox.enabledPlatforms leaves out this platform');
    for (const key of ['filesystem.allowRead', 'filesystem.allowWrite']) for (const e of entries(at(sandbox, key))) if (outside(scope, e)) fail(4, file, `sandbox.${key} outside the worktree: ${e}`);
    for (const e of entries(permissions.additionalDirectories)) if (outside(scope, e)) fail(4, file, `permissions.additionalDirectories outside the worktree: ${e}`);
    for (const d of entries(at(sandbox, 'network.allowedDomains'))) if (domain(file, d)) allowedDomains.push({ source: file, domain: escaped(String(d)) });
    for (const rule of entries(permissions.allow)) {
      const text = String(rule);
      // A WebFetch rule of another form than WebFetch(domain:<host>) may allow any host.
      const webFetch = /^\s*WebFetch\b/.test(text), host2 = /^WebFetch\(domain:(.*)\)$/.exec(text)?.[1];
      if (webFetch && host2 === undefined) cannot(file, `a WebFetch allow rule of another form than WebFetch(domain:<host>): ${text}`);
      else if (!webFetch || domain(file, host2, text)) allowRules.push({ source: file, rule: escaped(text) });
    }
  }
  for (const d of domains) {
    if (GITHUB(d)) fail(4, 'policy sandbox.allowedDomains', `a GitHub host: ${d}`);
    else if (!HOST.test(String(d).toLowerCase())) cannot('policy sandbox.allowedDomains', `no plain host name: ${d}`);
  }
  return { failed, read: toRead, unresolved, allowRules, allowedDomains };
}

const FLAGS = { project: { type: 'string' }, worktree: { type: 'string' }, 'config-dir': { type: 'string' }, 'claude-json': { type: 'string' }, managed: { type: 'string' } };

export function optionsOf(argv, env = process.env, home = homedir(), platform = process.platform) {
  const { values } = parseArgs({ args: argv, options: FLAGS, strict: true });
  if (values.project === undefined) throw new Error('usage: --project is missing');
  for (const k of Object.keys(FLAGS)) if (values[k] !== undefined && !isAbsolute(values[k])) throw new Error(`usage: --${k} must be an absolute path`);
  const set = values['config-dir'] ?? env.CLAUDE_CONFIG_DIR;
  const managedDir = values.managed ?? MANAGED[platform];
  if (!managedDir) throw new Error(`usage: --managed is needed on ${platform}`);
  return { project: values.project, worktree: values.worktree, configDir: set ?? join(home, '.claude'), claudeJson: values['claude-json'] ?? (set ? join(set, '.claude.json') : join(home, '.claude.json')), managedDir, home, platform, env: Object.fromEntries(PLUGIN_VARS.map((k) => [k, env[k]])) };
}

if (isMain(import.meta.url)) {
  try {
    const options = optionsOf(process.argv.slice(2));
    const { policy, errors } = read(options.project);
    if (!policy) throw new Error(`the policy could not be read: ${errors.map((e) => e.message).join('; ')}`);
    const result = startChecks({ ...options, domains: policy.sandbox.allowedDomains });
    console.log(json(result));
    process.exitCode = result.failed.length ? 1 : result.read.length || result.unresolved.length ? 2 : 0;
  } catch (e) {
    console.error(escaped(e.message.split('\n')[0]));
    process.exitCode = 1;
  }
}
