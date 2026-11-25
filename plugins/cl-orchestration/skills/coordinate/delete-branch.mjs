// Usage: node delete-branch.mjs --repo <owner/name> --pr <number> --branch <name> --project <path>, the path absolute: a checkout of the project, whose origin's default branch holds the policy.
// Step 3 of Clean up (run-files.md): deletes the pull request's branch on GitHub and in <project> only when the policy's deleteMergedBranch is true, `gh pr view` reads the pull request as MERGED with <branch> of <repo> as its head, and each ref still points at its headRefOid. A ref already gone needs nothing. Every other case keeps that ref: a moved ref, a failed read, a local branch that a worktree, a rebase or a bisect uses.
// Prints { remote, local, reasons } as JSON, remote and local each deleted, gone or kept, and exits 0 when reasons is empty, 1 when it names a kept ref or a local delete that removed another commit than the merged head, 2 for a bad argument.
import { devNull } from 'node:os';
import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { gitProgram } from '../../hooks/git-program.mjs';
import { REPO } from './approval.mjs';
import { errorLine, escaped, isMain, json, partialClone, read, settings, sh } from './policy.mjs';

const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\.)(?!.*\.lock$)(?!HEAD$)[A-Za-z0-9._/-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;

const failure = (e) => escaped((e.stderr?.toString().trim() || e.message).split('\n')[0]);
const attempt = (fn) => { try { return { out: fn() }; } catch (e) { return { error: failure(e) }; } };

// exec(cmd, args) runs gh and git(...args) runs git in the project; each gives stdout or throws. policy is the project's effective policy, or null when it could not be read, policyError then why.
export function deleteBranch({ repo, pr, branch, policy, policyError, exec, git }) {
  const keepBoth = (reason) => ({ remote: 'kept', local: 'kept', reasons: [reason] });
  if (!policy) return keepBoth(`the policy could not be read${policyError ? `: ${escaped(policyError)}` : ''}`);
  if (policy.deleteMergedBranch !== true) return keepBoth('the policy\'s deleteMergedBranch is off');
  const view = attempt(() => JSON.parse(exec('gh', ['pr', 'view', String(pr), '-R', repo, '--json', 'state,headRefName,headRefOid,isCrossRepository'])));
  if (view.error) return keepBoth(`gh pr view failed: ${view.error}`);
  const { state, headRefName, headRefOid, isCrossRepository } = view.out ?? {};
  if (state !== 'MERGED') return keepBoth(`pull request ${pr} is ${escaped(String(state))}, not MERGED`);
  if (headRefName !== branch) return keepBoth(`the head branch of pull request ${pr} is ${escaped(String(headRefName))}, not ${branch}`);
  if (!COMMIT.test(headRefOid ?? '')) return keepBoth(`pull request ${pr} names no head commit`);
  // A fork's branch is not <repo>'s branch of the same name.
  if (isCrossRepository !== false) return keepBoth(`pull request ${pr} comes from another repository`);

  const reasons = [];
  const keep = (side, reason) => { reasons.push(`${side}: ${reason}`); return 'kept'; };

  // matching-refs answers an empty list for a missing ref, so only a failed read fails; it matches by prefix, so the exact name is picked out.
  const remote = (() => {
    const refs = attempt(() => JSON.parse(exec('gh', ['api', `repos/${repo}/git/matching-refs/heads/${branch}`])));
    if (refs.error) return keep('remote', `the ref could not be read: ${refs.error}`);
    if (!Array.isArray(refs.out)) return keep('remote', 'the ref could not be read: no list');
    const sha = refs.out.find((r) => r?.ref === `refs/heads/${branch}`)?.object?.sha;
    if (sha === undefined) return 'gone';
    if (sha !== headRefOid) return keep('remote', `the ref moved to ${escaped(String(sha))}`);
    // A commit pushed between this read and the delete goes with the branch: the REST delete takes no expected value. GraphQL updateRefs with beforeOid could make it conditional (untried).
    const deleted = attempt(() => exec('gh', ['api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`]));
    return deleted.error ? keep('remote', `the delete failed: ${deleted.error}`) : 'deleted';
  })();

  const local = (() => {
    const ref = `refs/heads/${branch}`;
    // for-each-ref also lists refs below the name, so the exact name is picked out; an empty list is a branch already gone.
    const listed = attempt(() => git('for-each-ref', '--format=%(refname) %(objectname)', ref));
    if (listed.error) return keep('local', `the branch could not be read: ${listed.error}`);
    const sha = listed.out.split('\n').find((line) => line.startsWith(`${ref} `))?.slice(ref.length + 1);
    if (sha === undefined) return 'gone';
    if (sha !== headRefOid) return keep('local', `the branch moved to ${escaped(sha)}`);
    // branch -D refuses a branch that a worktree has checked out or that a rebase or bisect uses, and deletes a symbolic ref, never its target. -D, as a squash merge leaves the branch unmerged for git; a commit made between the read and the delete goes with the branch.
    const deleted = attempt(() => git('branch', '-D', '--', branch));
    if (deleted.error) return keep('local', `the delete failed: ${deleted.error}`);
    // git ends its line with what it removed, `(was <abbreviated commit>).`, or the target of a symbolic ref; another commit than the merged head is the one to restore.
    const was = /(\S+)\)\.?$/m.exec(deleted.out)?.[1] ?? '';
    if (!was.startsWith('refs/') && !(/^[0-9a-f]{4,}$/.test(was) && headRefOid.startsWith(was))) reasons.push(`local: the deleted branch held another commit than ${headRefOid}: ${escaped(deleted.out.trim().split('\n')[0])}`);
    return 'deleted';
  })();

  return { remote, local, reasons };
}

const FLAGS = { repo: { type: 'string' }, pr: { type: 'string' }, branch: { type: 'string' }, project: { type: 'string' } };

export function optionsOf(argv) {
  const { values } = parseArgs({ args: argv, options: FLAGS, strict: true });
  for (const k of Object.keys(FLAGS)) if (values[k] === undefined) throw new Error(`usage: --${k} is missing`);
  if (!REPO.test(values.repo)) throw new Error('usage: --repo must be owner/name');
  if (!/^[1-9]\d*$/.test(values.pr)) throw new Error('usage: --pr must be a pull request number');
  if (!BRANCH.test(values.branch)) throw new Error('usage: --branch is no plain branch name');
  if (!isAbsolute(values.project)) throw new Error('usage: --project must be an absolute path');
  return { repo: values.repo, pr: Number(values.pr), branch: values.branch, project: values.project };
}

// git in the project with no hook, no fsmonitor and no lazy fetch, which a worker sharing this git directory could have configured, and in the C locale, as the delete's output is parsed. core.hooksPath does not reach a hook that git config defines (git 2.54), so each hook.<name> is turned off as well.
export function hookFreeGit(project, program = gitProgram()) {
  if (!program) throw new Error('git is in no absolute folder of PATH');
  const run = (...args) => sh(project, program, ['--no-replace-objects', '-C', project, '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', ...args], undefined, { LC_ALL: 'C' });
  return (...args) => {
    // Listed before each call: the config can change between two of them. A promisor or a hook written after this listing is the known window (GIT_NO_LAZY_FETCH in policy.mjs): only the variable holds then.
    const listed = settings(run('config', '--show-scope', '-z', '--list'));
    if (partialClone(listed)) throw new Error('git config names a promisor remote or a partial clone filter, whose lazy fetch can run a command');
    const hooks = [...new Set(listed.map(([, key]) => /^hook\.(.+)\.[^.]+$/is.exec(key)?.[1]).filter((name) => name !== undefined))];
    // -c splits at the first =, so such a name could not be turned off.
    if (hooks.some((name) => name.includes('='))) throw new Error('git config defines a hook whose name holds =, which -c cannot turn off');
    return run(...hooks.flatMap((name) => ['-c', `hook.${name}.enabled=false`]), ...args);
  };
}

if (isMain(import.meta.url)) {
  let options;
  try { options = optionsOf(process.argv.slice(2)); } catch (e) {
    console.error(escaped(e.message.split('\n')[0]));
    process.exitCode = 2;
  }
  if (options) {
    try {
      const { project } = options;
      const { policy, errors } = read(project);
      const result = deleteBranch({ ...options, policy, policyError: errors.map(errorLine).join('; '), exec: (cmd, args) => sh(project, cmd, args), git: hookFreeGit(project) });
      console.log(json(result));
      process.exitCode = result.reasons.length ? 1 : 0;
    } catch (e) {
      console.error(escaped(e.message.split('\n')[0]));
      process.exitCode = 1;
    }
  }
}
