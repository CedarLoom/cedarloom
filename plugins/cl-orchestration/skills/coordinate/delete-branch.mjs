// Usage: node delete-branch.mjs --repo <owner/name> --pr <number> --branch <name> --project <path>, the path absolute: a checkout of the project, whose origin's default branch holds the policy.
// Step 3 of Clean up (SKILL.md): deletes the pull request's branch on GitHub and in <project> only when the policy's deleteMergedBranch is true, `gh pr view` reads the pull request as MERGED with <branch> as its head, and each ref still points at its headRefOid. A ref already gone needs nothing. Every other case keeps that ref: a moved ref, a failed read, a local branch that a worktree, a rebase or a bisect uses.
// Prints { remote, local, reasons } as JSON, remote and local each deleted, gone or kept, and exits 0 when neither is kept, 1 when one is (reasons names why), 2 for a bad argument.
import { devNull } from 'node:os';
import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { gitProgram } from '../../hooks/git-program.mjs';
import { REPO } from './approval.mjs';
import { escaped, isMain, json, read, settings, sh } from './policy.mjs';

const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\.)(?!.*\.lock$)(?!HEAD$)[A-Za-z0-9._/-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;

const failure = (e) => escaped((e.stderr?.toString().trim() || e.message).split('\n')[0]);
const attempt = (fn) => { try { return { out: fn() }; } catch (e) { return { error: failure(e) }; } };

// exec(cmd, args) runs gh and git(...args) runs git in the project; each gives stdout or throws. policy is the project's effective policy, or null when it could not be read.
export function deleteBranch({ repo, pr, branch, policy, exec, git }) {
  const keepBoth = (reason) => ({ remote: 'kept', local: 'kept', reasons: [reason] });
  if (!policy) return keepBoth('the policy could not be read');
  if (policy.deleteMergedBranch !== true) return keepBoth('the policy\'s deleteMergedBranch is off');
  const view = attempt(() => JSON.parse(exec('gh', ['pr', 'view', String(pr), '-R', repo, '--json', 'state,headRefName,headRefOid'])));
  if (view.error) return keepBoth(`gh pr view failed: ${view.error}`);
  const { state, headRefName, headRefOid } = view.out ?? {};
  if (state !== 'MERGED') return keepBoth(`pull request ${pr} is ${escaped(String(state))}, not MERGED`);
  if (headRefName !== branch) return keepBoth(`the head branch of pull request ${pr} is ${escaped(String(headRefName))}, not ${branch}`);
  if (!COMMIT.test(headRefOid ?? '')) return keepBoth(`pull request ${pr} names no head commit`);

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
    // A commit pushed between this read and the delete goes with the branch: GitHub's delete takes no expected value.
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
    return deleted.error ? keep('local', `the delete failed: ${deleted.error}`) : 'deleted';
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

// git in the project with no hook and no fsmonitor, which a worker sharing this git directory could have written. core.hooksPath does not reach a hook that git config defines (git 2.54), so each hook.<name> is turned off as well.
export function hookFreeGit(project, program = gitProgram()) {
  if (!program) throw new Error('git is in no absolute folder of PATH');
  const run = (...args) => sh(project, program, ['--no-replace-objects', '-C', project, '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false', ...args]);
  return (...args) => {
    // Listed before each call: the config can change between two of them.
    const hooks = [...new Set(settings(run('config', '--show-scope', '-z', '--list')).map(([, key]) => /^hook\.(.+)\.[^.]+$/is.exec(key)?.[1]).filter((name) => name !== undefined))];
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
      const result = deleteBranch({ ...options, policy: read(project).policy, exec: (cmd, args) => sh(project, cmd, args), git: hookFreeGit(project) });
      console.log(json(result));
      process.exitCode = result.remote === 'kept' || result.local === 'kept' ? 1 : 0;
    } catch (e) {
      console.error(escaped(e.message.split('\n')[0]));
      process.exitCode = 1;
    }
  }
}
