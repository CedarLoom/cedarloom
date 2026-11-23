import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startChecks } from '../skills/coordinate/start-checks.mjs';
import { initRepo } from './git-repo.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/coordinate/start-checks.mjs', import.meta.url));

// A home with a config dir, a managed folder and a project; files maps a path below dir to the JSON it holds.
function setup(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'start-checks-'));
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value));
  }
  mkdirSync(join(dir, 'project'), { recursive: true });
  const options = { project: join(dir, 'project'), worktree: join(dir, 'wt'), configDir: join(dir, 'home/.claude'), claudeJson: join(dir, 'home/.claude.json'), managedDir: join(dir, 'managed'), home: join(dir, 'home'), platform: 'linux', domains: ['registry.npmjs.org'] };
  return { dir, options, run: (more = {}) => startChecks({ ...options, ...more }) };
}
const hook = (command) => ({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command }] }] } });

test('start-checks: settings with no command and no entry that defeats a bound pass, naming the other allow rules and domains', () => {
  const s = setup({ 'home/.claude/settings.json': { permissions: { allow: ['Bash(ls *)'] }, sandbox: { network: { allowedDomains: ['pypi.org'] }, filesystem: { allowWrite: [] } } } });
  assert.deepEqual(s.run(), {
    failed: [], read: [],
    allowRules: [{ source: join(s.dir, 'home/.claude/settings.json'), rule: 'Bash(ls *)' }],
    allowedDomains: [{ source: join(s.dir, 'home/.claude/settings.json'), domain: 'pypi.org' }],
  });
});

test('start-checks: a command that runs a repository file or a tool that loads its code fails check 3', () => {
  const s = setup({
    'project/.claude/settings.json': hook('"$CLAUDE_PROJECT_DIR"/.claude/hooks/format.sh'),
    'project/.claude/settings.local.json': { statusLine: { type: 'command', command: 'node scripts/status.js' } },
    'project/.mcp.json': { mcpServers: { db: { command: 'npx', args: ['db-mcp'] } } },
    'managed/managed-settings.json': hook('cd /tmp && FORCE=1 prettier --write .'),
  });
  assert.deepEqual(s.run().failed.map((f) => [f.check, f.source.slice(s.dir.length + 1), f.entry]), [
    [3, 'managed/managed-settings.json', "runs a tool that loads the repository's code or configuration: cd /tmp && FORCE=1 prettier --write ."],
    [3, 'project/.claude/settings.json', 'runs a file inside the repository: "$CLAUDE_PROJECT_DIR"/.claude/hooks/format.sh'],
    [3, 'project/.claude/settings.local.json statusLine', 'runs a file inside the repository: node scripts/status.js'],
    [3, 'project/.mcp.json', "runs a tool that loads the repository's code or configuration: npx db-mcp"],
  ]);
});

test('start-checks: other commands, of an enabled plugin and of the user, are listed to read, and a disabled plugin is not', () => {
  const s = setup({
    'home/.claude/settings.json': { enabledPlugins: { 'guard@market': true, 'off@market': false }, apiKeyHelper: '/usr/local/bin/key-helper 2>/dev/null' },
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
    '/usr/local/bin/key-helper 2>/dev/null',
    '/opt/h.sh',
    'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"',
    'typescript-language-server --stdio',
  ]);
});

test('start-checks: each entry that defeats a bound fails check 4', () => {
  const s = setup({
    'home/.claude/settings.json': {
      permissions: { allow: ['WebFetch(domain:raw.githubusercontent.com)'], additionalDirectories: ['~/notes'] },
      sandbox: {
        excludedCommands: ['docker'], allowAppleEvents: true, enabledPlatforms: ['macos'], bwrapPath: '/opt/bwrap',
        network: { allowUnixSockets: ['/var/run/docker.sock'], allowLocalBinding: true, httpProxyPort: 8080, allowedDomains: ['*.github.com'] },
        filesystem: { allowRead: [join('/', 'etc')], allowWrite: ['../shared'] },
      },
    },
  });
  assert.deepEqual(s.run({ domains: ['github.com'] }).failed.map((f) => f.entry), [
    'sandbox.allowAppleEvents',
    'sandbox.network.allowLocalBinding',
    'sandbox.excludedCommands',
    'sandbox.network.allowUnixSockets',
    'sandbox.network.httpProxyPort',
    'sandbox.bwrapPath',
    'sandbox.enabledPlatforms leaves out this platform',
    'sandbox.filesystem.allowRead outside the worktree: /etc',
    'sandbox.filesystem.allowWrite outside the worktree: ../shared',
    'permissions.additionalDirectories outside the worktree: ~/notes',
    'a GitHub host in sandbox.network.allowedDomains: *.github.com',
    'a GitHub host in a WebFetch allow rule: WebFetch(domain:raw.githubusercontent.com)',
    'a GitHub host: github.com',
  ]);
});

test('start-checks: an entry inside the worktree, or relative in the committed settings, passes check 4', () => {
  const s = setup({
    'project/.claude/settings.json': { sandbox: { filesystem: { allowWrite: ['build'] } } },
  });
  // The settings' own absolute form, //, for a folder in the worktree.
  mkdirSync(join(s.dir, 'home/.claude'), { recursive: true });
  writeFileSync(join(s.dir, 'home/.claude/settings.json'), JSON.stringify({ permissions: { additionalDirectories: [`/${join(s.options.worktree, 'cache')}`] } }));
  assert.deepEqual(s.run().failed, []);
  assert.deepEqual(s.run({ worktree: undefined }).failed.map((f) => f.entry), [`permissions.additionalDirectories outside the worktree: /${join(s.options.worktree, 'cache')}`]);
});

test('start-checks: the command line exits 0 on a pass, 2 with commands to read, 1 on a failure or an unreadable file', () => {
  const s = setup();
  // The policy comes from origin's default branch.
  const origin = join(s.dir, 'origin');
  mkdirSync(origin);
  const git = initRepo(origin);
  mkdirSync(join(origin, 'docs/agents'), { recursive: true });
  writeFileSync(join(origin, 'docs/agents/orchestration.json'), '{ "mode": "automatic", "sandbox": { "allowedDomains": ["registry.npmjs.org"] } }\n');
  git('add', '-A');
  git('commit', '-qm', 'policy');
  const project = join(s.dir, 'checkout');
  git('clone', '-q', origin, project);
  const settings = join(s.dir, 'home/.claude/settings.json');
  mkdirSync(dirname(settings), { recursive: true });
  const run = () => spawnSync(process.execPath, [SCRIPT, '--project', project, '--config-dir', join(s.dir, 'home/.claude'), '--managed', join(s.dir, 'managed')], { encoding: 'utf8' });
  assert.equal(run().status, 0, run().stderr);
  writeFileSync(settings, JSON.stringify({ apiKeyHelper: '/usr/local/bin/key-helper' }));
  const listed = run();
  assert.equal(listed.status, 2);
  assert.deepEqual(JSON.parse(listed.stdout).read, [{ source: `${settings} apiKeyHelper`, command: '/usr/local/bin/key-helper' }]);
  writeFileSync(settings, JSON.stringify({ sandbox: { excludedCommands: ['git'] } }));
  assert.equal(run().status, 1);
  writeFileSync(settings, '{ not json');
  const unreadable = run();
  assert.equal(unreadable.status, 1);
  assert.equal(unreadable.stderr.trim(), `${settings} is not valid JSON`);
});
