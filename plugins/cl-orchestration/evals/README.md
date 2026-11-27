# cl-orchestration evals

These suites check that the `coordinate` skill does what its text says, on small scaffolded projects, with `claude plugin eval`. A fake `orca` and a fake `gh` stand in for Orca and GitHub, so no case starts a worker, reaches a terminal or changes a repository. Layout, graders, cost and the before and after table follow the [cl-workflow evals](https://github.com/CedarLoom/cedarloom/blob/main/plugins/cl-workflow/evals/README.md): the tool grant per case, and both sides of a comparison run on the head's case files.

## Layout

| Path | Holds |
|---|---|
| `skills/coordinate/<area>/<case>/case.yaml` | one case: the prompt, the limits and the graders |
| `skills/coordinate/<area>/<case>/setup.sh` | the scaffold: the project the bot works on and the fakes' answers |
| `bin/orca`, `bin/gh` | the fakes, run by [`test/fake-orca.mjs`](../test/fake-orca.mjs) |

- One suite per area, tagged `coord-<area>`; every case is also tagged `cl-orchestration`, and named `coord-<area>-<case>`.
- Each case starts the skill with `/cl-orchestration:coordinate <project path>`, which loads it, then has the session take `SOUL.md` and one procedure file (`bot-project.md`, `bot-catch-up.md`, `bot-upkeep.md` or `bot-reviewer.md`) as an automation's prompt does, and cites the public issue or pull request it comes from in its `description`, or says it is constructed and names the rule's file and line.
- A case that only checks a decision states the facts in its prompt, grants no gated tool and ends with a stop line ("write the lines ..., then stop"). A case that checks the commands the session runs lists `Bash` and grades the fakes' call logs.
- `coord-review-code-review-scratch` shows whether `/code-review` reviews a scratch clone diff read only through `git -C` (review.md, The commands): its `Code review:` line says whether `/code-review` read the diff or the reviewer fell back to its own pass.

## The fakes

`bin/orca` and `bin/gh` run `test/fake-orca.mjs`, which finds the nearest `.fake/` folder from its working folder up. It answers an argv listed exactly in `.fake/<program>.json` (`[[args, stdout, exit code]...]`), fails any other with `not faked: <program> <args>` and exit 1, and logs every call to `.fake/<program>-calls.jsonl` as `{"cwd":...,"args":[...]}`. Every scaffold creates both logs empty, so a `not_contains` grader on a log reads a file even when nothing was called. A grader asserts an exact argv with a `regex` on that log, through `target: { source: file, path: .fake/orca-calls.jsonl }`, for example `"args":\["worktree","create","--name","12-login-timeout"`.

A run puts `bin/` first on `PATH`, which the scaffold and the child session inherit. Every scaffold first checks that `orca` and `gh` on `PATH` are these fakes and fails otherwise, so a run without the `PATH` entry scores 0 and calls neither the real Orca nor the real GitHub.

## Run

From the repository root, signed in to Claude Code:

```sh
# one suite
PATH="$PWD/plugins/cl-orchestration/evals/bin:$PATH" claude plugin eval plugins/cl-orchestration --allow-tools Bash Edit Write --tag coord-start --scaffold --no-publish --runs 3 --json coord-start.json
# everything
PATH="$PWD/plugins/cl-orchestration/evals/bin:$PATH" claude plugin eval plugins/cl-orchestration --allow-tools Bash Edit Write --scaffold --no-publish --runs 3 --max-cost-usd 40 --json coord-all.json
```

Every case needs `--scaffold`. `--allow-tools` grants the gated tools for the whole run, and each case still gets only the ones its `allowed_tools` lists. Granted `Bash` runs in Claude Code's OS sandbox ([Sandboxing](https://code.claude.com/docs/en/sandboxing)).

## Baseline

The first complete run of every suite on `main`, `--runs 3`, with the model, the judge and the commit named here. Pass rate is passing runs over all runs; tokens, wall time and cost are the run's sums.

Model: `claude-opus-5-5`. Judge: `haiku` (default). Commit: `3d94dbc9`.

The run had the no-plugin arm (`with-without`). Pass rate, tokens, wall time and cost per suite count the with-plugin runs only, and Pass rate without plugin is the no-plugin arm's passing runs over its runs. The All row's tokens count the with-plugin runs only, and its wall time (the run's, 2 suites in parallel) and cost cover both arms. Tokens are the sum of `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens` and `outputTokens` over the `modelUsage` of each run's final `result` event; cost is `costUsd` plus `judgeCostUsd`. One run of `coord-review-sensitive-level` timed out after 300 s and counts as failing; its trace has no `result` event, so it adds no tokens.

| Suite | Cases | Pass rate | Pass rate without plugin | Tokens | Wall time | Cost |
|---|---|---|---|---|---|---|
| `coord-start` | 3 | 1/9 (11%) | 0/9 | 0.65M | 16m39s | $1.36 |
| `coord-watch` | 3 | 3/9 (33%) | 3/9 | 0.37M | 7m21s | $1.06 |
| `coord-host-limit` | 3 | 8/9 (89%) | 7/9 | 0.16M | 6m38s | $0.87 |
| `coord-follow-up` | 3 | 5/9 (56%) | 4/9 | 0.20M | 4m33s | $0.91 |
| `coord-clean-up` | 3 | 0/9 (0%) | 0/9 | 0.59M | 4m14s | $1.25 |
| `coord-commit` | 3 | 6/9 (67%) | 6/9 | 0.16M | 1m43s | $0.87 |
| `coord-checks` | 3 | 3/9 (33%) | 3/9 | 0.20M | 2m29s | $0.89 |
| `coord-bots` | 3 | 0/9 (0%) | 0/9 | 0.33M | 4m01s | $1.05 |
| `coord-pick` | 3 | 6/9 (67%) | 6/9 | 0.16M | 2m45s | $0.83 |
| `coord-merge` | 3 | 0/9 (0%) | 0/9 | 0.67M | 3m43s | $1.25 |
| `coord-review` | 3 | 2/9 (22%) | 0/9 | 0.69M | 23m03s | $1.38 |
| `coord-trial` | 3 | 2/9 (22%) | 0/9 | 0.55M | 7m16s | $1.33 |
| `coord-untrusted` | 3 | 0/9 (0%) | 1/9 | 0.59M | 8m42s | $1.19 |
| `coord-dialog` | 3 | 3/9 (33%) | 3/9 | 0.19M | 1m35s | $0.88 |
| `coord-resume` | 3 | 1/9 (11%) | 0/9 | 0.38M | 5m23s | $1.07 |
| `coord-approvals` | 3 | 4/9 (44%) | 3/9 | 0.40M | 9m37s | $1.21 |
| `coord-policy` | 3 | 2/9 (22%) | 2/9 | 0.38M | 2m58s | $1.04 |
| `coord-reconcile` | 3 | 3/9 (33%) | 3/9 | 0.34M | 4m23s | $1.02 |
| `coord-outcomes` | 3 | 0/9 (0%) | 0/9 | 0.51M | 3m18s | $1.09 |
| `coord-worker-rules` | 3 | 1/9 (11%) | 0/9 | 0.34M | 5m20s | $1.08 |
| `coord-digest` | 3 | 2/9 (22%) | 3/9 | 0.42M | 2m23s | $1.10 |
| All | 63 | 52/189 (28%) | 44/189 | 8.27M | 2h11m48s (run, 2 in parallel) | $43.43 (both arms) |
