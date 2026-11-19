// Validates workflow definitions and writes the entry skill of each; the only validator of the definition format (docs/plugins.md, Workflows).
// Usage: node generator/generate.mjs <definition>... [--prefix <plugin name>|--prefix ''] [--out <folder>] [--check] [--json]
// Exit 0 written or no difference, 1 a refusal or (with --check) a difference, 2 a usage error.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// An agent by name, optionally with its plugin, never a file path.
const AGENT = /^[a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const PLAN_AGENT = 'cl-workflow:plan';
// Round caps of the playbooks: two rounds on the default models (deep.md), one plan check fix round (software.md).
const MAX_ROUNDS = 2;
const MAX_PLAN_ROUNDS = 1;
const KIND = { software: 'software change', docs: 'docs pass', research: 'research' };

const text = [(v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string'];
const bool = [(v) => typeof v === 'boolean', 'true or false'];
const oneOf = (...values) => [(v) => values.includes(v), `one of ${values.map((v) => JSON.stringify(v)).join(', ')}`];
const list = [(v) => Array.isArray(v) && v.length > 0, 'a non-empty array'];
const object = [(v) => v !== null && typeof v === 'object' && !Array.isArray(v), 'an object'];
const agent = [(v) => typeof v === 'string' && AGENT.test(v), 'an agent name such as "cl-workflow:review", never a path'];

// Field to [test, rule, required].
const TOP = {
  schemaVersion: [(v) => v === 2, 'must be 2', true],
  name: [(v) => typeof v === 'string' && NAME.test(v) && !v.endsWith('-run'), 'kebab-case, not ending in -run', true],
  description: [(v) => typeof v === 'string' && v.length <= 250 && /\S\.$/.test(v), 'a string of at most 250 characters that ends in a period', true],
  when: [...text, false],
  writes: [...text, false],
  work: [...oneOf('software', 'docs', 'research'), true],
  depth: [...oneOf('quick', 'standard', 'deep', 'classify'), true],
  script: [...bool, true],
  stages: [...list, true],
};
const STAGE = { id: [...text, true], phases: [...list, true] };
const PHASE = { id: [...text, true], run: [...oneOf('session', 'agent'), true], brief: [...text, false] };
const SESSION = { ...PHASE, step: [...oneOf('settle', 'pull-request'), true], questions: [...bool, false] };
const AGENT_PHASE = {
  ...PHASE,
  agent: [...agent, true],
  model: [...oneOf('haiku', 'sonnet', 'opus', 'fable', 'inherit'), true],
  effort: [...oneOf('low', 'medium', 'high', 'xhigh', 'max'), false],
  with: [...text, false],
  loop: [...object, false],
};
const LOOP = {
  fix: [...text, true],
  recheck: [...agent, false],
  maxRounds: [(v) => Number.isInteger(v) && v >= 1 && v <= MAX_ROUNDS, `an integer from 1 to ${MAX_ROUNDS}`, true],
  escalate: [...bool, true],
};

// Refusals of one definition, each { field, rule }; `field` is the path to the value, such as `stages[1].phases[3].loop.maxRounds`.
function refusals(def) {
  const found = [];
  const refuse = (field, rule) => found.push({ field, rule });
  const at = (path, key) => (path ? `${path}.${key}` : key);
  // Checks the fields of `value` by `table`; false when it is no object.
  const fields = (value, path, table) => {
    if (!object[0](value)) return refuse(path, 'must be an object'), false;
    for (const key of Object.keys(value)) if (!(key in table)) refuse(at(path, key), 'unknown field');
    for (const [key, [test, rule, required]] of Object.entries(table)) {
      if (value[key] === undefined) required && refuse(at(path, key), 'required');
      else if (!test(value[key])) refuse(at(path, key), rule);
    }
    return true;
  };
  if (!fields(def, '', TOP)) return found;
  if (def.script === true && (def.work !== 'software' || def.depth !== 'deep')) refuse('script', 'a script needs work "software" and depth "deep"');
  else if (def.script === true) refuse('script', 'this generator writes no workflow script yet: set script to false');
  if (!list[0](def.stages)) return found;
  const phaseIds = new Set();
  const stageIds = new Set();
  def.stages.forEach((stage, s) => {
    const path = `stages[${s}]`;
    if (!fields(stage, path, STAGE)) return;
    if (stageIds.has(stage.id)) refuse(`${path}.id`, 'used by an earlier stage');
    stageIds.add(stage.id);
    if (!list[0](stage.phases)) return;
    const phases = stage.phases.filter((phase) => object[0](phase));
    stage.phases.forEach((phase, p) => {
      const here = `${path}.phases[${p}]`;
      if (!object[0](phase)) return refuse(here, 'must be an object');
      if (!PHASE.run[0](phase.run)) return refuse(`${here}.run`, phase.run === undefined ? 'required' : PHASE.run[1]);
      fields(phase, here, phase.run === 'session' ? SESSION : AGENT_PHASE);
      if (phaseIds.has(phase.id)) refuse(`${here}.id`, 'used by an earlier phase');
      phaseIds.add(phase.id);
      if (phase.run === 'session') {
        if (p !== 0 && p !== stage.phases.length - 1) refuse(`${here}.run`, 'a session phase stands only first or last in its stage');
        if (phase.questions !== undefined && phase.step !== 'settle') refuse(`${here}.questions`, 'only for step "settle"');
        return;
      }
      if (phase.with !== undefined) {
        const target = phases.find((other) => other.id === phase.with && other !== phase);
        if (!target || !object[0](target.loop)) refuse(`${here}.with`, 'names a phase of the same stage that has a loop');
        if (phase.loop !== undefined) refuse(`${here}.loop`, 'a phase with "with" has no loop of its own');
      }
      if (!object[0](phase.loop) || !fields(phase.loop, `${here}.loop`, LOOP)) return;
      const fix = stage.phases.slice(0, p).find((other) => object[0](other) && other.run === 'agent' && other.id === phase.loop.fix);
      if (!fix) refuse(`${here}.loop.fix`, 'names an earlier agent phase of the same stage');
      else if (fix.agent === PLAN_AGENT && Number.isInteger(phase.loop.maxRounds) && phase.loop.maxRounds > MAX_PLAN_ROUNDS)
        refuse(`${here}.loop.maxRounds`, `at most ${MAX_PLAN_ROUNDS} where fix is a plan phase`);
    });
  });
  return found;
}

// The generated files of one valid definition, as relative path to text.
function outputs(def, prefix) {
  // A project's own definition lives in .cedarloom/workflows/; the header names it wherever the generator read it from.
  const source = prefix ? `definitions/${def.name}.json by generator/generate.mjs` : `.cedarloom/workflows/${def.name}.json by cl-workflow's generator/generate.mjs`;
  const note = `Generated from ${source}: edit the definition, not this file.`;
  const front = [
    `name: ${def.name}`,
    `description: ${JSON.stringify(def.description)}`,
    'disable-model-invocation: true',
    'argument-hint: "<task>"',
    ...(def.when === undefined ? [] : [`when: ${JSON.stringify(def.when)}`]),
    ...(def.writes === undefined ? [] : [`writes: ${JSON.stringify(def.writes)}`]),
  ];
  const kind = KIND[def.work];
  const lines = def.work === 'software' ? 'the `Depth:` and `Risk:` lines' : 'the `Depth:` line';
  const depth = def.depth === 'classify' ? 'The depth comes from its rules.' : `The depth is at least ${def.depth}; its rules may raise it.`;
  const title = def.name[0].toUpperCase() + def.name.slice(1).replaceAll('-', ' ');
  const skill = [
    '---',
    ...front,
    '---',
    `<!-- ${note} -->`,
    '',
    `# ${title}`,
    '',
    `Typed as \`/${prefix ? `${prefix}:` : ''}${def.name} <task>\`. No task given and none open in the conversation: ask for it, or without terminal questions stop and say it is missing.`,
    '',
    '1. Where the skill `cl-workflow:workflow` is not installed or its load is refused, say so and stop.',
    `2. Load the skill \`cl-workflow:workflow\` and run its step 1 with the kind fixed: ${kind}. ${depth} Write ${lines} before the first edit or command.`,
    `3. Follow the rest of that skill and its ${kind} playbook at that depth; an item of another kind in the task runs by its own playbook.`,
  ];
  return {
    [`skills/${def.name}/SKILL.md`]: `${skill.join('\n')}\n`,
    [`skills/${def.name}/agents/openai.yaml`]: `# ${note}\npolicy:\n  allow_implicit_invocation: false\n`,
  };
}

// Reads and validates each file; refusals carry the file as given.
function load(files) {
  const defs = [];
  const found = [];
  const names = new Set();
  for (const file of files) {
    let def;
    try {
      def = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      found.push({ file, field: '', rule: error instanceof SyntaxError ? `not valid JSON: ${error.message}` : `cannot be read: ${error.code ?? error.message}` });
      continue;
    }
    const own = refusals(def).map((r) => ({ file, ...r }));
    if (!own.length && names.has(def.name)) own.push({ file, field: 'name', rule: 'another definition given has the same name' });
    if (!own.length) names.add(def.name), defs.push(def);
    found.push(...own);
  }
  return { defs, found };
}

function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: { prefix: { type: 'string', default: 'cl-workflow' }, out: { type: 'string' }, check: { type: 'boolean' }, json: { type: 'boolean' } },
    });
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const { values, positionals } = args;
  if (!positionals.length || (values.prefix !== '' && !NAME.test(values.prefix))) {
    console.error("usage: node generator/generate.mjs <definition>... [--prefix <plugin name>|--prefix ''] [--out <folder>] [--check] [--json]");
    return 2;
  }
  const { defs, found } = load(positionals);
  if (values.json) console.log(JSON.stringify(found));
  else for (const r of found) console.error(`${r.file}: ${r.field || '(file)'}: ${r.rule}`);
  if (found.length) return 1;
  const out = resolve(values.out ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  let differs = 0;
  for (const def of defs) {
    for (const [path, content] of Object.entries(outputs(def, values.prefix))) {
      const target = join(out, path);
      if (!values.check) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
        continue;
      }
      let current;
      try {
        current = readFileSync(target, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (current !== content) differs++, console.error(`${path} differs from its definition: run the generator without --check`);
    }
  }
  return differs ? 1 : 0;
}

process.exitCode = main();
