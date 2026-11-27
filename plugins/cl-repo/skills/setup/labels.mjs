#!/usr/bin/env node
// The CedarLoom labels: lists the ones a repository lacks and creates the approved ones through gh.
// Usage: gh label list -R <owner/repo> --limit 1000 --json name | node labels.mjs missing [--start <label>]
//        node labels.mjs create <owner/repo> [--start <label>] <label>...
// Exit 0 ok, 1 a label could not be created, 2 usage error.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const START = 'cl:ready-for-agent';

// GitHub takes a label description of 100 characters or fewer: https://docs.github.com/rest/issues/labels#create-a-label
const LABELS = [
  ['cl:plan', 'CedarLoom may read and plan the issue and ask on it; it does not start work.'],
  [START, 'The coordinator may start the issue.'],
  ['cl:needs-human', 'A question or approval waits for the owner.'],
  ['cl:in-progress', 'A worker holds the issue, so it never starts twice.'],
  ['cl:deferred', 'The owner parked it: it does not start and the question queue skips it.'],
  ['cl:follow-up', 'Found during other work, sized for one pull request; the owner chooses whether it starts.'],
  ['cl:triage', 'Filed through the issue template; the owner reads it before adding another label.'],
];

// GitHub matches label names without regard to case.
const key = (name) => name.toLowerCase();

// The label set with the policy's start label in place of cl:ready-for-agent; a start label equal to another label of the set is refused.
export function labelSet(start = START) {
  if (LABELS.some(([name]) => name !== START && key(name) === key(start))) throw new Error(`the start label ${start} is another CedarLoom label`);
  return LABELS.map(([name, description]) => ({ name: name === START ? start : name, description }));
}

// The labels of the set that `existing`, the JSON of `gh label list --json name`, lacks.
export function missing(existing, start) {
  const names = new Set(JSON.parse(existing).map((label) => key(label.name)));
  return labelSet(start).filter((label) => !names.has(key(label.name)));
}

// Creates each named label of the set; `gh` runs one gh command and throws when it fails. Returns the commands that failed.
export function create(repo, names, start, gh) {
  const set = labelSet(start);
  const unknown = names.filter((name) => !set.some((label) => label.name === name));
  if (unknown.length) throw new Error(`not a CedarLoom label: ${unknown.join(', ')}`);
  const failed = [];
  for (const { name, description } of set.filter((label) => names.includes(label.name))) {
    const args = ['label', 'create', name, '-R', repo, '--description', description];
    try {
      gh(args);
    } catch {
      failed.push(`gh ${args.map((a) => (/^[\w:./-]+$/.test(a) ? a : JSON.stringify(a))).join(' ')}`);
    }
  }
  return failed;
}

function run(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { start: { type: 'string' } } });
  const [command, ...rest] = positionals;
  if (command === 'missing' && rest.length === 0) {
    for (const { name, description } of missing(readFileSync(0, 'utf8'), values.start)) console.log(`${name}\t${description}`);
    return 0;
  }
  if (command === 'create' && rest.length > 1) {
    const gh = (args) => execFileSync('gh', args, { stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true, timeout: 60_000, killSignal: 'SIGKILL' });
    const failed = create(rest[0], rest.slice(1), values.start, gh);
    for (const line of failed) console.log(`not created: ${line}`);
    return failed.length ? 1 : 0;
  }
  console.error('usage: node labels.mjs missing [--start <label>] < labels.json | create <owner/repo> [--start <label>] <label>...');
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
