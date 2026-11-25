// The catch-up precheck, `node precheck.mjs --catch-up <clone> [--state <folder>]`: the backstop of a project bot that starts a run when an event that should have started one was lost, within the daily limits (state.mjs LIMITS).
// Exit 0 starts the run and exit 1 starts none, as Orca reads a precheck. One JSON line { start, condition, reason, probe }: condition is the first condition below that holds (1 to 7), 'probe', 'failed' (a read failed or the 90-second limit neared: the run reports it), or null for no run; probe is true while no catch-up run started in the current UTC day, so the run takes the daily automatic-start probe.
// <clone> is the bot's checkout of the repository, <folder> the state folder (default: state in the working folder); the local question queue is read in the working folder. It writes nothing but the policy reader's ref in <clone>.
// The conditions, in this order; from 4 on only an open pull request whose state is neither held nor merged counts, and from 1 on none that had LIMITS.prRuns runs today:
// 1. The merge lock is stale, or, while no merge holds the lock, a pull request state that is not held holds a merge command time and the merge log no line for it.
// 2. The default branch's tip has a red run, or red-main.json names the tip, and red-main.json names no report for that tip.
// 3. An owner answer that answered.json does not list: on an open issue that carries cl:needs-human, or a trusted author's issue updated in the last ANSWER_DAYS days whose answer has the full form, as #<n> <at>, or on a local question, as <file> <at>.
// 4. A pull request is merge-ready: its state's handled names its head with the verdict merge or trial (merge-checks.mjs) and a reviewed head, its checks are green, or it has none and merge.requiredChecks is empty, the lock is free, no merge command is unconfirmed or held (merge.mjs pauses every merge then), and the tip's watch ended (10 minutes from tip.json's first sight, no run open) or red-main.json names the red tip and that pull request.
// 5. A bot pull request's head is red or in conflict and handled does not name that head.
// 6. A bot pull request's head is green, or has no checks and merge.requiredChecks is empty, neither handled nor the reviewed head names that head, and no claim-<n>-<head> folder is younger than stallMinutes.
// 7. An entry of a pull request state's dispatches or runs has no result and its result file exists (a headless job ended) or it started more than stallMinutes ago.
// A bot pull request is open, not from a fork, on a head branch <type>/<n>-<slug>, and issue n exists, is no pull request and has a trusted author (precheck.mjs).
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { answer, readQueue } from './approval.mjs';
import { redRuns, unconfirmed } from './merge.mjs';
import { errorLine, json, read, sh } from './policy.mjs';
import { asks, originRepo, trusts, writers } from './precheck.mjs';
import { count, inspectLock, isPrFile, LIMITS, logged, RED_MAIN, TIP } from './state.mjs';

const MINUTE = 60_000;
// Orca's --precheck-timeout is set above this, so the precheck answers before Orca skips the run.
const LIMIT = 90_000;
const MARGIN = 5_000;
const WATCH_MIN = 10 * MINUTE;
// An answer on an issue without cl:needs-human that no sweep read within this many days is left to the owner.
const ANSWER_DAYS = 7;
const BOT_BRANCH = /^[a-z]+\/([1-9]\d*)-./;
const GOOD = ['SUCCESS', 'SKIPPED', 'NEUTRAL'];

// 'none', 'red', 'pending' or 'green' of a statusCheckRollup: check runs carry status and conclusion, commit statuses a state.
// The rollup lists every run of a check; as gh pr checks does, only the newest of each (by name and workflow, or a status's context) counts.
function checks(rollup) {
  const newest = new Map();
  for (const c of rollup ?? []) {
    const key = c.context ?? `${c.name}\n${c.workflowName}`;
    if (!newest.has(key) || newest.get(key).startedAt < c.startedAt) newest.set(key, c);
  }
  const latest = [...newest.values()];
  if (!latest.length) return 'none';
  const done = (c) => (c.status === undefined ? !['PENDING', 'EXPECTED'].includes(c.state) : c.status === 'COMPLETED');
  if (latest.some((c) => done(c) && !GOOD.includes(c.conclusion ?? c.state))) return 'red';
  return latest.every(done) ? 'green' : 'pending';
}

// { condition, reason } of the first condition that holds, or null. run(cwd, cmd, args) gives stdout or throws; queue() lists the local questions as approval.mjs queue does.
function pending({ clone, state, now, run, queue, counts }) {
  const ageOf = (at) => now.getTime() - Date.parse(at);
  const lock = inspectLock(state, now);
  if (lock?.stale) return { condition: 1, reason: 'the merge lock is stale' };

  // A missing file is absent; one that cannot be read or parsed fails the precheck, so the run reports or rebuilds it.
  const stored = (name) => { try { return JSON.parse(readFileSync(join(state, name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw new Error(`${name} is unreadable`); } };
  const states = new Map();
  for (const file of readdirSync(state).filter(isPrFile)) {
    const s = stored(file);
    if (s?.pr !== Number(file.slice(3, -5))) throw new Error(`${file} is unreadable`);
    states.set(s.pr, s);
  }
  const spent = (n) => (counts.prs[n] ?? 0) >= LIMITS.prRuns;
  // A lock still here is live: the merge that holds it confirms its own command. A held state is the owner's to clear.
  for (const s of states.values()) if (!lock && !s.held && !spent(s.pr) && s.mergeCommandAt && !logged(state, s.repo, s.pr)) return { condition: 1, reason: `the merge of #${s.pr} is not confirmed` };

  const { policy, errors } = read(clone, run);
  if (!policy) throw new Error(errors.map(errorLine).join('; '));
  const repo = originRepo(clone, run);
  const gh = (...args) => JSON.parse(run(clone, 'gh', args));
  const branch = gh('repo', 'view', repo, '--json', 'defaultBranchRef').defaultBranchRef.name;
  const tip = gh('api', `repos/${repo}/branches/${branch}`).commit.sha;
  const onTip = gh('run', 'list', '-R', repo, '--branch', branch, '--commit', tip, '--limit', '100', '--json', 'databaseId,headSha,status,conclusion,workflowDatabaseId,createdAt');
  const redMain = stored(RED_MAIN);
  // A report for the tip counts as red: merge.mjs's watch also reads red runs on the commits since the last passed tip. A red run that ran again and passed keeps the tip red here until the tip moves or the report is answered, an accepted wait.
  const red = redRuns(onTip).length > 0 || redMain?.sha === tip;
  if (red && !(redMain?.sha === tip && redMain.report)) return { condition: 2, reason: `the default branch is red at ${tip} and has no report` };

  const writes = writers(repo, (cmd, args) => run(clone, cmd, args));
  const acted = new Set(stored('answered.json') ?? []);
  // An answer through the questions skill takes cl:needs-human off at once, so the open issues updated in the answer window are read too.
  const since = new Date(now.getTime() - ANSWER_DAYS * 24 * 60 * MINUTE).toISOString().slice(0, 10);
  const listed = (...filter) => gh('issue', 'list', '-R', repo, ...filter, '--state', 'open', '--limit', '1000', '--json', 'number,labels,comments,author,body,url');
  const asker = asks(policy, writes);
  // Only triage rights set the label: without it, an issue counts as a question only when a trusted author wrote it and the answer has the questions skill's full form.
  const full = (issue, at) => issue.comments.some((c) => c.createdAt === at && c.body?.startsWith('Owner answer ('));
  const labeled = listed('--label', 'cl:needs-human');
  for (const issue of [...labeled, ...listed('--search', `updated:>=${since}`)]) {
    const found = answer(issue, writes);
    if (found && !labeled.includes(issue) && !(full(issue, found.at) && asker(issue))) continue;
    // An answer without a time has no key: it fails the precheck, which reports it, rather than start a run on every pass.
    if (found && !Number.isFinite(Date.parse(found.at))) throw new Error(`the answer on #${issue.number} has no time`);
    if (found && !acted.has(`#${issue.number} ${found.at}`)) return { condition: 3, reason: `#${issue.number} has an answer` };
  }
  for (const q of queue()) {
    if (q.error) throw new Error(`the question ${q.file} ${q.error}`);
    if (q.status === 'answered' && !acted.has(`${q.file} ${q.at}`)) return { condition: 3, reason: `the question ${q.file} has an answer` };
  }

  const prs = gh('pr', 'list', '-R', repo, '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,headRefOid,isCrossRepository,mergeable,statusCheckRollup')
    .sort((a, b) => a.number - b.number);
  // A head without checks passes while no check is required (review.md, Review); the run itself waits for checks that appear late.
  const passes = (pr) => checks(pr.statusCheckRollup) === 'green' || (checks(pr.statusCheckRollup) === 'none' && !policy.merge.requiredChecks.length);
  const open = prs.filter((pr) => !spent(pr.number) && !states.get(pr.number)?.held && !states.get(pr.number)?.mergedAt);
  const seen = stored(TIP);
  const paused = [...states.values()].some((s) => unconfirmed(state, s));
  const watched = red ? null : !(seen?.sha === tip && ageOf(seen.firstSeen) < WATCH_MIN) && onTip.every((r) => r.status === 'completed');
  for (const pr of open) {
    const s = states.get(pr.number);
    const ready = ['merge', 'trial'].includes(s?.handled?.action) && s.handled.head === pr.headRefOid && s.reviewedHead && passes(pr);
    if (ready && !lock && !paused && (red ? redMain?.sha === tip && redMain.pr === pr.number : watched)) return { condition: 4, reason: `#${pr.number} is merge-ready` };
  }

  const trusted = trusts(policy, writes);
  // A branch named after an issue that does not exist, was deleted, or is a pull request is no bot pull request.
  const issue = (n) => { try { return gh('api', `repos/${repo}/issues/${n}`); } catch (e) { if (/\(HTTP 4(04|10)\)/.test(e.stderr)) return null; throw e; } };
  const bot = (pr) => {
    const n = BOT_BRANCH.exec(pr.headRefName)?.[1];
    if (pr.isCrossRepository || n === undefined) return false;
    const found = issue(n);
    return found !== null && !found.pull_request && trusted(found);
  };
  const handled = (pr) => states.get(pr.number)?.handled?.head === pr.headRefOid;
  for (const pr of open) {
    if (!handled(pr) && (checks(pr.statusCheckRollup) === 'red' || pr.mergeable === 'CONFLICTING') && bot(pr)) return { condition: 5, reason: `#${pr.number} is red or in conflict at ${pr.headRefOid}` };
  }
  const stall = policy.stallMinutes * MINUTE;
  const claimed = (pr) => { try { return ageOf(new Date(lstatSync(join(state, `claim-${pr.number}-${pr.headRefOid}`)).mtimeMs)) < stall; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
  for (const pr of open) {
    if (!handled(pr) && states.get(pr.number)?.reviewedHead !== pr.headRefOid && passes(pr) && !claimed(pr) && bot(pr)) return { condition: 6, reason: `#${pr.number} has no review for ${pr.headRefOid}` };
  }

  for (const s of open.map((pr) => states.get(pr.number)).filter(Boolean)) {
    // A start time that cannot be read counts as past the stall limit.
    const stalled = [...(s.dispatches ?? []), ...(s.runs ?? [])].find((e) => !e.result && ((e.resultFile && existsSync(e.resultFile)) || !(ageOf(e.startedAt) <= stall)));
    if (stalled) return { condition: 7, reason: `a dispatch or run of #${s.pr} has no result` };
  }
  return null;
}

// { start, condition, reason, probe } for state and clone at now; run(cwd, cmd, args, timeout) gives stdout or throws, clock() gives milliseconds.
export function catchUp({ clone, state, now = new Date(), run = sh, queue = readQueue, clock = Date.now }) {
  const deadline = clock() + LIMIT - MARGIN;
  const timed = (cwd, cmd, args) => {
    const left = deadline - clock();
    if (left <= 0) throw new Error('the 90-second limit nears');
    return run(cwd, cmd, args, left);
  };
  let probe = false;
  try {
    const counts = count(state, now);
    if (counts.runs >= LIMITS.runs) return { start: false, condition: null, reason: `the daily limit of ${LIMITS.runs} runs is reached`, probe };
    if (counts.workerStarts >= LIMITS.workerStarts) return { start: false, condition: null, reason: `the daily limit of ${LIMITS.workerStarts} worker starts is reached`, probe };
    probe = counts.catchUp === 0;
    const found = pending({ clone, state, now, run: timed, queue, counts });
    if (found) return { start: true, ...found, probe };
    if (probe) return { start: true, condition: 'probe', reason: 'no catch-up run started today', probe };
    // A pull request at its limit is named, so its skip does not read as an idle project.
    const spent = Object.keys(counts.prs).filter((n) => counts.prs[n] >= LIMITS.prRuns);
    return { start: false, condition: null, reason: spent.length ? `nothing pending; at the daily limit of ${LIMITS.prRuns} runs: #${spent.join(', #')}` : 'nothing pending', probe };
  } catch (e) {
    return { start: true, condition: 'failed', reason: String(e.stderr || e.message).trim().split('\n')[0], probe };
  }
}

// { line, code } of the command line's arguments after --catch-up. A bad argument starts the run too, which reports it.
export function catchUpLine(argv, options = {}) {
  let result;
  try {
    const { values, positionals } = parseArgs({ args: argv, options: { state: { type: 'string', default: 'state' } }, allowPositionals: true });
    if (positionals.length !== 1) throw new Error('usage: node precheck.mjs --catch-up <clone> [--state <folder>]');
    result = catchUp({ clone: resolve(positionals[0]), state: resolve(values.state), ...options });
  } catch (e) {
    result = { start: true, condition: 'failed', reason: e.message.split('\n')[0], probe: false };
  }
  return { line: json(result), code: result.start ? 0 : 1 };
}
