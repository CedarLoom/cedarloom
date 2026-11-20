// The catch-up precheck, `node precheck.mjs --catch-up <clone> [--state <folder>]`: the backstop of a project bot that starts a run when an event that should have started one was lost, within the daily limits (state.mjs LIMITS).
// Exit 0 starts the run and exit 1 starts none, as Orca reads a precheck. One JSON line { start, condition, reason, probe }: condition is the first condition below that holds (1 to 7), 'probe', 'failed' (a read failed or the 90-second limit neared: the run reports it), or null for no run; probe is true while no catch-up run started in the current UTC day, so the run takes the daily automatic-start probe.
// <clone> is the bot's checkout of the repository, <folder> the state folder (default: state in the working folder); the local question queue is read in the working folder. It writes nothing but the policy reader's ref in <clone>.
// The conditions, in this order; from 4 on a pull request whose state is held or merged counts for none, and from 1 on one that had LIMITS.prRuns runs today:
// 1. The merge lock is stale, or a pull request state holds a merge command time and the merge log no line for it.
// 2. The default branch's tip has a red run and red-main.json names no report for that tip.
// 3. An owner answered an open cl:needs-human issue, or a local question that answered.json does not list.
// 4. A pull request is merge-ready: its state's handled names its head with the verdict merge or trial (merge-checks.mjs) and a reviewed head, its checks are green or the repository runs none, the lock is free, and the tip's watch ended (10 minutes from tip.json's first sight, no run open) or red-main.json names the red tip and that pull request.
// 5. A bot pull request's head is red or in conflict and handled does not name that head.
// 6. A bot pull request's head is green, or the repository runs no CI, neither handled nor the reviewed head names that head, and no claim-<n>-<head> folder is younger than stallMinutes.
// 7. An entry of a pull request state's dispatches or runs has no result and its result file exists (a headless job ended) or it started more than stallMinutes ago.
// A bot pull request is open, not from a fork, on a head branch <type>/<n>-<slug>, and issue n has a trusted author (precheck.mjs).
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { answer, readQueue } from './approval.mjs';
import { redRuns } from './merge.mjs';
import { errorLine, json, read, sh } from './policy.mjs';
import { originRepo, trusts, writers } from './precheck.mjs';
import { count, inspectLock, isPrFile, LIMITS, logged, readState, RED_MAIN, TIP } from './state.mjs';

const MINUTE = 60_000;
// Orca's --precheck-timeout is set above this, so the precheck answers before Orca skips the run.
const LIMIT = 90_000;
const MARGIN = 5_000;
const WATCH_MIN = 10 * MINUTE;
const BOT_BRANCH = /^[a-z]+\/([1-9]\d*)-./;
const GOOD = ['SUCCESS', 'SKIPPED', 'NEUTRAL'];

// 'none', 'red', 'pending' or 'green' of a statusCheckRollup: check runs carry status and conclusion, commit statuses a state.
function checks(rollup) {
  if (!rollup?.length) return 'none';
  const done = (c) => (c.status === undefined ? !['PENDING', 'EXPECTED'].includes(c.state) : c.status === 'COMPLETED');
  if (rollup.some((c) => done(c) && !GOOD.includes(c.conclusion ?? c.state))) return 'red';
  return rollup.every(done) ? 'green' : 'pending';
}

// { condition, reason } of the first condition that holds, or null. run(cwd, cmd, args) gives stdout or throws; queue() lists the local questions as approval.mjs queue does.
function pending({ clone, state, now, run, queue, counts }) {
  const ageOf = (at) => now.getTime() - Date.parse(at);
  const lock = inspectLock(state, now);
  if (lock?.stale) return { condition: 1, reason: 'the merge lock is stale' };

  const states = new Map();
  for (const file of readdirSync(state).filter(isPrFile)) {
    const s = readState(join(state, file));
    // A state that cannot be read is rebuilt by the run.
    if (s?.pr !== Number(file.slice(3, -5))) throw new Error(`${file} is unreadable`);
    states.set(s.pr, s);
  }
  const spent = (n) => (counts.prs[n] ?? 0) >= LIMITS.prRuns;
  for (const s of states.values()) if (!spent(s.pr) && s.mergeCommandAt && !logged(state, s.repo, s.pr)) return { condition: 1, reason: `the merge of #${s.pr} is not confirmed` };

  const { policy, errors } = read(clone, run);
  if (!policy) throw new Error(errors.map(errorLine).join('; '));
  const repo = originRepo(clone, run);
  const gh = (...args) => JSON.parse(run(clone, 'gh', args));
  const branch = gh('repo', 'view', repo, '--json', 'defaultBranchRef').defaultBranchRef.name;
  const tip = gh('api', `repos/${repo}/branches/${branch}`).commit.sha;
  const onTip = gh('run', 'list', '-R', repo, '--branch', branch, '--commit', tip, '--limit', '100', '--json', 'databaseId,headSha,status,conclusion,workflowDatabaseId,createdAt');
  const red = redRuns(onTip).length > 0, redMain = readState(join(state, RED_MAIN));
  if (red && !(redMain?.sha === tip && redMain.report)) return { condition: 2, reason: `the default branch is red at ${tip} and has no report` };

  const writes = writers(repo, (cmd, args) => run(clone, cmd, args));
  const asked = gh('issue', 'list', '-R', repo, '--label', 'cl:needs-human', '--state', 'open', '--limit', '1000', '--json', 'number,labels,comments,author,body,url');
  const answered = asked.find((issue) => answer(issue, writes));
  if (answered) return { condition: 3, reason: `#${answered.number} has an answer` };
  const acted = new Set(readState(join(state, 'answered.json')) ?? []);
  for (const q of queue()) {
    if (q.error) throw new Error(`the question ${q.file} ${q.error}`);
    if (q.status === 'answered' && !acted.has(`${q.file} ${q.at}`)) return { condition: 3, reason: `the question ${q.file} has an answer` };
  }

  const prs = gh('pr', 'list', '-R', repo, '--state', 'open', '--limit', '1000', '--json', 'number,headRefName,headRefOid,isCrossRepository,mergeable,statusCheckRollup')
    .sort((a, b) => a.number - b.number);
  // A repository whose tip ran nothing runs no CI.
  const passes = (pr) => checks(pr.statusCheckRollup) === 'green' || (checks(pr.statusCheckRollup) === 'none' && !onTip.length);
  const open = prs.filter((pr) => !spent(pr.number) && !states.get(pr.number)?.held && !states.get(pr.number)?.mergedAt);
  const seen = readState(join(state, TIP));
  const watched = red ? null : !(seen?.sha === tip && ageOf(seen.firstSeen) < WATCH_MIN) && onTip.every((r) => r.status === 'completed');
  for (const pr of open) {
    const s = states.get(pr.number);
    const ready = ['merge', 'trial'].includes(s?.handled?.action) && s.handled.head === pr.headRefOid && s.reviewedHead && passes(pr);
    if (ready && !lock && (red ? redMain?.sha === tip && redMain.pr === pr.number : watched)) return { condition: 4, reason: `#${pr.number} is merge-ready` };
  }

  const trusted = trusts(policy, writes);
  const bot = (pr) => {
    const n = BOT_BRANCH.exec(pr.headRefName)?.[1];
    return !pr.isCrossRepository && n !== undefined && trusted(gh('api', `repos/${repo}/issues/${n}`));
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

  for (const s of states.values()) {
    if (spent(s.pr) || s.held || s.mergedAt) continue;
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
  try {
    const counts = count(state, now);
    if (counts.runs >= LIMITS.runs) return { start: false, condition: null, reason: `the daily limit of ${LIMITS.runs} runs is reached`, probe: false };
    if (counts.workerStarts >= LIMITS.workerStarts) return { start: false, condition: null, reason: `the daily limit of ${LIMITS.workerStarts} worker starts is reached`, probe: false };
    const probe = counts.catchUp === 0;
    const found = pending({ clone, state, now, run: timed, queue, counts });
    if (found) return { start: true, ...found, probe };
    return probe ? { start: true, condition: 'probe', reason: 'no catch-up run started today', probe } : { start: false, condition: null, reason: 'nothing pending', probe };
  } catch (e) {
    return { start: true, condition: 'failed', reason: String(e.stderr || e.message).trim().split('\n')[0], probe: false };
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
