# Development

## Workflows

- `checks.yml` runs `checks-core`, `plugin-checks` and `plugin-tests` in parallel; the job `checks` gates all three. `plugin-tests` runs the tests in `plugins/*/test/` with Node.js alone (no install, no app) on Linux and macOS. While the repository is private the macOS leg runs on pushes to `main` only; once it is public, on pull requests too.
- `token-budget.yml` runs on pull requests that change the files agents load (`include` in `.github/token-budget.json`: instruction files, plugin skills, agents and rules, README.md, `docs/agents/`; other docs are not measured): it measures the estimated tokens of the base and the head with `plugins/cl-repo/skills/debloat/token-budget.mjs`, writes the change into the pull request description between `<!-- token-budget -->` and `<!-- /token-budget -->` (after the ELI5 section, else at the top; pull requests from this repository only) and fails only when the head is above the budget in `.github/token-budget.json` (`budget.total`, `budget.alwaysLoaded` for the text every session loads, `budget.files`) or that budget cannot be applied (an unknown key, a value that is no number, an always-loaded file outside `include`). `checks-core` runs the same budget check, which makes it binding; lost protected text and dead links are warnings there. After a pull request that moves the total on purpose, `node plugins/cl-repo/skills/debloat/token-budget.mjs baseline --write` stores the new counts.
- Every workflow has `permissions: {}` at the top and per job, `timeout-minutes` on every job and a `concurrency` group that cancels superseded pull request runs.
- Every required check runs on pull requests into `main` and on pushes to `main`, except `conventional` (the pull request title) and `dependency-review`, which run on pull requests only.
- Every job runs only in `CedarLoom/cedarloom` (`if: github.repository == 'CedarLoom/cedarloom'`), so a fork or a copy runs none. `dependency-review` also skips while the repository is private, CodeQL and Scorecard while it is not public.
- The checks `checks`, `conventional` and `dependency-review` are the ones to keep green. A job change keeps these names: a branch rule requires a check by its name, and a required check that no job reports stays pending and blocks the merge.
- `checks-core` runs:
  - `actionlint` and `zizmor` (a checkout keeps its credentials only with a `zizmor: ignore[artipacked]` reason).
  - No em dash or emoji in text files (lockfiles, PNG files and changelogs apart).
  - No `2.1.x` version other than `2.1.330`, the Claude Code minimum in the README's Requirements, written into the step (other version lines pass; changelogs, tests, package manifests, lockfiles, workflows and the `plugin-checks` pin apart).
  - The `.github/scripts/` tests and checks (skill lint with the word budgets of [Authoring](authoring.md), plugin boundary, generated docs, version pins).
  - The token budget (`token-budget.mjs check --budget-only`).
- The plugin boundary check (`.github/scripts/plugin-boundary.mjs`) fails when a tracked file under `plugins/*/` (the generated `CHANGELOG.md` apart):
  - holds a path that leaves its plugin folder (a `../` path resolved from the file's folder, `${CLAUDE_PLUGIN_ROOT}/..`),
  - imports a package that is neither a `node:` module nor `claude-code`,
  - has a hook matcher in `hooks/*.json` whose `^<prefix>:` is not the plugin's name in `.claude-plugin/plugin.json`,
  - breaks rule `orca-only-orchestration`: the name `orca` as a word or inside an identifier (cases: `plugin-boundary.test.mjs`) fails in every plugin folder but `plugins/cl-orchestration`, which runs only on Orca, and `plugins/cedarloom`, the bundle that installs it; `cl-workflow` and `cl-repo` work without Orca.
- Actions are pinned to commit SHAs with a version comment. Dependabot (`.github/dependabot.yml`) updates the `uses:` pins weekly.

## Evals

Each plugin keeps its `claude plugin eval` suites in `plugins/<plugin>/evals/`, run locally on your own credential, not in CI. A pull request that changes a skill or agent text reruns the suites it affects on its merge base and its head, both with the head's case files, and compares only runs that completed every case: pass rate (passing runs over all runs), tokens, wall time and cost ([cl-workflow evals](../plugins/cl-workflow/evals/README.md), [cl-repo evals](../plugins/cl-repo/evals/README.md), [cl-orchestration evals](../plugins/cl-orchestration/evals/README.md), which run against a fake `orca` and `gh`). A lower pass rate on an affected suite blocks the merge until the case is fixed, or the drop is explained in the pull request and accepted in its review. A change to the cl-repo rules block reruns its hand-run script the same way ([Rules block](../plugins/cl-repo/evals/README.md#rules-block)), since an eval run loads no project `AGENTS.md`.
