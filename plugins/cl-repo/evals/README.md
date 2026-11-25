# cl-repo evals

These suites check that each `cl-repo` skill does what its text says, on small scaffolded repositories, with `claude plugin eval`. Layout, tool grants, graders, cost and the before and after table follow the [cl-workflow evals](https://github.com/CedarLoom/cedarloom/blob/main/plugins/cl-workflow/evals/README.md); here every case is tagged `cl-repo` and `skill-<name>`, and named `skill-<name>-<case>`. Every case needs `--scaffold`.

| Suite | Cases | Gated tools its cases list |
|---|---|---|
| `skill-audit` | planted duplicate, wrong default and dead link with the tree unchanged; two instruction files that contradict; a clean target | `Bash` |
| `skill-debloat` | whole-line cuts with the Never rule kept; a budget only protected text could meet; a reword request | `Bash`, `Write` |
| `skill-improve` | one diff per finding; a Never rule stays a flag; a description keeps its trigger sentences | `Edit`, `Write`, `Bash` |
| `skill-maintain` | grouped dependency updates; a stale knowledge entry re-checked; a fresh one reused | `Bash` |
| `skill-setup` | read-only plan on a bare repository (block, `AGENTS.md`, policy file, missing labels); no cl-orchestration; an `AGENTS.md` without the block; a policy at `docs/agents/orchestration.json` moved to `cedarloom.json` | `Bash` |

## Run

From the repository root, signed in to Claude Code:

```sh
# one suite
claude plugin eval plugins/cl-repo --model opus --allow-tools Bash Edit Write --tag skill-audit --scaffold --no-publish --runs 3 --json skill-audit.json
# every suite
claude plugin eval plugins/cl-repo --model opus --allow-tools Bash Edit Write --scaffold --no-publish --runs 3 --max-cost-usd 20 --json cl-repo.json
```

The same command with `--tag skill-debloat`, `skill-improve`, `skill-maintain` or `skill-setup` runs the other suites. Each case still gets only the gated tools its `allowed_tools` lists. Both sides of a comparison, and the baseline below, use the same `--model` and `--judge-model`.

## Rules block

The rules block ([rules/project.md](../rules/project.md)) has no skill to trigger, and an eval run loads no project `AGENTS.md`, so it is checked by a hand-run script instead. `bash plugins/cl-repo/evals/rules-block/run.sh [runs] [model]` (defaults: 3 runs, `opus`) builds a fixture repository whose `AGENTS.md` holds the block ([fixture.sh](rules-block/fixture.sh)), gives one headless `claude -p` session a small refactor there per run, and checks the result ([check.sh](rules-block/check.sh)): the task done, the code it made unused removed, dead code outside the task reported but left alone, no em dash and no catch-all file name. Each run loads your user settings and plugins, so compare runs made with the same setup.

## Baseline

Runs at commit `51b561c45ee850757c5b7c3db6ca09c4ab9c88d4` (the suites as they merged), model `claude-opus-5-5` at the default effort, judge `haiku` (default), `--runs 3`, with the no-plugin arm (`with-without`).

| Suite | Pass rate | Tokens | Wall time | Cost |
|---|---|---|---|---|
| `skill-audit` | 8/9 (89%) | 1.26M | 10m56s | $2.24 |
| `skill-debloat` | 9/9 (100%) | 0.89M | 11m08s | $1.58 |
| `skill-improve` | 5/9 (56%) | 0.54M | 8m55s | $1.24 |
| `skill-maintain` | 8/9 (89%) | 1.04M | 9m14s | $1.71 |
| `skill-setup` | 5/9 (56%) | 1.78M | 15m45s | $3.02 |
| rules block (`run.sh`) | 2/3 runs passed every check (one run changed dead code outside the task) | not reported | 3m31s | not reported |

Pass rate counts each run. Tokens are the sum of input, cache creation, cache read and output tokens over every model in `modelUsage` of each run's final `result` event. Wall time and cost count the with-plugin runs (cost = `costUsd` + `judgeCostUsd`).

Run total: 35/45 runs (78%), 15.94 USD both arms, 56 min (2 in parallel).
