# cl-orchestration evals

These suites check that the `coordinate` skill does what its text says, on small scaffolded projects, with `claude plugin eval`. A fake `orca` and a fake `gh` stand in for Orca and GitHub, so no case starts a worker, reaches a terminal or changes a repository. Layout, graders, cost and the before and after table follow the [cl-workflow evals](https://github.com/CedarLoom/cedarloom/blob/main/plugins/cl-workflow/evals/README.md): the tool grant per case, and both sides of a comparison run on the head's case files.

## Layout

| Path | Holds |
|---|---|
| `skills/coordinate/<area>/<case>/case.yaml` | one case: the prompt, the limits and the graders |
| `skills/coordinate/<area>/<case>/setup.sh` | the scaffold: the project the coordinator works on and the fakes' answers |
| `bin/orca`, `bin/gh` | the fakes, run by [`test/fake-orca.mjs`](../test/fake-orca.mjs) |

- One suite per area, tagged `coord-<area>`; every case is also tagged `cl-orchestration`, and named `coord-<area>-<case>`.
- Each case starts the skill as the owner does, `/cl-orchestration:coordinate <project path>`, and cites the public issue or pull request it comes from in its `description`, or says it is constructed and names the rule's file and line.
- A case that only checks a decision states the facts in its prompt, grants no gated tool and ends with a stop line ("write the lines ..., then stop"). A case that checks the commands the coordinator runs lists `Bash` and grades the fakes' call logs.
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

Model: . Judge: . Commit: .

| Suite | Cases | Pass rate | Tokens | Wall time | Cost |
|---|---|---|---|---|---|
| `coord-start` | 3 | | | | |
| `coord-watch` | 3 | | | | |
| `coord-host-limit` | 3 | | | | |
| `coord-follow-up` | 3 | | | | |
| `coord-clean-up` | 3 | | | | |
| `coord-commit` | 3 | | | | |
| `coord-checks` | 3 | | | | |
| `coord-bots` | 3 | | | | |
| `coord-pick` | 3 | | | | |
| `coord-merge` | 3 | | | | |
| `coord-review` | 3 | | | | |
| `coord-trial` | 3 | | | | |
| `coord-untrusted` | 3 | | | | |
| `coord-dialog` | 3 | | | | |
| `coord-resume` | 3 | | | | |
| `coord-approvals` | 3 | | | | |
| `coord-policy` | 3 | | | | |
| `coord-reconcile` | 3 | | | | |
| `coord-outcomes` | 3 | | | | |
| `coord-worker-rules` | 3 | | | | |
| `coord-digest` | 3 | | | | |
