import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startChecks } from '../skills/coordinate/start-checks.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/coordinate/start-checks.mjs', import.meta.url));

// A home with a config dir, a managed folder and a project; files maps a path below dir to the JSON it holds.
function setup(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'start-checks-'));
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value));
  }
  for (const folder of ['project', 'wt', 'home/.claude']) mkdirSync(join(dir, folder), { recursive: true });
  const options = { project: join(dir, 'project'), worktree: join(dir, 'wt'), configDir: join(dir, 'home/.claude'), claudeJson: join(dir, 'home/.claude.json'), managedDir: join(dir, 'managed'), home: join(dir, 'home'), env: {} };
  return { dir, options, run: (more = {}) => startChecks({ ...options, ...more }) };
}
const hook = (command) => ({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command }] }] } });

test('start-checks: settings with no command and no entry that defeats a bound pass, naming the other allow rules', () => {
  const s = setup({ 'home/.claude/settings.json': { permissions: { allow: ['Bash(ls *)', 'WebFetch(domain:raw.githubusercontent.com)'] } } });
  assert.deepEqual(s.run(), {
    failed: [], read: [], unresolved: [],
    allowRules: [{ source: join(s.dir, 'home/.claude/settings.json'), rule: 'Bash(ls *)' }, { source: join(s.dir, 'home/.claude/settings.json'), rule: 'WebFetch(domain:raw.githubusercontent.com)' }],
    classifyAllShell: [],
  });
});

test('start-checks: a command that runs a repository file or a tool that loads its code fails check 3', () => {
  const s = setup({
    'project/.claude/settings.json': hook('"$CLAUDE_PROJECT_DIR"/.claude/hooks/format.sh'),
    'project/.claude/settings.local.json': { statusLine: { type: 'command', command: 'node scripts/status.js' } },
    'project/.mcp.json': { mcpServers: { db: { command: 'npx', args: ['db-mcp'] } } },
    'managed/managed-settings.json': hook('cd /tmp && FORCE=1 prettier --write .'),
  });
  // A local-scope server of a folder that holds the project; the one of another folder is not loaded there.
  mkdirSync(s.options.home, { recursive: true });
  writeFileSync(s.options.claudeJson, JSON.stringify({ projects: { [s.dir]: { mcpServers: { srv: { command: 'node', args: ['server/index.mjs'] } } }, [join('/', 'elsewhere')]: { mcpServers: { a: { command: 'npm', args: ['start'] } } } } }));
  assert.deepEqual(s.run().failed.map((f) => [f.check, f.source.slice(s.dir.length + 1), f.entry]), [
    [3, 'managed/managed-settings.json', "runs a tool that loads the repository's code or configuration: cd /tmp && FORCE=1 prettier --write ."],
    [3, 'project/.claude/settings.json', 'runs a file inside the repository: "$CLAUDE_PROJECT_DIR"/.claude/hooks/format.sh'],
    [3, 'project/.claude/settings.local.json statusLine', 'runs a file inside the repository: node scripts/status.js'],
    [3, `home/.claude.json projects ${s.dir}`, 'runs a file inside the repository: node server/index.mjs'],
    [3, 'project/.mcp.json', "runs a tool that loads the repository's code or configuration: npx db-mcp"],
  ]);
});

test('start-checks: other commands, of an enabled plugin and of the user, are listed to read, and a disabled plugin is not', () => {
  const s = setup({
    'home/.claude/settings.json': { enabledPlugins: { 'guard@market': true, 'off@market': false }, apiKeyHelper: '/usr/local/bin/key-helper --endpoint=https://keys.example.com/v1 2>/dev/null' },
    'home/.claude.json': { mcpServers: { web: { type: 'http', url: 'https://example.com/mcp', headersHelper: '/opt/h.sh' } } },
  });
  // The install paths lie in the test's folder, known once it exists.
  const plugin = join(s.dir, 'plugin'), off = join(s.dir, 'off');
  mkdirSync(join(s.dir, 'home/.claude/plugins'));
  writeFileSync(join(s.dir, 'home/.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'guard@market': [{ installPath: plugin }], 'off@market': [{ installPath: off }] } }));
  mkdirSync(join(plugin, 'hooks'), { recursive: true });
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, 'hooks/hooks.json'), JSON.stringify(hook('node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"')));
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'guard', lspServers: { ts: { command: 'typescript-language-server', args: ['--stdio'] } } }));
  mkdirSync(join(off, 'hooks'), { recursive: true });
  writeFileSync(join(off, 'hooks/hooks.json'), JSON.stringify(hook('npm test')));
  const result = s.run();
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.read.map((r) => r.command), [
    '/usr/local/bin/key-helper --endpoint=https://keys.example.com/v1 2>/dev/null',
    '/opt/h.sh',
    `node "${plugin}/hooks/guard.mjs"`,
    'typescript-language-server --stdio',
  ]);
});

test('start-checks: an additionalDirectories entry outside the worktree fails check 4', () => {
  const s = setup({ 'home/.claude/settings.json': { permissions: { additionalDirectories: ['~/notes', '../shared'] } } });
  assert.deepEqual(s.run().failed.map((f) => f.entry), [
    'permissions.additionalDirectories outside the worktree: ~/notes',
    'permissions.additionalDirectories outside the worktree: ../shared',
  ]);
});

test('start-checks: an entry inside the worktree, or relative in the committed settings, passes check 4', () => {
  const s = setup({
    'project/.claude/settings.json': { permissions: { additionalDirectories: ['build'] } },
  });
  // The settings' own absolute form, //, for a folder in the worktree.
  mkdirSync(join(s.dir, 'home/.claude'), { recursive: true });
  writeFileSync(join(s.dir, 'home/.claude/settings.json'), JSON.stringify({ permissions: { additionalDirectories: [`/${join(s.options.worktree, 'cache')}`] } }));
  assert.deepEqual(s.run().failed, []);
  assert.deepEqual(s.run({ worktree: undefined }).failed.map((f) => f.entry), [`permissions.additionalDirectories outside the worktree: /${join(s.options.worktree, 'cache')}`]);
  // A link in the worktree that leads out of it.
  mkdirSync(join(s.dir, 'shared'));
  symlinkSync(join(s.dir, 'shared'), join(s.options.worktree, 'cache'));
  assert.deepEqual(s.run().failed.map((f) => f.entry), [`permissions.additionalDirectories outside the worktree: /${join(s.options.worktree, 'cache')}`]);
});

test('start-checks: the command line exits 0 on a pass, 2 with commands to read, 1 on a failure or an unreadable file', () => {
  const s = setup();
  const project = s.options.project;
  const settings = join(s.dir, 'home/.claude/settings.json');
  mkdirSync(dirname(settings), { recursive: true });
  const run = () => spawnSync(process.execPath, [SCRIPT, '--project', project, '--config-dir', join(s.dir, 'home/.claude'), '--managed', join(s.dir, 'managed')], { encoding: 'utf8' });
  assert.equal(run().status, 0, run().stderr);
  writeFileSync(settings, JSON.stringify({ apiKeyHelper: '/usr/local/bin/key-helper' }));
  const listed = run();
  assert.equal(listed.status, 2);
  assert.deepEqual(JSON.parse(listed.stdout).read, [{ source: `${settings} apiKeyHelper`, command: '/usr/local/bin/key-helper' }]);
  writeFileSync(settings, JSON.stringify({ permissions: { additionalDirectories: ['/etc'] } }));
  assert.equal(run().status, 1);
  writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'fmt@market': true } }));
  const unresolved = run();
  assert.equal(unresolved.status, 2);
  assert.deepEqual(JSON.parse(unresolved.stdout).unresolved, [{ source: 'plugin fmt@market', reason: `${join(s.dir, 'home/.claude/plugins/installed_plugins.json')} names no folder of it` }]);
  writeFileSync(settings, '{ not json');
  const unreadable = run();
  assert.equal(unreadable.status, 1);
  assert.equal(unreadable.stderr.trim(), `${settings} is not valid JSON`);
});

test('start-checks: a plugin source the script cannot resolve is unresolved, and an installed plugin no file names counts', () => {
  const s = setup({ 'home/.claude/settings.json': { enabledPlugins: { 'a@m': true, 'b@m': true, 'c@m': true, 'd@m': true } } });
  const reasons = () => s.run().unresolved.map((u) => `${u.source}: ${u.reason.replaceAll(s.dir, '<dir>')}`);
  assert.deepEqual(reasons(), ['plugin a@m: <dir>/home/.claude/plugins/installed_plugins.json names no folder of it', 'plugin b@m: <dir>/home/.claude/plugins/installed_plugins.json names no folder of it', 'plugin c@m: <dir>/home/.claude/plugins/installed_plugins.json names no folder of it', 'plugin d@m: <dir>/home/.claude/plugins/installed_plugins.json names no folder of it']);
  const plugin = join(s.dir, 'e');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ hooks: './missing.json', experimental: { monitors: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/watch.mjs"' }] } }));
  mkdirSync(join(s.dir, 'home/.claude/plugins'));
  writeFileSync(join(s.dir, 'home/.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'a@m': [{}], 'b@m': [{ installPath: join(s.dir, 'gone') }], 'd@m': [{ installPath: 'relative' }], 'e@m': [{ installPath: plugin }] } }));
  mkdirSync(join(s.dir, 'home/.claude/plugins/marketplaces/m/.claude-plugin'), { recursive: true });
  writeFileSync(join(s.dir, 'home/.claude/plugins/marketplaces/m/.claude-plugin/marketplace.json'), JSON.stringify({ name: 'm', plugins: [{ name: 'e', source: './e', description: 'e' }] }));
  assert.deepEqual(reasons(), ['plugin a@m: its folder undefined does not exist', 'plugin b@m: its folder <dir>/gone does not exist', 'plugin d@m: its folder relative does not exist', 'plugin e@m: hooks names nothing the script can read: "./missing.json"', 'plugin c@m: <dir>/home/.claude/plugins/installed_plugins.json names no folder of it']);
  // e@m is named in no file and runs its monitor.
  assert.deepEqual(s.run().read, [{ source: 'plugin e@m', command: `node "${plugin}/watch.mjs"` }]);
  assert.deepEqual(s.run({ env: { CLAUDE_CODE_PLUGIN_DIRS: '/opt/plugins' } }).unresolved.at(0), { source: 'CLAUDE_CODE_PLUGIN_DIRS', reason: 'adds plugins the script does not read' });
});

test("start-checks: the worktree's settings and .mcp.json are read as the main checkout's", () => {
  const s = setup({
    'wt/.claude/settings.json': hook('npx prettier --write .'),
    'wt/.claude/settings.local.json': { permissions: { additionalDirectories: ['/opt/x'] } },
    'wt/.mcp.json': { mcpServers: { srv: { command: 'node', args: ['./server.js'] } } },
    'managed/managed-mcp.json': { mcpServers: { corp: { command: 'npx', args: ['corp-mcp'] } } },
  });
  assert.deepEqual(s.run().failed.map((f) => [f.check, f.source.slice(s.dir.length + 1), f.entry]), [
    [3, 'wt/.claude/settings.json', "runs a tool that loads the repository's code or configuration: npx prettier --write ."],
    [3, 'managed/managed-mcp.json', "runs a tool that loads the repository's code or configuration: npx corp-mcp"],
    [3, 'wt/.mcp.json', 'runs a file inside the repository: node ./server.js'],
    [4, 'wt/.claude/settings.local.json', 'permissions.additionalDirectories outside the worktree: /opt/x'],
  ]);
});

test('start-checks: an entry that a link at any depth leads out of the worktree fails check 4', () => {
  const s = setup();
  mkdirSync(join(s.dir, 'shared'));
  symlinkSync(join(s.dir, 'shared'), join(s.options.worktree, 'out'));
  symlinkSync(join(s.dir, 'nowhere'), join(s.options.worktree, 'dangling'));
  const wt = s.options.worktree;
  mkdirSync(join(s.dir, 'project/.claude'));
  writeFileSync(join(s.dir, 'project/.claude/settings.json'), JSON.stringify({ permissions: { additionalDirectories: ['out/cache', 'build', `${wt}/out/missing`, `${wt}/out/**`, `${wt}/dangling`, `${wt}/new/dir`] } }));
  assert.deepEqual(s.run().failed.map((f) => f.entry.replaceAll(wt, '<wt>')), [
    'permissions.additionalDirectories outside the worktree: out/cache',
    'permissions.additionalDirectories outside the worktree: <wt>/out/missing',
    'permissions.additionalDirectories outside the worktree: <wt>/out/**',
    'permissions.additionalDirectories outside the worktree: <wt>/dangling',
  ]);
});

test('start-checks: an environment of a server or of the settings is tested and listed with the command', () => {
  const s = setup({
    'home/.claude.json': { mcpServers: {
      a: { command: 'node', args: ['/opt/server.js'], env: { NODE_OPTIONS: `--require=${join('/', 'x')}` } },
      b: { command: '/opt/b', env: { PATH: './node_modules/.bin' } },
    } },
    'home/.claude/settings.json': { env: { NODE_OPTIONS: '--max-old-space-size=4096' } },
  });
  const result = s.run();
  assert.deepEqual(result.failed.map((f) => f.entry), ['runs a file inside the repository: PATH=./node_modules/.bin /opt/b']);
  assert.deepEqual(result.read.map((r) => [r.source.slice(s.dir.length + 1), r.command]), [
    ['home/.claude/settings.json env', 'NODE_OPTIONS=--max-old-space-size=4096'],
    ['home/.claude.json', 'NODE_OPTIONS=--require=/x node /opt/server.js'],
  ]);
});

test('start-checks: a value of a shape the script cannot read is unresolved or listed, never passed', () => {
  const s = setup({
    'home/.claude/settings.json': [],
    'project/.claude/settings.json': { permissions: 'on', enabledPlugins: ['x@m'], ...hook(['/opt/fmt', '.']) },
  });
  const result = s.run();
  assert.deepEqual(result.unresolved.map((u) => `${u.source.slice(s.dir.length + 1)}: ${u.reason}`), [
    'home/.claude/settings.json: holds no JSON object',
    'project/.claude/settings.json: permissions is no object',
    'project/.claude/settings.json: enabledPlugins is no object',
  ]);
  assert.deepEqual(result.failed.map((f) => f.entry), ['runs a file inside the repository: ["/opt/fmt","."]']);
  // A mistyped --config-dir or --worktree.
  assert.deepEqual(s.run({ configDir: join(s.dir, 'none'), worktree: join(s.dir, 'wt2') }).unresolved.slice(0, 2).map((u) => `${u.source.slice(s.dir.length + 1)}: ${u.reason}`), ['none: the folder does not exist', 'wt2: the folder does not exist']);
});

test('start-checks: MCP servers named env, args or command are read as any other', () => {
  const s = setup({ 'wt/.mcp.json': { mcpServers: { env: { command: 'npx', args: ['prettier', '--write', '.'] }, args: { command: 'node', args: ['./server.js'] }, command: { command: 'make', args: ['serve'] } } } });
  const entries = s.run().failed.map((f) => f.entry);
  for (const entry of ["runs a tool that loads the repository's code or configuration: npx prettier --write .", 'runs a file inside the repository: node ./server.js', "runs a tool that loads the repository's code or configuration: make serve"]) assert.ok(entries.includes(entry), entry);
});

test('start-checks: a plugin without an install record, or with commands in its marketplace entry, is unresolved', () => {
  const plugin = { '.claude-plugin/plugin.json': { name: 'fmt' }, 'hooks/hooks.json': hook('npx prettier --write .') };
  const at = (folder) => Object.fromEntries(Object.entries(plugin).map(([path, value]) => [`${folder}/${path}`, value]));
  const s = setup({
    ...at('home/.claude/skills/fmt'), ...at('project/.claude/skills/fmt'), ...at('wt/.claude/skills/fmt'), ...at('home/.claude/plugins/synced/fmt'),
    // A folder without .claude-plugin is no plugin.
    'home/.claude/skills/.git/HEAD': 'ref: refs/heads/main\n',
    'home/.claude/skills/ok/SKILL.md': '---\nname: ok\n---\n',
    'home/.claude/plugins/marketplaces/m/.claude-plugin/marketplace.json': { name: 'm', plugins: [{ name: 'fmt', source: './fmt', hooks: hook('npx prettier --write .').hooks }] },
    'home/.claude/plugins/cache/m/fmt/1/skills/x/SKILL.md': 'x',
  });
  writeFileSync(join(s.dir, 'home/.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'fmt@m': [{ installPath: join(s.dir, 'home/.claude/plugins/cache/m/fmt/1') }], 'gone@n': [{ installPath: join(s.dir, 'home/.claude/plugins/cache/m/fmt/1') }] } }));
  assert.deepEqual(s.run().unresolved.map((u) => `${u.source.replaceAll(s.dir, '<dir>')}: ${u.reason.replaceAll(s.dir, '<dir>')}`), [
    '<dir>/home/.claude/skills/fmt: a plugin folder the script does not read',
    '<dir>/project/.claude/skills/fmt: a plugin folder the script does not read',
    '<dir>/wt/.claude/skills/fmt: a plugin folder the script does not read',
    '<dir>/home/.claude/plugins/synced/fmt: a synced plugin the script does not read',
    'plugin fmt@m: its marketplace entry declares hooks, which the script does not read',
    'plugin gone@n: <dir>/home/.claude/plugins/marketplaces/n/.claude-plugin/marketplace.json lists no plugins',
  ]);
});

// An installed plugin fmt@m whose hook runs a tool, with this marketplace entry and these other files.
function withPlugin(entry, files = {}) {
  const s = setup({
    'home/.claude/plugins/marketplaces/m/.claude-plugin/marketplace.json': { name: 'm', plugins: [{ name: 'fmt', ...entry }] },
    'home/.claude/plugins/cache/m/fmt/1/hooks/hooks.json': hook('npx prettier --write .'),
    ...files,
  });
  writeFileSync(join(s.dir, 'home/.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'fmt@m': [{ installPath: join(s.dir, 'home/.claude/plugins/cache/m/fmt/1') }] } }));
  return s.run();
}

test('start-checks: a marketplace entry passes only with a source that fetches files; a command source or another key is unresolved', () => {
  for (const source of ['./fmt', { source: 'github', repo: 'o/r', ref: 'main' }, { source: 'git-subdir', url: 'https://example.com/r.git', path: 'fmt', sha: 'abc' }]) {
    assert.deepEqual(withPlugin({ displayName: 'Fmt', defaultEnabled: false, source }).unresolved, [], JSON.stringify(source));
  }
  for (const source of [{ source: 'command', command: 'sh fetch.sh' }, { source: 'command', path: 'bin/fetch' }, { source: 'github', repo: 'o/r', command: 'sh fetch.sh' }, { source: 'npm', package: 'fmt' }, 7]) {
    assert.deepEqual(withPlugin({ source }).unresolved.map((u) => u.reason), ['its marketplace entry declares source, which the script does not read'], JSON.stringify(source));
  }
  assert.deepEqual(withPlugin({ source: './fmt', futureRunner: {} }).unresolved.map((u) => u.reason), ['its marketplace entry declares futureRunner, which the script does not read']);
});

test('start-checks: a plugin turned off only in a settings file the worktree session does not load is still checked', () => {
  const failures = (file) => withPlugin({ source: './fmt' }, { [file]: { enabledPlugins: { 'fmt@m': false } } }).failed.length;
  // The session loads the worktree's committed settings and the main checkout's local settings.
  assert.deepEqual(['project/.claude/settings.json', 'wt/.claude/settings.local.json', 'project/.claude/settings.local.json', 'wt/.claude/settings.json'].map(failures), [1, 1, 0, 0]);
});

test('start-checks: a settings key the script does not know to run no command is unresolved, and each command setting is read', () => {
  const s = setup({
    'managed/managed-settings.json': { policyHelper: { path: '/opt/corp/policy' }, extraKnownMarketplaces: {} },
    'home/.claude/settings.json': { model: 'opus', processWrapper: '/opt/corp/launch' },
    'wt/.claude/settings.json': { subagentStatusLine: { type: 'command', command: 'node scripts/status.js' }, futureHelper: 'sh run.sh' },
  });
  const r = s.run(), [managed, user, committed] = ['managed/managed-settings.json', 'home/.claude/settings.json', 'wt/.claude/settings.json'].map((file) => join(s.dir, file));
  assert.deepEqual(r.failed, [{ check: 3, source: `${committed} subagentStatusLine`, entry: 'runs a file inside the repository: node scripts/status.js' }]);
  assert.deepEqual(r.read, [{ source: `${user} processWrapper`, command: '/opt/corp/launch' }]);
  assert.deepEqual(r.unresolved, [
    { source: managed, reason: 'extraKnownMarketplaces is no key the script knows to run no command' },
    { source: committed, reason: 'futureHelper is no key the script knows to run no command' },
    { source: managed, reason: 'policyHelper holds no command the script reads' },
  ]);
});

test('start-checks: settings that keep the worker out of auto mode, turn off hooks, set the role or turn on the sandbox fail check 4', () => {
  const s = setup({
    'managed/managed-settings.json': { permissions: { disableAutoMode: 'disable' }, allowManagedHooksOnly: true },
    'home/.claude/settings.json': { disableAllHooks: true, sandbox: { enabled: true }, disableAutoMode: 'disable' },
    'project/.claude/settings.local.json': { env: { CEDARLOOM_ROLE: 'coordinator' }, sandbox: {} },
    'wt/.claude/settings.json': { disableAllHooks: false, sandbox: { enabled: false }, permissions: { disableAutoMode: false }, disableAutoMode: false },
  });
  const r = s.run();
  assert.deepEqual(r.failed.filter((f) => f.check === 4).map((f) => [f.source.slice(s.dir.length + 1), f.entry]), [
    ['managed/managed-settings.json', 'permissions.disableAutoMode keeps the worker out of auto mode: "disable"'],
    ['managed/managed-settings.json', 'allowManagedHooksOnly can turn off the role guard'],
    ['home/.claude/settings.json', 'disableAutoMode keeps the worker out of auto mode: "disable"'],
    ['home/.claude/settings.json', 'disableAllHooks turns off the role guard'],
    ['home/.claude/settings.json', 'sandbox: CedarLoom ignores the Claude Code sandbox and does not support it; set sandbox.enabled to false or remove the key'],
    ['project/.claude/settings.local.json', 'env sets CEDARLOOM_ROLE, which the worker must not inherit'],
    ['project/.claude/settings.local.json', 'sandbox: CedarLoom ignores the Claude Code sandbox and does not support it; set sandbox.enabled to false or remove the key'],
  ]);
  assert.deepEqual(r.unresolved, []);
});

test('start-checks: an Edit, MultiEdit, Write or NotebookEdit allow rule outside the worktree is unresolved, one inside it is listed', () => {
  const s = setup({
    'home/.claude/settings.json': { permissions: { allow: ['Write(build/**)'] } },
    'project/.claude/settings.json': { permissions: { allow: ['Edit(src/**)', 'Write(//etc/**)', 'Edit(~/notes/**)', 'Edit(../other/**)', 'Edit', 'NotebookEdit(//etc/**)', 'NotebookEdit(notebooks/**)', 'MultiEdit(//etc/**)', 'MultiEdit(src/**)'] } },
  });
  const r = s.run(), [user, committed] = ['home/.claude/settings.json', 'project/.claude/settings.json'].map((file) => join(s.dir, file));
  assert.deepEqual(r.allowRules, [{ source: committed, rule: 'Edit(src/**)' }, { source: committed, rule: 'Edit' }, { source: committed, rule: 'NotebookEdit(notebooks/**)' }, { source: committed, rule: 'MultiEdit(src/**)' }]);
  assert.deepEqual(r.unresolved, [
    { source: user, reason: 'an Edit, MultiEdit, Write or NotebookEdit allow rule outside the worktree: Write(build/**)' },
    { source: committed, reason: 'an Edit, MultiEdit, Write or NotebookEdit allow rule outside the worktree: Write(//etc/**)' },
    { source: committed, reason: 'an Edit, MultiEdit, Write or NotebookEdit allow rule outside the worktree: Edit(~/notes/**)' },
    { source: committed, reason: 'an Edit, MultiEdit, Write or NotebookEdit allow rule outside the worktree: Edit(../other/**)' },
    { source: committed, reason: 'an Edit, MultiEdit, Write or NotebookEdit allow rule outside the worktree: NotebookEdit(//etc/**)' },
    { source: committed, reason: 'an Edit, MultiEdit, Write or NotebookEdit allow rule outside the worktree: MultiEdit(//etc/**)' },
  ]);
});

const HOOKS = '---\nname: x\ndescription: x\nhooks:\n  PreToolUse:\n    - hooks:\n        - type: command\n          command: "npx prettier --write ."\n---\nx\n';

test('start-checks: a skill, agent or command file whose frontmatter sets hooks or MCP servers is unresolved, in the worktree, the config dir and a plugin', () => {
  const plainFile = '---\nname: y\ndescription: >-\n  hooks: none\nallowed-tools:\n- Read\n# hooks: none\nmetadata:\n  hooks: none\n---\nhooks: none\n';
  const s = setup({
    'wt/.claude/skills/x/SKILL.md': HOOKS,
    'wt/.claude/skills/y/SKILL.md': plainFile,
    'wt/.claude/skills/y/notes.txt': HOOKS,
    'wt/.claude/agents/a.md': '---\nname: a\ndescription: a\nmcpServers:\n  - s:\n      command: npx\n---\na\n',
    'wt/.claude/agents/team/b.md': HOOKS,
    'wt/.claude/commands/c.md': HOOKS,
    'project/.claude/skills/x/SKILL.md': HOOKS,
    'home/.claude/skills/x/SKILL.md': HOOKS,
    'home/.claude/agents/a.md': HOOKS,
    // A key the script cannot read as a plain one could be hooks in another spelling.
    'wt/.claude/skills/q/SKILL.md': '---\nname: q\n"hooks": {}\n---\n',
    'wt/.claude/skills/f/SKILL.md': '---\n{ name: f, hooks: {} }\n---\n',
    'wt/.claude/skills/open/SKILL.md': '---\nname: open\nhooks: {}\n',
    'wt/.claude/skills/none/SKILL.md': '# No frontmatter\n\nhooks: none\n',
  });
  const sets = (key) => `its frontmatter sets ${key}, which the script does not read`, line = 'its frontmatter holds a line that is no plain key, which the script does not read';
  assert.deepEqual(s.run().unresolved.map((u) => [u.source.slice(s.dir.length + 1), u.reason]).sort(), [
    ['home/.claude/agents/a.md', sets('hooks')],
    ['home/.claude/skills/x/SKILL.md', sets('hooks')],
    ['project/.claude/skills/x/SKILL.md', sets('hooks')],
    ['wt/.claude/agents/a.md', sets('mcpServers')],
    ['wt/.claude/agents/team/b.md', sets('hooks')],
    ['wt/.claude/commands/c.md', sets('hooks')],
    ['wt/.claude/skills/f/SKILL.md', line],
    ['wt/.claude/skills/open/SKILL.md', sets('hooks')],
    ['wt/.claude/skills/q/SKILL.md', line],
    ['wt/.claude/skills/x/SKILL.md', sets('hooks')],
  ]);
  // A skills folder that is a link is read as well.
  const linked = setup({ 'elsewhere/x/SKILL.md': HOOKS });
  mkdirSync(join(linked.dir, 'wt/.claude'));
  symlinkSync(join(linked.dir, 'elsewhere'), join(linked.dir, 'wt/.claude/skills'));
  assert.deepEqual(linked.run().unresolved, [{ source: join(linked.dir, 'wt/.claude/skills/x/SKILL.md'), reason: sets('hooks') }]);
  // A plugin's files, in its default folders and in any other its manifest or marketplace entry can name; a plugin turned off is not read.
  const cache = 'home/.claude/plugins/cache/m/fmt/1';
  const files = { [`${cache}/hooks/hooks.json`]: {}, [`${cache}/skills/y/SKILL.md`]: HOOKS, [`${cache}/agents/a.md`]: HOOKS, [`${cache}/custom/z/SKILL.md`]: HOOKS, [`${cache}/skills/y/plain.md`]: plainFile };
  assert.deepEqual(withPlugin({ source: './fmt' }, files).unresolved.map((u) => [u.source.slice(u.source.indexOf(cache) + cache.length + 1), u.reason]).sort(), [['agents/a.md', sets('hooks')], ['custom/z/SKILL.md', sets('hooks')], ['skills/y/SKILL.md', sets('hooks')]]);
  assert.deepEqual(withPlugin({ source: './fmt' }, { ...files, 'home/.claude/settings.json': { enabledPlugins: { 'fmt@m': false } } }).unresolved, []);
});

test('start-checks: frontmatter with a line before its first plain key that is no comment is unresolved', () => {
  const s = setup({
    // An indented mapping is a mapping to a YAML reader, so its hooks key counts.
    'wt/.claude/skills/all/SKILL.md': '---\n  name: x\n  description: x\n  hooks:\n    PreToolUse:\n      - hooks:\n          - type: command\n            command: "./scripts/check.sh"\n---\nx\n',
    'project/.claude/skills/one/SKILL.md': '---\n hooks:\n  Stop:\n   - hooks:\n      - type: command\n        command: "npm test"\n---\nx\n',
    'home/.claude/agents/after.md': '---\n# note\n\n  name: x\n  hooks: {}\n---\nx\n',
    'wt/.claude/commands/list.md': '---\n- hooks: {}\n---\nx\n',
    'wt/.claude/skills/plain/SKILL.md': '---\n\n  # note\n# note\nname: y\ndescription: >\n  one\nallowed-tools:\n- Read\n---\nx\n',
    'wt/.claude/skills/empty/SKILL.md': '---\n---\nx\n',
  });
  const line = 'its frontmatter holds a line that is no plain key, which the script does not read';
  assert.deepEqual(s.run().unresolved.map((u) => [u.source.slice(s.dir.length + 1), u.reason]).sort(), [
    ['home/.claude/agents/after.md', line],
    ['project/.claude/skills/one/SKILL.md', line],
    ['wt/.claude/commands/list.md', line],
    ['wt/.claude/skills/all/SKILL.md', line],
  ]);
});

test('start-checks: a skills, agents or commands folder in a .claude folder below the worktree root is unresolved, unread', () => {
  const s = setup({
    'wt/packages/a/.claude/skills/x/SKILL.md': HOOKS,
    'wt/packages/a/.claude/settings.json': {},
    'wt/packages/b/deep/.claude/agents/a.md': 'a\n',
    'wt/tools/.claude/commands/c.md': 'c\n',
    'wt/.claude/skills/y/SKILL.md': 'y\n',
    'wt/node_modules/p/.claude/skills/x/SKILL.md': HOOKS,
    'wt/.git/.claude/skills/x/SKILL.md': HOOKS,
    'wt/docs/.claude/notes.md': HOOKS,
    'elsewhere/.claude/skills/x/SKILL.md': HOOKS,
  });
  // A folder that is a link counts by its own .claude folder, unless that is the root's own, which is read.
  symlinkSync(join(s.dir, 'elsewhere'), join(s.dir, 'wt/linked'));
  symlinkSync(join(s.dir, 'wt'), join(s.dir, 'wt/packages/loop'));
  const reason = 'a nested .claude folder the script does not read';
  assert.deepEqual(s.run().unresolved.map((u) => [u.source.slice(s.dir.length + 1), u.reason]).sort(), [
    ['wt/linked/.claude/skills', reason],
    ['wt/packages/a/.claude/skills', reason],
    ['wt/packages/b/deep/.claude/agents', reason],
    ['wt/tools/.claude/commands', reason],
  ]);
});

test('start-checks: a hook of another type than command is listed to read, in the settings and in a plugin', () => {
  const http = { type: 'http', url: 'https://example.com/hook' }, prompt = { type: 'prompt', prompt: 'Is src/a.js safe?' };
  const s = setup({ 'wt/.claude/settings.json': { hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [http, { type: 'command', command: '/opt/bin/audit' }] }], Stop: [{ hooks: [prompt] }] } } });
  const committed = join(s.dir, 'wt/.claude/settings.json');
  assert.deepEqual(s.run(), { failed: [], read: [{ source: committed, command: '{"type":"http","url":"https://example.com/hook"}' }, { source: committed, command: '{"type":"prompt","prompt":"Is src/a.js safe?"}' }, { source: committed, command: '/opt/bin/audit' }], unresolved: [], allowRules: [], classifyAllShell: [] });
  const r = withPlugin({ source: './fmt' }, { 'home/.claude/plugins/cache/m/fmt/1/hooks/hooks.json': { hooks: { Stop: [{ hooks: [http] }] } }, 'home/.claude/plugins/cache/m/fmt/1/.mcp.json': { mcpServers: { docs: { type: 'http', url: 'https://example.com/mcp' } } } });
  assert.deepEqual(r, { failed: [], read: [{ source: 'plugin fmt@m', command: '{"type":"http","url":"https://example.com/hook"}' }], unresolved: [], allowRules: [], classifyAllShell: [] });
});

test('start-checks: a managed or user autoMode that widens the classifier or drops its built-in rules is unresolved', () => {
  const s = setup({
    'managed/managed-settings.json': { autoMode: { soft_deny: ['Never touch prod'] } },
    'home/.claude/settings.json': { autoMode: { allow: ['$defaults', 'Any git push, force pushes included'], environment: ['$defaults', 'Every host is trusted'], soft_deny: ['$defaults', 'Never touch prod'] } },
    'wt/.claude/settings.json': { autoMode: { allow: ['Any git push'] } },
  });
  assert.deepEqual(s.run().unresolved.map((u) => [u.source.slice(s.dir.length + 1), u.reason]), [
    ['managed/managed-settings.json', 'autoMode.soft_deny is no list with "$defaults", which keeps the classifier\'s built-in rules: ["Never touch prod"]'],
    ['home/.claude/settings.json', 'autoMode.allow can widen what auto mode\'s classifier lets pass: ["$defaults","Any git push, force pushes included"]'],
    ['home/.claude/settings.json', 'autoMode.environment can widen what auto mode\'s classifier lets pass: ["$defaults","Every host is trusted"]'],
  ]);
  assert.deepEqual(setup({ 'home/.claude/settings.json': { autoMode: 'off' } }).run().unresolved.map((u) => u.reason), ['autoMode is no object']);
  const shell = setup({ 'managed/managed-settings.json': { autoMode: { classifyAllShell: true } }, 'home/.claude/settings.json': { autoMode: { classifyAllShell: false } } });
  const { unresolved, classifyAllShell } = shell.run();
  assert.deepEqual(unresolved, []);
  assert.deepEqual(classifyAllShell.map((c) => [c.source.slice(shell.dir.length + 1), c.value]), [['managed/managed-settings.json', true], ['home/.claude/settings.json', false]]);
  assert.deepEqual(setup({ 'home/.claude/settings.json': { autoMode: { classifyAllShell: 'true' } } }).run().unresolved.map((u) => u.reason), ['autoMode.classifyAllShell is no boolean: "true"']);
});

test('start-checks: a wrong type below permissions, or a permissions key the script does not know, is unresolved', () => {
  const reasons = (settings) => setup({ 'wt/.claude/settings.json': settings }).run().unresolved.map((u) => u.reason);
  assert.deepEqual(reasons({ permissions: { allow: { a: 'Edit(//etc/**)' } } }), ['permissions.allow is no list of strings']);
  assert.deepEqual(reasons({ permissions: { additionalDirectories: [['..']] } }), ['permissions.additionalDirectories is no list of strings']);
  assert.deepEqual(reasons({ permissions: { futureHelper: 'npx x' } }), ['permissions.futureHelper is no key the script knows to run no command']);
  assert.deepEqual(reasons({ permissions: { allow: ['Read'], deny: ['Bash(curl *)'], ask: [], defaultMode: 'acceptEdits', disableBypassPermissionsMode: 'disable', disableAutoMode: 'disable', additionalDirectories: ['docs'] } }), []);
});

test('start-checks: a glob in the last part that can match a link out of the worktree fails check 4', () => {
  const s = setup({ 'wt/build/a.txt': 'a', 'wt/deep/in/a.txt': 'a' });
  for (const folder of ['wt/build', 'wt/deep/in']) symlinkSync(join(s.dir, 'home'), join(s.dir, folder, 'link'));
  const wt = join(s.dir, 'wt');
  writeFileSync(join(s.dir, 'home/.claude/settings.json'), JSON.stringify({ permissions: { additionalDirectories: [`${wt}/build/lin*`, `${wt}/deep/**`, `${wt}/deep/*`, `${wt}/src/*`] } }));
  // deep/* matches no link, as the link lies one folder below; src does not exist.
  assert.deepEqual(s.run().failed.map((f) => f.entry.replaceAll(s.dir, '<dir>')), ['permissions.additionalDirectories outside the worktree: <dir>/wt/build/lin*', 'permissions.additionalDirectories outside the worktree: <dir>/wt/deep/**']);
});

test('start-checks: a file or value of another type than the script reads is unresolved, never passed', () => {
  const s = setup({
    'wt/.mcp.json': [{ command: 'npx x' }],
    'home/.claude.json': [{ mcpServers: { a: { command: 'npx x' } } }],
    'project/.mcp.json': { mcpServers: [{ command: 'npx x' }] },
    'home/.claude/settings.json': { statusLine: ['npx x'] },
    'home/.claude/plugins/installed_plugins.json': { plugins: [{ installPath: '/x' }] },
  });
  assert.deepEqual(s.run().unresolved.map((u) => `${u.source.slice(s.dir.length + 1)}: ${u.reason}`), [
    'home/.claude/settings.json: statusLine is no string or object',
    'home/.claude.json: holds no JSON object',
    'wt/.mcp.json: holds no JSON object',
    'project/.mcp.json: mcpServers is no object',
    'home/.claude/plugins/installed_plugins.json: plugins is no object',
  ]);
  const file = join(s.dir, 'afile'), manifestList = join(s.dir, 'listed');
  writeFileSync(file, 'x');
  mkdirSync(join(manifestList, '.claude-plugin'), { recursive: true });
  writeFileSync(join(manifestList, '.claude-plugin/plugin.json'), '[]');
  writeFileSync(join(s.dir, 'home/.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'f@m': [{ installPath: file }], 'l@m': [{ installPath: manifestList }] } }));
  writeFileSync(join(s.dir, 'home/.claude/plugins/known_marketplaces.json'), JSON.stringify({ m: { installLocation: s.dir } }));
  mkdirSync(join(s.dir, '.claude-plugin'));
  writeFileSync(join(s.dir, '.claude-plugin/marketplace.json'), JSON.stringify({ plugins: [] }));
  assert.deepEqual(s.run().unresolved.slice(4).map((u) => `${u.source.replaceAll(s.dir, '<dir>')}: ${u.reason.replaceAll(s.dir, '<dir>')}`), [
    'plugin f@m: its folder <dir>/afile does not exist',
    '<dir>/listed/.claude-plugin/plugin.json: holds no JSON object',
  ]);
});

test('start-checks: a .. after a link or a glob before one fails check 4', () => {
  const s = setup();
  mkdirSync(join(s.dir, 'shared/deep'), { recursive: true });
  symlinkSync(join(s.dir, 'shared'), join(s.options.worktree, 'out'));
  const wt = s.options.worktree;
  mkdirSync(join(s.dir, 'project/.claude'));
  writeFileSync(join(s.dir, 'project/.claude/settings.json'), JSON.stringify({ permissions: { additionalDirectories: [`${wt}/*/deep`, '*/deep', 'out/deep/../../x', 'build/**'] } }));
  assert.deepEqual(s.run().failed.map((f) => f.entry.replaceAll(wt, '<wt>')), [
    'permissions.additionalDirectories outside the worktree: <wt>/*/deep',
    'permissions.additionalDirectories outside the worktree: */deep',
    'permissions.additionalDirectories outside the worktree: out/deep/../../x',
  ]);
});
