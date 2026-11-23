// Usage: node start-checks.mjs --project <path> [--worktree <path>] [--config-dir <path>] [--claude-json <file>] [--managed <folder>], the paths absolute.
// Checks 3 and 4 of Automatic start (modes.md) for an automatic worker of the project checked out at <project>: the settings files are the managed ones (<managed>/managed-settings.json and managed-settings.d/*.json), the user's (<config dir>/settings.json), the project's .claude/settings.json and the main checkout's .claude/settings.local.json; the MCP servers those of <claude json>, the project's .mcp.json and the enabled plugins'. The network allow list adds the policy's sandbox.allowedDomains, read from origin's default branch.
// --config-dir defaults to $CLAUDE_CONFIG_DIR, else ~/.claude; --claude-json to .claude.json in a config dir that is set, else ~/.claude.json; --managed to the platform's folder. Without --worktree, an absolute allowRead, allowWrite or additionalDirectories entry counts as outside the worktree.
// Prints { failed, read, allowRules, allowedDomains } as JSON. Exit 0: both checks pass. Exit 1: a check failed (failed names each entry) or a file could not be read (one line on stderr). Exit 2: nothing failed, but each command of read runs outside the sandbox and is not one the script can judge: check 3 passes only when none of them runs a file inside the repository or a tool that loads the repository's code or configuration.
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
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
const PLATFORMS = { darwin: 'macos', linux: 'linux', win32: 'windows' };
const MANAGED = { darwin: '/Library/Application Support/ClaudeCode', linux: '/etc/claude-code' };

const at = (object, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), object);
// A value of another type than a list counts as one entry: a wrong type must not pass as empty.
const entries = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

// The parsed JSON file, or undefined when it does not exist; any other failure throws.
function readJson(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return undefined; throw new Error(`${file} could not be read: ${e.code}`); }
  try { return JSON.parse(text); } catch { throw new Error(`${file} is not valid JSON`); }
}

// Every command found under value: an object's command (with its args) or headersHelper, at any depth.
function commands(value, out = []) {
  if (Array.isArray(value)) for (const v of value) commands(v, out);
  else if (value && typeof value === 'object') {
    if (typeof value.command === 'string') out.push([value.command, ...entries(value.args).map(String)].join(' '));
    if (typeof value.headersHelper === 'string') out.push(value.headersHelper);
    for (const [k, v] of Object.entries(value)) if (k !== 'command' && k !== 'args') commands(v, out);
  }
  return out;
}

const GITHUB = (domain) => {
  const host = String(domain).toLowerCase().replace(/^\*\./, '');
  return host === '*' || ['github.com', 'githubusercontent.com'].some((d) => host === d || host.endsWith(`.${d}`));
};
const inside = (folder, path) => { const r = relative(folder, path); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
const real = (path) => { try { return realpathSync(path); } catch { return path; } };

export function startChecks({ project, worktree, configDir, claudeJson, managedDir, home, platform, domains }) {
  const failed = [], toRead = [], allowRules = [], allowedDomains = [];
  const fail = (check, source, entry) => failed.push({ check, source, entry: escaped(String(entry)) });

  const managedD = join(managedDir, 'managed-settings.d');
  let dropIns = [];
  try { dropIns = readdirSync(managedD).filter((n) => n.endsWith('.json')).sort().map((n) => join(managedD, n)); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`${managedD} could not be listed: ${e.code}`); }
  const files = [
    ...[join(managedDir, 'managed-settings.json'), ...dropIns].map((file) => ({ file, scope: 'managed' })),
    { file: join(configDir, 'settings.json'), scope: 'user' },
    { file: join(project, '.claude/settings.json'), scope: 'project' },
    { file: join(project, '.claude/settings.local.json'), scope: 'local' },
  ].map((f) => ({ ...f, settings: readJson(f.file) })).filter((f) => f.settings !== undefined);

  // Check 3: what runs outside the sandbox.
  const found = [];
  for (const { file, settings } of files) {
    for (const c of commands(settings.hooks)) found.push({ source: file, command: c });
    for (const key of COMMAND_KEYS) for (const c of typeof settings[key] === 'string' ? [settings[key]] : commands(settings[key])) found.push({ source: `${file} ${key}`, command: c });
  }
  for (const file of [claudeJson, join(project, '.mcp.json')]) for (const c of commands(readJson(file)?.mcpServers)) found.push({ source: file, command: c });
  // A plugin enabled in any of the files counts: a later scope may turn it off, but failing closed checks it anyway.
  const enabled = new Set(files.flatMap(({ settings }) => Object.entries(settings.enabledPlugins ?? {}).filter(([, on]) => on !== false).map(([key]) => key)));
  const installed = readJson(join(configDir, 'plugins/installed_plugins.json'))?.plugins ?? {};
  for (const key of enabled) {
    for (const root of entries(installed[key]).map((i) => i?.installPath).filter((p) => typeof p === 'string')) {
      const manifest = readJson(join(root, '.claude-plugin/plugin.json')) ?? {};
      // A manifest key holds the definitions or names files of them, relative to the plugin's folder.
      const part = (key2, file) => [readJson(join(root, file)), ...entries(manifest[key2]).map((v) => (typeof v === 'string' ? readJson(resolve(root, v)) : v))];
      for (const c of commands([...part('hooks', 'hooks/hooks.json'), ...part('mcpServers', '.mcp.json'), ...part('lspServers', '.lsp.json'), ...part('monitors', 'monitors/monitors.json')])) found.push({ source: `plugin ${key}`, command: c });
    }
  }
  const repoPaths = [project, real(project), ...(worktree ? [worktree, real(worktree)] : [])];
  for (const { source, command } of found) {
    // Quotes and a redirection's operator off each word, so `2>/dev/null` reads as the path it names.
    const words = command.replace(/&&|\|\||[;|]/g, ' ; ').split(/\s+/).map((w) => w.replace(/^\d*[<>]+&?/, '').replace(/^['"(]+|['")]+$/g, '')).filter(Boolean);
    // A relative path runs from the session's folder, the repository; a URL is no path.
    const relativePath = words.some((w) => w.includes('/') && !/^([/~$]|[a-z][a-z0-9+.-]*:)/i.test(w));
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
    const path = p.startsWith('~') ? join(home, p.slice(1)) : p.startsWith('//') ? p.slice(1) : p;
    // A relative entry of the committed settings resolves in the worker's own checkout; of any other file, elsewhere.
    if (!isAbsolute(path)) return scope !== 'project' || path.split(/[\\/]/).includes('..');
    return !worktree || !inside(worktree, resolve(path));
  };
  for (const { file, scope, settings } of files) {
    const sandbox = settings.sandbox ?? {};
    for (const key of SWITCHES) if (at(sandbox, key) !== undefined && at(sandbox, key) !== false) fail(4, file, `sandbox.${key}`);
    for (const key of ENTRIES) if (entries(at(sandbox, key)).length) fail(4, file, `sandbox.${key}`);
    if (sandbox.enabledPlatforms !== undefined && !entries(sandbox.enabledPlatforms).includes(host)) fail(4, file, 'sandbox.enabledPlatforms leaves out this platform');
    for (const key of ['filesystem.allowRead', 'filesystem.allowWrite']) for (const e of entries(at(sandbox, key))) if (outside(scope, e)) fail(4, file, `sandbox.${key} outside the worktree: ${e}`);
    for (const e of entries(settings.permissions?.additionalDirectories)) if (outside(scope, e)) fail(4, file, `permissions.additionalDirectories outside the worktree: ${e}`);
    for (const d of entries(at(sandbox, 'network.allowedDomains'))) {
      if (GITHUB(d)) fail(4, file, `a GitHub host in sandbox.network.allowedDomains: ${d}`);
      else allowedDomains.push({ source: file, domain: escaped(String(d)) });
    }
    for (const rule of entries(settings.permissions?.allow)) {
      const domain = /^WebFetch\(domain:(.*)\)$/.exec(String(rule))?.[1];
      if (domain !== undefined && GITHUB(domain)) fail(4, file, `a GitHub host in a WebFetch allow rule: ${rule}`);
      else allowRules.push({ source: file, rule: escaped(String(rule)) });
    }
  }
  for (const d of domains) if (GITHUB(d)) fail(4, 'policy sandbox.allowedDomains', `a GitHub host: ${d}`);
  return { failed, read: toRead, allowRules, allowedDomains };
}

const FLAGS = { project: { type: 'string' }, worktree: { type: 'string' }, 'config-dir': { type: 'string' }, 'claude-json': { type: 'string' }, managed: { type: 'string' } };

export function optionsOf(argv, env = process.env, home = homedir(), platform = process.platform) {
  const { values } = parseArgs({ args: argv, options: FLAGS, strict: true });
  if (values.project === undefined) throw new Error('usage: --project is missing');
  for (const k of Object.keys(FLAGS)) if (values[k] !== undefined && !isAbsolute(values[k])) throw new Error(`usage: --${k} must be an absolute path`);
  const set = values['config-dir'] ?? env.CLAUDE_CONFIG_DIR;
  const managedDir = values.managed ?? MANAGED[platform];
  if (!managedDir) throw new Error(`usage: --managed is needed on ${platform}`);
  return { project: values.project, worktree: values.worktree, configDir: set ?? join(home, '.claude'), claudeJson: values['claude-json'] ?? (set ? join(set, '.claude.json') : join(home, '.claude.json')), managedDir, home, platform };
}

if (isMain(import.meta.url)) {
  try {
    const options = optionsOf(process.argv.slice(2));
    const { policy, errors } = read(options.project);
    if (!policy) throw new Error(`the policy could not be read: ${errors.map((e) => e.message).join('; ')}`);
    const result = startChecks({ ...options, domains: policy.sandbox.allowedDomains });
    console.log(json(result));
    process.exitCode = result.failed.length ? 1 : result.read.length ? 2 : 0;
  } catch (e) {
    console.error(escaped(e.message.split('\n')[0]));
    process.exitCode = 1;
  }
}
