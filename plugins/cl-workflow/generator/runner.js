// The runner each generated workflow script carries inline after its constants `meta` and `FLOW`: one stage per run, its rounds held in code.
// Globals of a workflow script: agent, parallel, args. A stage returns { status, reason, plan?, findings, minor, rounds, phases, result? }.

// The stronger step: the model one up, at the top an effort below high to high; xhigh never.
const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const text = { type: 'string' };
const texts = { type: 'array', items: text };
const object = (properties, required) => ({ type: 'object', properties, required });
const finding = object(
  { class: { enum: ['Blocking', 'Important', 'Minor'] }, text, file: text, line: { type: 'integer' }, evidence: text },
  ['class', 'text', 'evidence'],
);
const SCHEMA = {
  plan: object({ plan: text, questions: texts }, ['plan', 'questions']),
  change: object({ status: { enum: ['done', 'stuck'] }, report: text }, ['status', 'report']),
  test: object({ status: { enum: ['pass', 'fail'] }, failures: texts, keyLines: texts }, ['status', 'failures', 'keyLines']),
  findings: object({ findings: { type: 'array', items: finding } }, ['findings']),
  trial: object(
    { verdicts: { type: 'array', items: object({ finding: { type: 'integer' }, verdict: { enum: ['confirmed', 'disputed'] }, evidence: text }, ['finding', 'verdict', 'evidence']) } },
    ['verdicts'],
  ),
};

// Ends the stage; `findings` are the open Blocking and Important ones, `result` an agent result no rule covers.
class Stop {
  constructor(reason, findings = [], result) {
    Object.assign(this, { reason, findings, result });
  }
}

const input = args ?? {};
const stage = FLOW.stages.find((s) => s.id === input.stage);
const run = { phases: [], minor: [], rounds: 0, plan: undefined };
const end = (status, reason, findings = [], result) => ({
  status,
  reason,
  ...(run.plan && { plan: run.plan }),
  findings,
  minor: run.minor,
  rounds: run.rounds,
  phases: run.phases,
  ...(result !== undefined && { result }),
});

// The phase's model and effort: the session's override for it (or for the phase it follows), else the constants.
function resolved(phase) {
  const override = input.overrides?.[phase.id] ?? (phase.overrideOf && input.overrides?.[phase.overrideOf]) ?? {};
  return { model: override.model ?? phase.model, effort: override.effort ?? phase.effort, recheckModel: override.recheckModel };
}

function stronger({ model, effort }) {
  const at = MODELS.indexOf(model);
  if (at === -1) return undefined;
  if (at < MODELS.length - 1) return { model: MODELS[at + 1], effort };
  // An effort nobody set is the agent file's: high.
  if (EFFORTS.indexOf(effort ?? 'high') < EFFORTS.indexOf('high')) return { model, effort: 'high' };
}

const context = (...more) =>
  [
    `Workflow ${FLOW.name}, stage ${stage.id}.`,
    `Task: ${input.task}`,
    input.planPath && `Plan file: ${input.planPath}`,
    run.plan && `Plan:\n${run.plan.plan}`,
    ...more,
  ]
    .filter(Boolean)
    .join('\n\n');

// Keeps Minor findings for the pull request and returns the Blocking and Important ones.
function open(findings) {
  run.minor.push(...findings.filter((f) => f.class === 'Minor'));
  return findings.filter((f) => f.class !== 'Minor');
}

async function call(label, group, agentType, role, prompt, { model, effort }) {
  run.phases.push(label);
  const options = { label, phase: group, agentType, schema: SCHEMA[role] };
  if (model !== 'inherit') options.model = model;
  if (effort) options.effort = effort;
  let result;
  try {
    result = await agent(prompt, options);
  } catch (error) {
    throw new Stop(`${label} failed: ${error?.message ?? error}`);
  }
  if (result == null) throw new Stop(`${label} returned no result`);
  return result;
}

// An implement call: stuck once reruns one step above this call, stuck again or no step left ends the stage.
async function change(phase, label, prompt, step, findings) {
  const first = await call(label, phase.id, phase.agent, 'change', prompt, step);
  if (first.status !== 'stuck') return first;
  const up = stronger(step);
  if (!up) throw new Stop(`${label} reported stuck with no stronger step left`, findings, first);
  const again = await call(`${label} rerun`, phase.id, phase.agent, 'change', prompt, up);
  if (again.status !== 'stuck') return again;
  throw new Stop(`${label} reported stuck twice`, findings, again);
}

async function loop(phase) {
  const fixer = stage.phases.find((p) => p.id === phase.loop.fix);
  const own = resolved(phase);
  const first = [phase, ...stage.phases.filter((p) => p.with === phase.id)];
  // parallel() turns a throw into null, so a Stop travels as a value.
  const results = await parallel(
    first.map((p) => () => call(p.id, phase.id, p.agent, 'findings', context(p.brief), resolved(p)).catch((stop) => stop)),
  );
  const failed = results.find((r) => r == null || r instanceof Stop);
  if (failed !== undefined) throw failed ?? new Stop(`${phase.id} returned no result`);
  let found = open(results.flatMap((r) => r.findings));
  if (found.length && fixer.role === 'plan' && input.planPath) throw new Stop(`${phase.id} findings go to the author of the plan file`, found);
  const limit = phase.loop.maxRounds + (phase.loop.escalate ? 1 : 0);
  for (let round = 1; found.length; round++) {
    if (round > limit) throw new Stop(`${phase.id} findings remain after round ${round - 1}: a question for the user`, found);
    const step = round > phase.loop.maxRounds ? stronger(resolved(fixer)) : resolved(fixer);
    if (!step) throw new Stop(`${phase.id} findings remain after round ${round - 1} and no stronger step is left: a question for the user`, found);
    run.rounds++;
    // Disputed findings go unfixed, with their evidence, to the re-review.
    const dispute = new Map();
    if (input.trial && round === 1 && fixer.role === 'change') {
      const prompt = context('Trial before the first fix: mark each finding below confirmed or disputed, with evidence; `finding` is its position in the list, from 0.', JSON.stringify(found));
      for (const v of (await call('trial', phase.id, FLOW.trial.agent, 'trial', prompt, FLOW.trial)).verdicts) if (v.verdict === 'disputed') dispute.set(v.finding, v.evidence);
    }
    const confirmed = found.filter((_, i) => !dispute.has(i));
    const disputed = found.flatMap((f, i) => (dispute.has(i) ? [{ ...f, dispute: dispute.get(i) }] : []));
    const label = `${fixer.id} round ${round}`;
    let report = '';
    if (confirmed.length && fixer.role === 'plan') {
      run.plan = await call(label, phase.id, fixer.agent, 'plan', context(`Revise the plan for these ${phase.id} findings and return the whole plan:`, JSON.stringify(confirmed)), step);
    } else if (confirmed.length) {
      const prompt = context(`Remediation of round ${round}: check each finding first, fix the ones that hold, and answer one you disprove with evidence instead of a change.`, JSON.stringify(confirmed));
      report = (await change(fixer, label, prompt, step, found)).report;
    }
    const recheck = phase.loop.recheck
      ? { agent: phase.loop.recheck, step: { model: own.recheckModel ?? (own.model === 'fable' ? 'opus' : own.model) } }
      : { agent: phase.agent, step: own.recheckModel ? { model: own.recheckModel } : own };
    const prompt = context(
      `Re-review of round ${round}: read only what changed since the last check and these findings; keep or drop each disputed one by its evidence.`,
      report && `Remediation report:\n${report}`,
      JSON.stringify([...confirmed, ...disputed]),
    );
    found = open((await call(`${phase.id} recheck ${round}`, phase.id, recheck.agent, 'findings', prompt, recheck.step)).findings);
  }
}

async function phaseRun(phase) {
  if (phase.loop) return loop(phase);
  if (phase.role === 'plan') {
    if (!input.planPath) run.plan = await call(phase.id, phase.id, phase.agent, 'plan', context(phase.brief), resolved(phase));
  } else if (phase.role === 'change') {
    await change(phase, phase.id, context(phase.brief), resolved(phase), []);
  } else if (phase.role === 'test') {
    const result = await call(phase.id, phase.id, phase.agent, 'test', context(phase.brief), resolved(phase));
    if (result.status !== 'pass') throw new Stop(`${phase.id} failed: fix the failures by the playbook, then start the stage again with from "${phase.id}"`, [], result);
  } else {
    const found = open((await call(phase.id, phase.id, phase.agent, 'findings', context(phase.brief), resolved(phase))).findings);
    if (found.length) throw new Stop(`${phase.id} has findings`, found);
  }
}

async function stageRun() {
  if (!stage) return end('stopped', `args.stage must be one of ${FLOW.stages.map((s) => s.id).join(', ')}: start this workflow from its entry, ${FLOW.entry} <task>`);
  // A restart after failed tests; a restart inside the loop would reset its round count.
  const loopAt = stage.phases.findIndex((p) => p.loop);
  const before = loopAt === -1 ? stage.phases : stage.phases.slice(0, loopAt);
  const from = input.from === undefined ? 0 : before.findIndex((p) => p.id === input.from);
  if (from === -1) return end('stopped', `from must name a phase of stage ${stage.id} before its loop phase: ${before.map((p) => p.id).join(', ') || 'none'}`);
  try {
    for (const phase of stage.phases.slice(from)) if (!phase.with) await phaseRun(phase);
  } catch (stop) {
    if (!(stop instanceof Stop)) throw stop;
    return end('stopped', stop.reason, stop.findings, stop.result);
  }
  return end('done', `stage ${stage.id} passed`);
}

return await stageRun();
