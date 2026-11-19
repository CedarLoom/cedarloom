// Validates workflow definitions and writes the entry skill of each, and the workflow script of a scripted one; the only validator of the definition format (docs/plugins.md, Workflows).
// Usage: node generator/generate.mjs <definition>... [--prefix <plugin name>|--prefix ''] [--out <folder>] [--check] [--json]   (--prefix '' needs --out)
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
// The end of every generated file's header; a file without it is never replaced.
const MARK = ': edit the definition, not this file.';
const KIND = { software: 'software change', docs: 'docs pass', research: 'research' };
// What a workflow script reads from each agent it may start: a plan, an implement status, a test status or findings.
const ROLES = {
  'cl-workflow:plan': 'plan',
  'cl-workflow:implement': 'change',
  'cl-workflow:test': 'test',
  'cl-workflow:verify': 'findings',
  'cl-workflow:review': 'findings',
  'cl-workflow:recheck': 'findings',
};
// The verifier of a risky change's findings before the first fix (deep.md, Review rounds).
const TRIAL = { agent: 'cl-workflow:verify', model: 'opus' };
const RUNNER = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'runner.js'), 'utf8');

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
  description: [(v) => typeof v === 'string' && [...v].length <= 250 && /\S\.$/.test(v), 'a string of at most 250 characters that ends in a period', true],
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
    for (const key of Object.keys(value)) if (!Object.hasOwn(table, key)) refuse(at(path, key), 'unknown field');
    for (const [key, [test, rule, required]] of Object.entries(table)) {
      if (value[key] === undefined) required && refuse(at(path, key), 'required');
      else if (!test(value[key])) refuse(at(path, key), rule);
    }
    return true;
  };
  if (!fields(def, '', TOP)) return found;
  if (def.script === true && (def.work !== 'software' || def.depth !== 'deep')) refuse('script', 'a script needs work "software" and depth "deep"');
  if (!list[0](def.stages)) return found;
  const phaseIds = new Set();
  const stageIds = new Set();
  def.stages.forEach((stage, s) => {
    const path = `stages[${s}]`;
    if (!fields(stage, path, STAGE)) return;
    if (text[0](stage.id) && stageIds.has(stage.id)) refuse(`${path}.id`, 'used by an earlier stage');
    stageIds.add(stage.id);
    if (!list[0](stage.phases)) return;
    const phases = stage.phases.filter((phase) => object[0](phase));
    stage.phases.forEach((phase, p) => {
      const here = `${path}.phases[${p}]`;
      if (!object[0](phase)) return refuse(here, 'must be an object');
      if (!PHASE.run[0](phase.run)) return refuse(`${here}.run`, phase.run === undefined ? 'required' : PHASE.run[1]);
      fields(phase, here, phase.run === 'session' ? SESSION : AGENT_PHASE);
      if (text[0](phase.id) && phaseIds.has(phase.id)) refuse(`${here}.id`, 'used by an earlier phase');
      phaseIds.add(phase.id);
      if (phase.run === 'session') {
        if (p !== 0 && p !== stage.phases.length - 1) refuse(`${here}.run`, 'a session phase stands only first or last in its stage');
        if (phase.questions !== undefined && phase.step !== 'settle') refuse(`${here}.questions`, 'only for step "settle"');
        return;
      }
      if (def.script === true) {
        if (!Object.hasOwn(ROLES, phase.agent)) refuse(`${here}.agent`, `a script starts only ${Object.keys(ROLES).join(', ')}`);
        else if ((phase.loop !== undefined || phase.with !== undefined) && ROLES[phase.agent] !== 'findings') refuse(`${here}.agent`, 'a phase with a loop or "with" returns findings: cl-workflow:verify, review or recheck');
      }
      if (phase.with !== undefined) {
        const target = phases.find((other) => other.id === phase.with && other !== phase);
        if (!target || !object[0](target.loop)) refuse(`${here}.with`, 'names a phase of the same stage that has a loop');
        if (phase.loop !== undefined) refuse(`${here}.loop`, 'a phase with "with" has no loop of its own');
      }
      if (!object[0](phase.loop) || !fields(phase.loop, `${here}.loop`, LOOP)) return;
      const fix = stage.phases.slice(0, p).find((other) => object[0](other) && other.run === 'agent' && other.id === phase.loop.fix);
      if (def.script === true && phase.loop.recheck !== undefined && ROLES[phase.loop.recheck] !== 'findings') refuse(`${here}.loop.recheck`, 'in a script names cl-workflow:verify, review or recheck');
      if (!fix) refuse(`${here}.loop.fix`, 'names an earlier agent phase of the same stage');
      else if (fix.agent === PLAN_AGENT && Number.isInteger(phase.loop.maxRounds) && phase.loop.maxRounds > MAX_PLAN_ROUNDS)
        refuse(`${here}.loop.maxRounds`, `at most ${MAX_PLAN_ROUNDS} where fix is a plan phase`);
      else if (def.script === true && !['plan', 'change'].includes(ROLES[fix.agent])) refuse(`${here}.loop.fix`, 'in a script names a cl-workflow:plan or cl-workflow:implement phase');
    });
  });
  return found;
}

// The generated files of one valid definition, as relative path to text.
function outputs(def, prefix) {
  // A project's own definition lives in .cedarloom/workflows/; the header names it wherever the generator read it from.
  const source = prefix ? `definitions/${def.name}.json by generator/generate.mjs` : `.cedarloom/workflows/${def.name}.json by cl-workflow's generator/generate.mjs`;
  const note = `Generated from ${source}${MARK}`;
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
  const scope = prefix ? `${prefix}:` : '';
  const skill = [
    '---',
    ...front,
    '---',
    `<!-- ${note} -->`,
    '',
    `# ${title}`,
    '',
    `Typed as \`/${scope}${def.name} <task>\`. No task given and none open in the conversation: ask for it, or without terminal questions stop and say it is missing.`,
    '',
    '1. Where the skill `cl-workflow:workflow` is not installed or its load is refused, say so and stop.',
    `2. Load the skill \`cl-workflow:workflow\` and run its step 1 with the kind fixed: ${kind}. ${depth} Write ${lines} before the first edit or command.`,
    ...(def.script ? scripted(def, scope) : [`3. Follow the rest of that skill and its ${kind} playbook at that depth; an item of another kind in the task runs by its own playbook.`]),
  ];
  return {
    [`skills/${def.name}/SKILL.md`]: `${skill.join('\n')}\n`,
    [`skills/${def.name}/agents/openai.yaml`]: `# ${note}\npolicy:\n  allow_implicit_invocation: false\n`,
    ...(def.script && { [`workflows/${def.name}.js`]: script(def, scope, note) }),
  };
}

// The entry's steps for a scripted workflow and its phase table.
function scripted(def, scope) {
  const run = `${scope}${def.name}-run`;
  const cell = (value) => value.replaceAll('|', '\\|').replace(/\s*\n\s*/g, ' ');
  const step = {
    settle: (phase) => `session: step 2 (Settle) of \`cl-workflow:workflow\`${phase.questions === false ? ', its questions by that skill\'s questions line' : ''}`,
    'pull-request': () => 'session: the pull request by step 3 of `cl-workflow:workflow`, with the Minor findings of the runs, then its checks watched as step 5 says',
  };
  const rule = (phase, stage) => {
    if (phase.loop) {
      const { fix, maxRounds, escalate, recheck } = phase.loop;
      return `fixed by \`${fix}\`, ${maxRounds} round${maxRounds > 1 ? 's' : ''}${escalate ? ' and one more on the stronger step' : ''}, re-checked by \`${recheck ?? phase.agent}\``;
    }
    if (phase.with) return `once, beside the first \`${phase.with}\`; its Blocking and Important findings join that loop`;
    const loop = stage.phases.find((other) => other.loop?.fix === phase.id);
    return loop ? `fixes the findings of \`${loop.id}\`` : '';
  };
  const rows = def.stages.flatMap((stage) =>
    stage.phases.map((phase) => {
      const runs = phase.run === 'session' ? step[phase.step](phase) : `\`${phase.agent}\``;
      const notes = [rule(phase, stage), phase.brief && `Brief: ${phase.brief}`].filter(Boolean).join('. ');
      return `| ${stage.id} | ${phase.id} | ${cell(runs)} | ${phase.model ?? ''} | ${phase.effort ?? (phase.run === 'agent' ? 'the agent file\'s' : '')} | ${cell(notes)} |`;
    }),
  );
  return [
    "3. Resolve the run's `args` by that skill's software change and deep playbooks: `task`, the task in one paragraph with the issue or spec reference when one exists; `overrides`, phase id to `{ model, effort, recheckModel }`, only where the rules for risky changes, a spec's Flow line, the user or the recheck rule differ from the table below (a phase run beside another and a plan check take the override of the phase they follow unless they have their own); `trial`, true for a risky change.",
    `4. Run the stages below in order: each session phase here, and the agent phases of each stage as one start of the workflow \`${run}\` through the Workflow tool, with those \`args\` and \`stage\` set to the stage's id.`,
    "   - A plan the task brought: pass its path as `planPath`; the stage that plans then only checks it, and its findings go to the plan's author as the plan check step of the playbook says. Where it carries `Plan check: passed` or names another independent check, skip that stage. After that stage, save its `plan` outside the repository, add `Plan check: passed (cl-workflow:verify)` when it is done, settle its questions, and pass the plan's path as `planPath` from then on.",
    "   - A stage that stops for failed tests: fix them by the playbook, then start the stage again with `from` set to the phase its reason names. Any other stop: run the rest of that stage as prose by the playbooks, counting the rounds the run returned; findings left after the last round are a question for the user.",
    '   - Where the Workflow tool is missing, turned off, or denied in a run without a user: run the same phases as prose by the playbooks and say so. Where the user answers No when asked to approve the run: stop.',
    '',
    '| Stage | Phase | Runs | Model | Effort | Rule |',
    '|---|---|---|---|---|---|',
    ...rows,
  ];
}

// The workflow script: the definition's constants, then the runner.
function script(def, scope, note) {
  const agents = def.stages.flatMap((stage) => stage.phases.filter((phase) => phase.run === 'agent'));
  const meta = { name: `${def.name}-run`, description: def.description, phases: agents.map((phase) => ({ title: phase.id })) };
  const flow = {
    name: def.name,
    entry: `/${scope}${def.name}`,
    trial: TRIAL,
    stages: def.stages.map((stage) => ({
      id: stage.id,
      phases: stage.phases
        .filter((phase) => phase.run === 'agent')
        .map(({ run, ...phase }) => {
          const fix = phase.loop && stage.phases.find((other) => other.id === phase.loop.fix);
          // A phase run beside another, and a check of a plan, run on the overrides of the phase they follow.
          const overrideOf = phase.with ?? (fix && ROLES[fix.agent] === 'plan' ? fix.id : undefined);
          return { ...phase, role: ROLES[phase.agent], ...(overrideOf && { overrideOf }) };
        }),
    })),
  };
  return `// ${note}\nexport const meta = ${JSON.stringify(meta, null, 2)};\n\nconst FLOW = ${JSON.stringify(flow, null, 2)};\n\n${RUNNER}`;
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
    if (!own.length) names.add(def.name), defs.push({ file, def });
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
  // A project's entry needs its own folder: written into the plugin folder it would replace the plugin's entry.
  if (!positionals.length || (values.prefix === '' ? values.out === undefined : !NAME.test(values.prefix))) {
    console.error("usage: node generator/generate.mjs <definition>... [--prefix <plugin name>|--prefix ''] [--out <folder>] [--check] [--json]   (--prefix '' needs --out)");
    return 2;
  }
  const out = resolve(values.out ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const { defs, found } = load(positionals);
  const files = defs.flatMap(({ file, def }) =>
    Object.entries(outputs(def, values.prefix)).map(([path, content]) => ({ file, path, content, current: existing(join(out, path)) })),
  );
  for (const { file, path, current } of files) if (current !== undefined && !current.includes(MARK)) found.push({ file, field: 'name', rule: `${path} exists and was not generated: pick another name` });
  if (values.json) console.log(JSON.stringify(found));
  else for (const r of found) console.error(`${r.file}: ${r.field || '(file)'}: ${r.rule}`);
  if (found.length) return 1;
  if (values.check) {
    const differ = files.filter((f) => f.current !== f.content);
    for (const { path } of differ) console.error(`${path} differs from its definition: run the generator without --check`);
    return differ.length ? 1 : 0;
  }
  for (const { path, content } of files) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), content);
  }
  return 0;
}

// A file's text, undefined when it does not exist.
function existing(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

process.exitCode = main();
