// Usage: node merge.mjs <state file> --run <run id> [--method squash|merge|rebase]. The only place a project bot runs gh pr merge. The bot first takes the judgment steps of Merge (review-and-merge.md, steps 1 to 5.2) and records the head and verdict it accepted in the state file's handled; this script then merges that pull request or says why not, in one JSON line { outcome, reason }:
// merged; wait (the lock is busy, the watch of the default branch runs, or another pull request waits for its checks after an update: a later sweep retries); redMain (the default branch is red and the answered report names another pull request or none); restart (the head, the verdict, the trial base or the threads changed: the judgment steps run again); stop (the owner's, exit 1 when an error stopped it, exit 2 for a bad argument).
// <state file> is <bot home>/state/pr-<n>.json (state.mjs). The squash or merge commit's subject and body come from pr-<n>-subject.txt and pr-<n>-body.md beside it (step 5.1). <bot home>/pre-merge.json, if present, names a command that gets the pull request's text on stdin and must exit 0: { "command": [<program>, <args>...] }.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { REPO } from './approval.mjs';
import { escaped, isMain, json, sh } from './policy.mjs';
import { appendLog, inspectLock, isPrFile, logged, readState, RED_MAIN, removeLock, takeLock, TIP, writeState } from './state.mjs';
import { unresolvedThreads } from './thread.mjs';

const MINUTE = 60_000;
// The watch: a tip younger than this holds the next merge, also where no CI runs (review-and-merge.md, step 6).
const WATCH_MIN = 10 * MINUTE;
// An expected workflow with no run on the tip by then counts as not run (step 6.5); the order rule waits as long for an updated branch's checks.
const WAIT_MAX = 30 * MINUTE;
const CONFIRM_MAX = 2 * MINUTE;
const POLL = 5_000;
const METHODS = ['squash', 'merge', 'rebase'];
const ACTIONS = ['merge', 'trial'];
const GREEN = ['success', 'skipped', 'neutral'];
const COMMIT = /^[0-9a-f]{40}$/;
const BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const REVIEW_URL = /^https:\/\/\S+$/;
const RUN_ID =/^[A-Za-z0-9._:-]{1,128}$/;
const CHECKS = fileURLToPath(new URL('./merge-checks.mjs', import.meta.url));

const firstLine = (text) => escaped(String(text ?? '').trim().split('\n')[0] ?? '');
const answer = (outcome) => (reason) => ({ outcome, reason });
const [wait, redMain, restart, stop] = ['wait', 'redMain', 'restart', 'stop'].map(answer);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const ageOf = (now, at) => now.getTime() - Date.parse(at);

// The newest run of each workflow, taken from the newest commit that has one: a workflow that failed on an earlier commit and passed on a later one is green again, one that failed and ran no more stays red.
function latestRuns(runs, newestFirst) {
  const latest = new Map();
  for (const sha of newestFirst) {
    for (const r of runs.filter((x) => x.headSha === sha)) if (!latest.has(r.workflowDatabaseId)) latest.set(r.workflowDatabaseId, r);
  }
  return [...latest.values()];
}

const isRed = (r) => r.status === 'completed' && !GREEN.includes(r.conclusion);
const replaces = (x, r) => r.conclusion === 'cancelled' && x.workflowDatabaseId === r.workflowDatabaseId && x.createdAt > r.createdAt;
// The red runs among the runs of one commit, of every event: each red run counts, whatever came after it; a cancelled one is replaced by a newer run of its workflow (steps 6.6 and 6.7).
export const redRuns = (onCommit) => onCommit.filter((r) => isRed(r) && !onCommit.some((x) => replaces(x, r)));

// A check that has not finished, or no check yet: the runs of a pushed update appear some time after the push.
const pending = (rollup) => !rollup?.length || rollup.some((c) => (c.status !== undefined && c.status !== 'COMPLETED') || ['PENDING', 'EXPECTED'].includes(c.state));

// The watch of the default branch, read from GitHub (review-and-merge.md, step 6). null when it passed, else the answer.
function watch({ gh, repo, n, branch, state, now }) {
  for (const file of readdirSync(state).filter(isPrFile)) {
    const other = readState(join(state, file));
    // A state that cannot be read could hide a merge command nobody confirmed.
    if (!other) return { answer: wait(`${file} is unreadable`) };
    if (other.mergeCommandAt && (other.held || !logged(state, other.repo, other.pr))) return { answer: wait(`the merge of #${other.pr} is not confirmed`) };
  }
  const tip = JSON.parse(gh('api', `repos/${repo}/branches/${branch}`)).commit.sha;
  if (!COMMIT.test(tip)) throw new Error('GitHub gave no commit for the default branch');
  let seen = readState(join(state, TIP));
  // The last passed tip goes into an API path.
  if ((seen?.passed ?? null) !== null && !COMMIT.test(seen.passed)) throw new Error(`${TIP} holds no commit as the last passed tip`);
  if (seen?.sha !== tip || Number.isNaN(Date.parse(seen.firstSeen))) {
    seen = { sha: tip, firstSeen: now.toISOString(), passed: seen?.passed ?? null };
    writeState(join(state, TIP), seen);
  }
  const list = (...filter) => JSON.parse(gh('run', 'list', '-R', repo, '--branch', branch, ...filter, '--limit', '100', '--json', 'databaseId,headSha,status,conclusion,workflowDatabaseId,createdAt'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Push runs give the expected workflows (step 6.3) and the commits since the last passed tip; the tip's own runs of every event give red and not completed (steps 6.4 to 6.7).
  const runs = list('--event', 'push');
  const onTipAll = list('--commit', tip);
  const since = seen.passed && seen.passed !== tip ? JSON.parse(gh('api', `repos/${repo}/compare/${seen.passed}...${tip}`)).commits.map((c) => c.sha).reverse() : [];
  const red = [
    ...redRuns(onTipAll),
    ...latestRuns(runs, [tip, ...since.filter((sha) => sha !== tip)]).filter((r) => r.headSha !== tip && isRed(r)),
  ];
  if (red.length) {
    const report = readState(join(state, RED_MAIN));
    if (report?.sha !== tip || report?.pr !== n) return { answer: redMain(`the default branch is red at ${tip}${report?.sha === tip ? `; its report names #${report.pr ?? 'none'}` : ''}`) };
  }
  const age = ageOf(now, seen.firstSeen);
  if (age < WATCH_MIN) return { answer: wait(`the tip ${tip} is younger than 10 minutes`) };
  const onTip = runs.filter((r) => r.headSha === tip);
  // A run of another event (a schedule, workflow_run) holds the merge as long as an expected workflow without a run does, no longer; one that replaces a cancelled push run holds it as a push run does (step 6.6).
  const open = (r) => r.status !== 'completed';
  if (onTip.some(open) || onTipAll.some((x) => open(x) && (age < WAIT_MAX || onTip.some((r) => replaces(x, r))))) return { answer: wait(`a run on the tip ${tip} has not completed`) };
  // The expected workflows are those of the commit with runs before the tip, its first parent as a rule (step 6.3).
  const before = runs.find((r) => r.headSha !== tip)?.headSha;
  const missing = new Set(runs.filter((r) => r.headSha === before).map((r) => r.workflowDatabaseId).filter((id) => !onTip.some((r) => r.workflowDatabaseId === id)));
  if (missing.size && age < WAIT_MAX) return { answer: wait(`${missing.size} expected workflow(s) have no run on the tip ${tip} yet`) };
  // A red tip the answered report names passes for that pull request only, so it is not marked as passed.
  if (!red.length && seen.passed !== tip) writeState(join(state, TIP), { ...seen, passed: tip });
  return { tip, passed: red.length ? seen.passed : tip };
}

// While a pull request the bot updated waits for its checks, the next merge would put it behind again.
function order({ gh, repo, n, state, now }) {
  for (const file of readdirSync(state).filter(isPrFile)) {
    const other = readState(join(state, file));
    if (!other || other.pr === n || other.repo !== repo || other.mergedAt || !(ageOf(now, other.updatedAt) < WAIT_MAX)) continue;
    const pr = JSON.parse(gh('pr', 'view', String(other.pr), '-R', repo, '--json', 'state,statusCheckRollup'));
    if (pr.state === 'OPEN' && pending(pr.statusCheckRollup)) return wait(`#${other.pr} waits for its checks after an update`);
  }
  return null;
}

// What the pre-merge command reads: the pull request's text, every commit message, then the commit the merge writes.
const premergeInput = (pr, subject, body) => [pr.title, pr.body, pr.headRefName, `${pr.headRepositoryOwner?.login}/${pr.headRefName}`, ...(pr.commits ?? []).map((c) => `${c.messageHeadline}\n${c.messageBody}`), subject, body].join('\n\n');

// The pre-merge command gets these variables only: it needs no token of the bot's.
const premergeEnv = () => Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));

// null when it passed or none is configured, else the reason. An unreadable or malformed configuration refuses: a check the owner set up never drops out unseen.
function premerge(home, pr, subject, body) {
  let config;
  try { config = readFileSync(join(home, 'pre-merge.json'), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; return 'pre-merge.json is unreadable'; }
  let command;
  try { ({ command } = JSON.parse(config)); } catch { return 'pre-merge.json is no JSON'; }
  // By its file, never a bare name: Windows looks for one in the working folder first (docs/agents/git-and-processes.md).
  if (!Array.isArray(command) || !command.length || !command.every((a) => typeof a === 'string' && a) || !isAbsolute(command[0])) return 'pre-merge.json names no program by its absolute path';
  // gh pr view lists the last 100 commits only: a longer pull request could hide a message the command never reads.
  if ((pr.commits?.length ?? 0) >= 100) return 'the pull request has more commits than the pre-merge command is shown';
  const r = spawnSync(command[0], command.slice(1), { cwd: home, env: premergeEnv(), input: premergeInput(pr, subject, body), encoding: 'utf8', stdio: ['pipe', 'ignore', 'ignore'], timeout: CONFIRM_MAX, killSignal: 'SIGKILL', windowsHide: true });
  if (r.error) return `the pre-merge command did not run: ${r.error.code ?? r.error.message}`;
  return r.status === 0 ? null : `the pre-merge command refused the merge (exit ${r.status ?? r.signal})`;
}

function locked({ stateFile, method, runId, run, now, sleep }) {
  const state = dirname(stateFile), home = dirname(state);
  const s = readState(stateFile);
  const n = s?.pr, repo = s?.repo;
  if (!s || !REPO.test(repo ?? '')) return stop(`${basename(stateFile)} is no readable pull request state`);
  if (s.held) return stop(`held: ${s.held}`);
  const accepted = s.handled?.head;
  if (!COMMIT.test(accepted ?? '') || !ACTIONS.includes(s.handled?.action) || !COMMIT.test(s.reviewedHead ?? '')) return stop('the state holds no accepted head with a merge or trial verdict');
  const scratch = s.clones?.at(-1);
  if (typeof scratch !== 'string' || typeof s.project !== 'string') return stop('the state names no project or scratch clone');
  // The merge log keeps one line per merge.
  if ((s.reviewUrl ?? null) !== null && !REVIEW_URL.test(s.reviewUrl)) return stop('the state names no review URL without whitespace');
  const gh = (...args) => run(home, 'gh', args);
  const git = (...args) => run(scratch, 'git', ['-c', 'core.fsmonitor=false', ...args]);

  const pr = JSON.parse(gh('pr', 'view', String(n), '-R', repo, '--json', 'state,headRefOid,baseRefName,isCrossRepository,title,body,headRefName,headRepositoryOwner,commits'));
  const branch = JSON.parse(gh('repo', 'view', repo, '--json', 'defaultBranchRef')).defaultBranchRef.name;
  if (!BRANCH.test(branch)) return stop('the default branch has no plain name');
  if (pr.state !== 'OPEN') return stop(`the pull request is ${pr.state}`);
  if (pr.isCrossRepository) return stop('the pull request comes from a fork');
  if (pr.baseRefName !== branch) return stop(`the pull request's base is not ${branch}`);

  const t = now();
  const watched = watch({ gh, repo, n, branch, state, now: t });
  if (watched.answer) return watched.answer;
  const ordered = order({ gh, repo, n, state, now: t });
  if (ordered) return ordered;

  if (pr.headRefOid !== accepted) return restart(`the head is ${pr.headRefOid}, not the accepted ${accepted}`);
  // In a folder that is no clone of its own, git answers from the repository above it.
  if (git('rev-parse', '--git-dir').trim() !== '.git') return stop('the scratch clone is not the top folder of a clone of its own');
  git('fetch', '--quiet', 'origin');
  // The verdict judges the fetched default branch: a push since the watch read the tip has had no watch.
  const base = git('rev-parse', '--verify', `refs/remotes/origin/${branch}`).trim();
  if (base !== watched.tip) return wait(`the default branch moved to ${base} after its watch was read`);
  let verdict;
  try {
    verdict = JSON.parse(run(home, process.execPath, [CHECKS, s.project, scratch, branch, s.reviewedHead, accepted, s.riskClass]));
  } catch (e) {
    return stop(`no verdict: ${firstLine(e.stderr || e.message)}`);
  }
  if (verdict.next === 'owner' || verdict.next === 'ready') return stop(`the verdict is ${verdict.next}`);
  if (verdict.next !== s.handled.action) return restart(`the verdict is ${verdict.next}, not ${s.handled.action}`);
  if (verdict.next === 'trial' && base !== s.trialBase) return restart('the default branch moved since the trial merge');
  const threads = unresolvedThreads(home, repo, n, run).length;
  if (threads) return restart(`${threads} review thread(s) are unresolved`);

  let subject = '', bodyFile = null, body = '';
  if (method !== 'rebase') {
    bodyFile = join(state, `pr-${n}-body.md`);
    try {
      subject = readFileSync(join(state, `pr-${n}-subject.txt`), 'utf8').replace(/\r?\n$/, '');
      body = readFileSync(bodyFile, 'utf8');
    } catch (e) {
      return stop(`no subject or body file: ${e.code}`);
    }
    if (!subject || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(subject)) return stop('the subject file holds no single line');
  }
  const refused = premerge(home, pr, subject, body);
  if (refused) return stop(refused);

  // The bot or the owner may have written the state during the checks: a hold or another accepted head written since wins.
  const fresh = readState(stateFile);
  if (fresh?.held) return stop(`held: ${fresh.held}`);
  if (fresh?.handled?.head !== accepted || fresh?.handled?.action !== s.handled.action) return restart('the state changed during the checks');
  const commanded = { ...fresh, mergeCommandAt: now().toISOString() };
  writeState(stateFile, commanded);
  // Pinned to the accepted head; never --admin, which passes branch protection, nor --auto, which would merge a later push.
  const args = ['pr', 'merge', String(n), '-R', repo, `--${method}`, '--match-head-commit', accepted];
  if (bodyFile) args.push('--subject', subject, '--body-file', bodyFile);
  let failed = null;
  try { gh(...args); } catch (e) { failed = firstLine(e.stderr || e.message); }

  // A state that became unreadable keeps the merge command time, so later merges still pause.
  const current = () => readState(stateFile) ?? commanded;
  const held = (why) => { writeState(stateFile, { ...current(), held: why }); return stop(why); };
  let merged;
  try {
    const deadline = now().getTime() + CONFIRM_MAX;
    for (;;) {
      merged = JSON.parse(gh('pr', 'view', String(n), '-R', repo, '--json', 'state,mergeCommit,mergedAt,headRefOid,autoMergeRequest'));
      if (merged.state === 'MERGED') break;
      if (merged.autoMergeRequest) {
        gh('pr', 'merge', String(n), '-R', repo, '--disable-auto');
        return held('the merge command turned on auto-merge');
      }
      // GitHub refused the command because the head moved: that push gets its re-review (step 5), and nothing is left to confirm.
      if (failed && merged.state === 'OPEN' && COMMIT.test(merged.headRefOid ?? '') && merged.headRefOid !== accepted) {
        const { mergeCommandAt, ...rest } = current();
        writeState(stateFile, rest);
        return restart(`the head moved to ${merged.headRefOid} and GitHub refused the merge: ${failed}`);
      }
      if (failed || merged.state !== 'OPEN' || now().getTime() >= deadline) return held(`the merge is not confirmed${failed ? `: ${failed}` : ''}`);
      sleep(POLL);
    }
  } catch (e) {
    // After the command, any error leaves the merge unconfirmed: held, so the owner sees it and no later merge runs on a guess.
    return held(`the merge is not confirmed: ${firstLine(e.stderr || e.message)}`);
  }
  const unreviewed = merged.headRefOid !== accepted;
  appendLog(state, `- ${merged.mergedAt} ${repo} #${n} reviewed ${s.reviewedHead} merged ${merged.headRefOid} commit ${merged.mergeCommit?.oid} review ${s.reviewUrl ?? 'none'} run ${runId}${unreviewed ? ' unreviewed head' : ''}`);
  writeState(stateFile, { ...current(), mergedAt: merged.mergedAt, ...(unreviewed ? { held: 'unreviewed head' } : {}) });
  if (COMMIT.test(merged.mergeCommit?.oid ?? '')) writeState(join(state, TIP), { sha: merged.mergeCommit.oid, firstSeen: merged.mergedAt, passed: watched.passed });
  return unreviewed ? stop(`a head nobody reviewed merged: ${merged.headRefOid}`) : { outcome: 'merged', reason: `merged ${accepted} as ${merged.mergeCommit?.oid}` };
}

// The answer for the pull request of stateFile; runId names the bot's run in the merge log. run(cwd, cmd, args) gives stdout or throws; now() and sleep(ms) are the clock.
export function merge(stateFile, { method = 'squash', runId }, { run = sh, now = () => new Date(), sleep = pause } = {}) {
  const file = resolve(stateFile), state = dirname(file);
  const s = readState(file);
  if (!isPrFile(basename(file)) || s?.pr !== Number(basename(file).slice(3, -5))) return stop(`${basename(file)} is no readable pull request state`);
  const holding = { pr: s.pr, head: s.handled?.head ?? null };
  let holder = takeLock(state, holding, now());
  if (!holder) {
    const lock = inspectLock(state, now());
    if (lock && !lock.stale) return wait('the merge lock is held');
    // A lock its run left behind is removed only while it is still the one read, then taken once more.
    if (lock) removeLock(state, lock.raw);
    holder = takeLock(state, holding, now());
    if (!holder) return wait('the merge lock is held');
  }
  let result;
  try {
    result = locked({ stateFile: file, method, runId, run, now, sleep });
  } catch (e) {
    result = { ...stop(firstLine(e.stderr || e.message)), error: true };
  }
  // A failed release never hides what happened before it, a merge least of all.
  try {
    if (!removeLock(state, holder)) result = { ...result, reason: `${result.reason}; the lock was no longer this run's` };
  } catch (e) {
    result = { ...result, reason: `${result.reason}; the lock was not released: ${firstLine(e.message)}` };
  }
  return result;
}

if (isMain(import.meta.url)) {
  const usage = 'usage: node merge.mjs <state file> --run <run id> [--method squash|merge|rebase]';
  let file, method, runId;
  try {
    const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { method: { type: 'string', default: 'squash' }, run: { type: 'string' } }, allowPositionals: true });
    if (positionals.length !== 1 || !METHODS.includes(values.method) || !RUN_ID.test(values.run ?? '')) throw new Error(usage);
    [file] = positionals;
    ({ method, run: runId } = values);
  } catch (e) {
    console.log(json(stop(firstLine(e.message))));
    process.exit(2);
  }
  try {
    const { error, ...result } = merge(file, { method, runId });
    console.log(json(result));
    if (error) process.exitCode = 1;
  } catch (e) {
    console.log(json(stop(firstLine(e.message))));
    process.exitCode = 1;
  }
}
