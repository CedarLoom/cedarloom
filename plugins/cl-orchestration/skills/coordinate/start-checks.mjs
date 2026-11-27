// Usage: node start-checks.mjs --project <path> [--worktree <path>] [--config-dir <path>] [--claude-json <file>] [--managed <folder>], the paths absolute.
// Checks 3 and 4 of Automatic start (automatic-start.md) for an automatic worker of the project checked out at <project>, starting in <worktree>: the settings files are the managed ones (<managed>/managed-settings.json and managed-settings.d/*.json), the user's (<config dir>/settings.json), and .claude/settings.json and .claude/settings.local.json of the main checkout and of the worktree; the MCP servers those of <managed>/managed-mcp.json, <claude json>, .mcp.json of the main checkout and of the worktree, and the installed plugins'.
// --config-dir defaults to $CLAUDE_CONFIG_DIR, else ~/.claude; --claude-json to .claude.json in a config dir that is set, else ~/.claude.json; --managed to the platform's folder. Without --worktree, an absolute additionalDirectories entry counts as outside the worktree.
// Prints { failed, read, unresolved, allowRules } as JSON. Exit 0: both checks pass for what the script reads. Exit 1: a check failed (failed names each entry) or a file could not be read (one line on stderr). Exit 2: nothing failed, but each command of read runs outside the permission rules and the role guard and is not one the script can judge, or unresolved names a source or entry the script could not resolve: the checks pass only when your read of each clears it.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { escaped, isMain, json } from './policy.mjs';

// Tools that load the code or configuration of the folder they run in: a formatter, a linter, a package script, a build.
const TOOLS = new Set(['npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'deno', 'make', 'just', 'task', 'prettier', 'eslint', 'biome', 'oxlint', 'dprint', 'stylelint', 'tsc', 'ruff', 'black', 'isort', 'flake8', 'mypy', 'pylint', 'pytest', 'uv', 'uvx', 'poetry', 'pipenv', 'tox', 'nox', 'pre-commit', 'lefthook', 'husky', 'lint-staged', 'cargo', 'rustfmt', 'gofmt', 'goimports', 'golangci-lint', 'go', 'mvn', 'gradle', 'gradlew', 'dotnet', 'composer', 'bundle', 'rake', 'rubocop', 'swiftformat', 'swiftlint', 'ktlint', 'clang-format', 'shfmt', 'terraform', 'direnv']);
// Settings keys whose value is a command Claude Code runs, besides hooks.
const COMMAND_KEYS = ['statusLine', 'subagentStatusLine', 'apiKeyHelper', 'otelHeadersHelper', 'awsAuthRefresh', 'gcpAuthRefresh', 'awsCredentialExport', 'fileSuggestion', 'processWrapper', 'policyHelper'];
// Settings keys known to run no command, from the published settings schema (SchemaStore, claude-code-settings.json). A key on no list of this file is unresolved, so one that a later Claude Code release adds is never passed unread; left off as not known to run none: managedMcpServers, pluginConfigs, extraKnownMarketplaces, sshConfigs.
const PLAIN_KEYS = new Set(['$schema', 'advisorModel', 'agent', 'agentPushNotifEnabled', 'allowAllClaudeAiMcps', 'allowManagedHooksOnly', 'allowManagedMcpServersOnly', 'allowManagedPermissionRulesOnly', 'allowedChannelPlugins', 'allowedHttpHookUrls', 'allowedMcpServers', 'alwaysThinkingEnabled', 'askUserQuestionTimeout', 'attribution', 'autoCompactEnabled', 'autoConnectIde', 'autoInstallIdeExtension', 'autoMemoryDirectory', 'autoMemoryEnabled', 'autoMode', 'autoScrollEnabled', 'autoUpdatesChannel', 'availableModels', 'awaySummaryEnabled', 'axScreenReader', 'blockedMarketplaces', 'browserExternalPageTools', 'channelsEnabled', 'claudeMd', 'claudeMdExcludes', 'cleanupPeriodDays', 'companyAnnouncements', 'defaultShell', 'deniedMcpServers', 'diffTool', 'disableAgentView', 'disableAllHooks', 'disableArtifact', 'disableAutoMode', 'disableBrowserExternalNavigation', 'disableBundledSkills', 'disableClaudeAiConnectors', 'disableDeepLinkRegistration', 'disableMobileSimulatorTools', 'disableRemoteControl', 'disableSideloadFlags', 'disableSkillShellExecution', 'disableWorkflows', 'disabledMcpjsonServers', 'editorMode', 'effortLevel', 'emojiCompletionEnabled', 'enableAllProjectMcpServers', 'enableArtifact', 'enabledMcpjsonServers', 'enforceAvailableModels', 'externalEditorContext', 'fallbackModel', 'fastMode', 'fastModePerSessionOptIn', 'feedbackSurveyRate', 'fileCheckpointingEnabled', 'footerLinksRegexes', 'forceLoginGatewayUrl', 'forceLoginMethod', 'forceLoginOrgUUID', 'forceRemoteSettingsRefresh', 'httpHookAllowedEnvVars', 'includeCoAuthoredBy', 'includeGitInstructions', 'inputNeededNotifEnabled', 'language', 'minimumVersion', 'model', 'modelOverrides', 'outputStyle', 'parentSettingsBehavior', 'permissionExplainerEnabled', 'plansDirectory', 'pluginSuggestionMarketplaces', 'pluginTrustMessage', 'prUrlTemplate', 'preferredNotifChannel', 'prefersReducedMotion', 'remoteControlAtStartup', 'requireCoworkFullVmSandbox', 'requiredMaximumVersion', 'requiredMinimumVersion', 'respectGitignore', 'respondToBashCommands', 'sandbox', 'showClearContextOnPlanAccept', 'showThinkingSummaries', 'showTurnDuration', 'skillListingBudgetFraction', 'skillListingMaxDescChars', 'skillOverrides', 'skipDangerousModePermissionPrompt', 'skipWebFetchPreflight', 'skippedMarketplaces', 'skippedPlugins', 'spinnerTipsEnabled', 'spinnerTipsOverride', 'spinnerVerbs', 'sshHostAllowlist', 'strictKnownMarketplaces', 'strictPluginOnlyCustomization', 'syntaxHighlightingDisabled', 'teammateDefaultModel', 'teammateMode', 'terminalProgressBarEnabled', 'theme', 'tui', 'useAutoModeDuringPlan', 'verbose', 'viewMode', 'vimInsertModeRemaps', 'voice', 'voiceEnabled', 'wheelScrollAccelerationEnabled', 'workflowKeywordTriggerEnabled', 'workflowSizeGuideline', 'worktree', 'wslInheritsWindowsSettings']);
// The keys of permissions in the same schema.
const PERMISSION_KEYS = ['allow', 'deny', 'ask', 'defaultMode', 'disableBypassPermissionsMode', 'disableAutoMode', 'additionalDirectories'];
// Settings keys that must hold an object; another type is a shape the script cannot read.
const OBJECTS = ['hooks', 'permissions', 'enabledPlugins', 'env'];
// The same for the lists check 4 reads entry by entry as text: an entry that is no string would be tested as text it does not hold.
const LISTS = ['permissions.allow', 'permissions.additionalDirectories'];
// Frontmatter keys of a skill, agent or command file that define hooks or MCP servers, which run outside the permission rules and the role guard.
const FRONTMATTER_KEYS = ['hooks', 'mcpServers'];
// The folders of a .claude folder whose files carry such frontmatter.
const INSTRUCTIONS = ['skills', 'agents', 'commands'];
// Plugin manifest keys that hold definitions of commands or name files of them, with the file read when the key is absent.
const PARTS = [['hooks', 'hooks/hooks.json'], ['mcpServers', '.mcp.json'], ['lspServers', '.lsp.json'], ['monitors', 'monitors/monitors.json'], ['experimental.monitors']];
// Environment variables that add plugins the script does not read.
const PLUGIN_VARS = ['CLAUDE_CODE_PLUGIN_DIRS', 'CLAUDE_CODE_PLUGIN_CACHE_DIR'];
// Keys of a marketplace entry that declare no command; any other key can add one to the plugin.
const ENTRY_KEYS = ['name', 'source', 'displayName', 'defaultEnabled', 'description', 'version', 'author', 'homepage', 'repository', 'license', 'keywords', 'category', 'tags', 'strict', 'commands', 'agents', 'skills', 'outputStyles'];
// An entry's source the script passes: a path in the marketplace, or one of these types with these keys, which fetch files. Any other, a command source included, is not read.
const SOURCE_TYPES = ['github', 'url', 'git-subdir'];
const SOURCE_KEYS = ['source', 'repo', 'url', 'path', 'ref', 'sha'];
const fetched = (s) => typeof s === 'string' || (plain(s) && SOURCE_TYPES.includes(s.source) && Object.keys(s).every((k) => SOURCE_KEYS.includes(k)));
// The variable the role guard of cl-workflow reads; an automatic worker runs without it.
const ROLE = 'CEDARLOOM_ROLE';
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
    // command, args and env are fields only of an entry whose command is no object: elsewhere they can be the names of servers.
    const entry = value.command !== undefined && !plain(value.command);
    for (const [k, v] of Object.entries(value)) if (!entry || !['command', 'args', 'env'].includes(k)) commands(v, out);
  }
  return out;
}

// Every hook under value that is no command hook (an http, prompt, agent or mcp_tool hook), as JSON: it acts outside the permission rules and the role guard as well, and the script judges none.
function otherHooks(value, out = []) {
  if (Array.isArray(value)) for (const v of value) otherHooks(v, out);
  else if (plain(value)) {
    if (value.type !== undefined && value.command === undefined) out.push(JSON.stringify(value));
    else for (const v of Object.values(value)) otherHooks(v, out);
  }
  return out;
}

// What the frontmatter of a skill, agent or command file sets that the script does not read: one of FRONTMATTER_KEYS, or a top-level line that is no plain key (a quoted key, a flow mapping, a merge), which could hold one. undefined for neither.
function frontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0].trimEnd() !== '---') return undefined;
  const end = lines.findIndex((line, i) => i && /^(---|\.\.\.)\s*$/.test(line));
  let keyed = false;
  for (const line of lines.slice(1, end < 0 ? undefined : end)) {
    const key = /^([A-Za-z_][\w-]*)\s*:(\s|$)/.exec(line)?.[1];
    if (FRONTMATTER_KEYS.includes(key)) return `its frontmatter sets ${key}`;
    // An indented line, a list entry and a comment belong to the key above them. With no key above, only a comment or an empty line passes: an indented line there can open a mapping whose keys all sit past column 0.
    if (!key && !(keyed ? /^(\s|#|-(\s|$)|$)/ : /^\s*(#|$)/).test(line)) return 'its frontmatter holds a line that is no plain key';
    keyed ||= key !== undefined;
  }
  return undefined;
}

const folderAt = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };
// The names in a folder, none when it does not exist.
const names = (folder) => { try { return readdirSync(folder); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []; throw new Error(`${folder} could not be listed: ${e.code}`); } };
const inside = (folder, path) => { const r = relative(folder, path); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
// The real path of the deepest part that exists, the rest appended: a link in any parent is followed. null for a link that leads nowhere, whose target the script cannot test.
const real = (path) => {
  try { return realpathSync(path); } catch { /* not there, or a link that leads nowhere */ }
  try { lstatSync(path); return null; } catch { /* not there */ }
  const up = dirname(path), r = up === path ? null : real(up);
  return r && join(r, basename(path));
};
// Every Markdown file in folder and below, links followed. seen holds the folders read, so a link loop ends and a folder named twice is read once.
function markdown(folder, seen) {
  const target = real(folder);
  if (!target || seen.has(target)) return [];
  seen.add(target);
  return names(folder).flatMap((name) => (folderAt(join(folder, name)) ? markdown(join(folder, name), seen) : /\.md$/i.test(name) ? [join(folder, name)] : []));
}
// Every skills, agents or commands folder in a .claude folder of a folder below this one, node_modules and .git left out. A folder that is a link is tested and not walked: it can lead anywhere, also back up.
function nested(folder) {
  return names(folder).filter((name) => name !== 'node_modules' && name !== '.git').map((name) => join(folder, name)).filter(folderAt)
    .flatMap((below) => [...INSTRUCTIONS.map((kind) => join(below, '.claude', kind)).filter(folderAt), ...(lstatSync(below).isDirectory() ? nested(below) : [])]);
}

export function startChecks({ project, worktree, configDir, claudeJson, managedDir, home, env = {} }) {
  const failed = [], toRead = [], unresolved = [], allowRules = [];
  const fail = (check, source, entry) => failed.push({ check, source, entry: escaped(String(entry)) });
  const cannot = (source, reason) => unresolved.push({ source, reason: escaped(String(reason)) });
  const checkouts = [project, ...(worktree ? [worktree] : [])];
  for (const folder of [configDir, ...checkouts]) if (!existsSync(folder)) cannot(folder, 'the folder does not exist');

  const managedD = join(managedDir, 'managed-settings.d');
  const object = (v) => (plain(v) ? v : {});
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
    for (const key of COMMAND_KEYS) if (settings[key] !== undefined && typeof settings[key] !== 'string' && !plain(settings[key])) cannot(file, `${key} is no string or object`);
    for (const key of Object.keys(settings)) if (!PLAIN_KEYS.has(key) && !OBJECTS.includes(key) && !COMMAND_KEYS.includes(key)) cannot(file, `${key} is no key the script knows to run no command`);
    for (const key of Object.keys(object(settings.permissions))) if (!PERMISSION_KEYS.includes(key)) cannot(file, `permissions.${key} is no key the script knows to run no command`);
    for (const key of LISTS) { const list = at(settings, key); if (list !== undefined && !(Array.isArray(list) && list.every((e) => typeof e === 'string'))) cannot(file, `${key} is no list of strings`); }
    return true;
  });
  // A file the script reads as an object: another type is a shape it cannot read.
  const objectIn = (file) => { const v = readJson(file); if (v !== undefined && !plain(v)) cannot(file, 'holds no JSON object'); return object(v); };

  // Check 3: what runs outside the permission rules and the role guard.
  const found = [];
  for (const { file, settings } of files) {
    for (const c of commands(settings.hooks)) found.push({ source: file, command: c });
    for (const h of otherHooks(settings.hooks)) toRead.push({ source: file, command: escaped(h) });
    for (const key of COMMAND_KEYS) {
      const listed = typeof settings[key] === 'string' ? [settings[key]] : commands(settings[key]);
      // An object that names its program in another field than command, as policyHelper does in path.
      if (plain(settings[key]) && !listed.length) cannot(file, `${key} holds no command the script reads`);
      for (const c of listed) found.push({ source: `${file} ${key}`, command: c });
    }
    // The session's environment reaches every command Claude Code starts (NODE_OPTIONS, PATH).
    const vars = Object.entries(object(settings.env));
    if (vars.length) found.push({ source: `${file} env`, command: vars.map(([k, v]) => `${k}=${v}`).join(' ') });
  }
  const repoPaths = checkouts.flatMap((p) => [p, real(p) ?? p]);
  const user = objectIn(claudeJson);
  // Local-scope servers sit under the folder they were added in: each folder that holds the project or the worktree counts.
  const local = Object.entries(object(user?.projects)).filter(([folder]) => isAbsolute(folder) && repoPaths.some((p) => inside(folder, p)));
  const mcpFiles = [join(managedDir, 'managed-mcp.json'), ...checkouts.map((root) => join(root, '.mcp.json'))];
  for (const [source, servers] of [[claudeJson, user.mcpServers], ...local.map(([folder, p]) => [`${claudeJson} projects ${folder}`, p?.mcpServers]), ...mcpFiles.map((file) => [file, objectIn(file).mcpServers])]) {
    if (servers !== undefined && !plain(servers)) cannot(source, 'mcpServers is no object');
    for (const c of commands(servers)) found.push({ source, command: c });
  }
  for (const name of PLUGIN_VARS) if (env[name]) cannot(name, 'adds plugins the script does not read');
  // Plugins no install record names: a folder with .claude-plugin in a skills folder and a plugin synced from claude.ai.
  for (const folder of [join(configDir, 'skills'), ...checkouts.map((root) => join(root, '.claude/skills'))]) {
    for (const name of names(folder)) if (existsSync(join(folder, name, '.claude-plugin'))) cannot(join(folder, name), 'a plugin folder the script does not read');
  }
  for (const name of names(join(configDir, 'plugins/synced'))) cannot(join(configDir, 'plugins/synced', name), 'a synced plugin the script does not read');
  // A skill, agent or command file can define hooks and MCP servers in its frontmatter: the script names the file and reads none of them.
  const seen = new Set();
  const instructions = (folders) => {
    for (const file of folders.flatMap((folder) => markdown(folder, seen))) {
      const set = frontmatter(readFileSync(file, 'utf8'));
      if (set) cannot(file, `${set}, which the script does not read`);
    }
  };
  instructions([configDir, ...checkouts.map((root) => join(root, '.claude'))].flatMap((base) => INSTRUCTIONS.map((kind) => join(base, kind))));
  // Claude Code loads a subfolder's .claude folder once the worker works on a file there: the script names each and reads none, but for a link to a folder read above.
  for (const folder of nested(worktree ?? project)) if (!seen.has(real(folder))) cannot(folder, 'a nested .claude folder the script does not read');
  // An installed plugin is on unless a file turns it off; one turned on in any file counts: a later scope may turn it off, but failing closed checks it anyway.
  // A worktree session loads the committed settings of its own folder and the local settings of the main checkout: a false in the other two files turns nothing off for it.
  const unloaded = worktree && worktree !== project ? [join(project, '.claude/settings.json'), join(worktree, '.claude/settings.local.json')] : [];
  const switched = files.flatMap(({ file, settings }) => Object.entries(object(settings.enabledPlugins)).filter(([, on]) => on !== false || !unloaded.includes(file)));
  const installedFile = join(configDir, 'plugins/installed_plugins.json');
  const installedPlugins = objectIn(installedFile).plugins;
  if (installedPlugins !== undefined && !plain(installedPlugins)) cannot(installedFile, 'plugins is no object');
  const installed = object(installedPlugins);
  const known = objectIn(join(configDir, 'plugins/known_marketplaces.json'));
  // The plugin's entry in its marketplace can declare commands besides the plugin's own files.
  const marketplaceEntry = (key, source) => {
    const [name, market] = [key.slice(0, key.lastIndexOf('@')), key.slice(key.lastIndexOf('@') + 1)];
    const location = known[market]?.installLocation;
    const file = join(typeof location === 'string' && isAbsolute(location) ? location : join(configDir, 'plugins/marketplaces', market), '.claude-plugin/marketplace.json');
    const listed = objectIn(file).plugins;
    if (!name || !Array.isArray(listed)) return cannot(source, `${file} lists no plugins`);
    for (const e of listed.filter((p) => p?.name === name)) {
      const more = Object.keys(object(e)).filter((k) => !ENTRY_KEYS.includes(k) || (k === 'source' && !fetched(e.source)));
      if (more.length) cannot(source, `its marketplace entry declares ${more.join(', ')}, which the script does not read`);
    }
  };
  for (const key of new Set([...Object.keys(installed), ...switched.map(([k]) => k)])) {
    const named = switched.filter(([k]) => k === key);
    if (named.length && named.every(([, on]) => on === false)) continue;
    const source = `plugin ${key}`;
    const roots = entries(installed[key]).map((i) => i?.installPath);
    const usable = (root) => typeof root === 'string' && isAbsolute(root) && folderAt(root);
    if (!roots.length) cannot(source, `${installedFile} names no folder of it`);
    if (roots.some(usable)) marketplaceEntry(key, source);
    for (const root of roots) {
      if (!usable(root)) { cannot(source, `its folder ${root} does not exist`); continue; }
      const manifest = objectIn(join(root, '.claude-plugin/plugin.json'));
      // A manifest key holds the definitions or names files of them, relative to the plugin's folder.
      const defined = PARTS.map(([key2, file]) => [...(file ? [readJson(join(root, file))] : []), ...entries(at(manifest, key2)).map((v) => {
        if (plain(v)) return v;
        const text = typeof v === 'string' ? readJson(resolve(root, v)) : undefined;
        if (text === undefined) cannot(source, `${key2} names nothing the script can read: ${JSON.stringify(v)}`);
        return text;
      })]);
      // Shown with the plugin's folder in place of the variable, so the reader finds the file the command runs.
      for (const c of commands(defined)) found.push({ source, command: c.replaceAll('${CLAUDE_PLUGIN_ROOT}', root).replaceAll('$CLAUDE_PLUGIN_ROOT', root) });
      // The first of PARTS holds the hooks.
      for (const h of otherHooks(defined[0])) toRead.push({ source, command: escaped(h) });
      // A manifest or marketplace entry can name any folder of the plugin as its skills, agents or commands: every Markdown file of the plugin counts.
      instructions([root]);
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
    // A .. after a link, or a glob before one, leaves the folder its spelling names.
    const parts = p.split(/[\\/]/);
    if (parts.includes('..') || parts.slice(0, -1).some((part) => /[*?[{]/.test(part))) return true;
    // Both spellings must lie inside: a link in the worktree, at any depth of the path, can lead out of it.
    const r = real(resolve(path)), w = real(worktree);
    if (!inside(worktree, resolve(path)) || !r || !w || !inside(w, r)) return true;
    // A glob in the last part can match a link by its name: every link in the folder counts, at any depth below it for **.
    if (!/[*?[{]/.test(parts.at(-1))) return false;
    let below;
    try { below = readdirSync(dirname(r), { withFileTypes: true, recursive: parts.at(-1).includes('**') }); } catch (e) { return e.code !== 'ENOENT' && e.code !== 'ENOTDIR'; }
    return below.filter((d) => d.isSymbolicLink()).map((d) => real(join(d.parentPath, d.name))).some((target) => !target || !inside(w, target));
  };
  for (const { file, scope, settings } of files) {
    const permissions = object(settings.permissions);
    // Each turns off a bound the worker relies on: auto mode, the role guard's hook, or the guard's reading of the role.
    for (const key of ['disableAutoMode', 'permissions.disableAutoMode']) { const v = at(settings, key); if (v !== undefined && v !== false) fail(4, file, `${key} keeps the worker out of auto mode: ${JSON.stringify(v)}`); }
    if (settings.disableAllHooks !== undefined && settings.disableAllHooks !== false) fail(4, file, 'disableAllHooks turns off the role guard');
    if (settings.allowManagedHooksOnly !== undefined && settings.allowManagedHooksOnly !== false) fail(4, file, 'allowManagedHooksOnly can turn off the role guard');
    if (plain(settings.env) && Object.hasOwn(settings.env, ROLE)) fail(4, file, `env sets ${ROLE}, which the worker must not inherit`);
    if (settings.sandbox !== undefined && !(plain(settings.sandbox) && settings.sandbox.enabled === false)) fail(4, file, 'sandbox: CedarLoom ignores the Claude Code sandbox and does not support it; set sandbox.enabled to false or remove the key');
    // Auto mode's classifier reads autoMode from these scopes: allow and environment entries widen what it lets pass, and a list without "$defaults" drops its built-in rules.
    if ((scope === 'managed' || scope === 'user') && settings.autoMode !== undefined) {
      if (!plain(settings.autoMode)) cannot(file, 'autoMode is no object');
      else for (const [key, list] of Object.entries(settings.autoMode)) {
        if (!Array.isArray(list) || !list.includes('$defaults')) cannot(file, `autoMode.${key} is no list with "$defaults", which keeps the classifier's built-in rules: ${JSON.stringify(list)}`);
        else if ((key === 'allow' || key === 'environment') && list.some((e) => e !== '$defaults')) cannot(file, `autoMode.${key} can widen what auto mode's classifier lets pass: ${JSON.stringify(list)}`);
      }
    }
    for (const e of entries(permissions.additionalDirectories)) if (outside(scope, e)) fail(4, file, `permissions.additionalDirectories outside the worktree: ${e}`);
    for (const rule of entries(permissions.allow)) {
      const text = String(rule);
      // An allow rule of a tool that edits files can open its path to the file tools.
      const written = /^\s*(?:Edit|MultiEdit|Write|NotebookEdit)\((.*)\)\s*$/s.exec(text)?.[1];
      if (written !== undefined && outside(scope, written)) cannot(file, `an Edit, MultiEdit, Write or NotebookEdit allow rule outside the worktree: ${text}`);
      else allowRules.push({ source: file, rule: escaped(text) });
    }
  }
  return { failed, read: toRead, unresolved, allowRules };
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
    const result = startChecks(options);
    console.log(json(result));
    process.exitCode = result.failed.length ? 1 : result.read.length || result.unresolved.length ? 2 : 0;
  } catch (e) {
    console.error(escaped(e.message.split('\n')[0]));
    process.exitCode = 1;
  }
}
