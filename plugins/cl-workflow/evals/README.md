# cl-workflow evals

These suites check that each `cl-workflow` skill and agent does what its text says on tasks taken from real issues and pull requests, so a change to the text can show its pass rate, tokens and cost before and after. They run with `claude plugin eval`, which loads the plugin and runs each case in a fresh Claude Code child session.

## Layout

| Path | Holds |
|---|---|
| `skills/<skill>/<case>/case.yaml` | one case of a skill: the prompt, the limits and the graders |
| `agents/<agent>/<case>/case.yaml` | one case of an agent, started from the session through the Agent tool |
| `<case>/setup.sh` | the scaffold: builds the small git repository the case works in (runs only with `--scaffold`) |

- One suite per skill or agent, tagged `skill-<name>` or `agent-<name>`; every case is also tagged `cl-workflow`. Case names are `skill-<name>-<case>` or `agent-<name>-<case>`.
- Each case cites the public issue or pull request it comes from in its `description`. A constructed case, for a rule no public task shows, says so in its `description` and names the rule's file and line instead.
- A case lists the tools it needs in `execution.allowed_tools`: a case that changes a file needs `Edit` or `Write`, one that runs a command or commits needs `Bash`. The gated tools (`Bash`, `Write`, `Edit`, `WebFetch`, `mcp__*`) reach a case only when the case lists them and the command grants them with `--allow-tools`; otherwise the runner removes them. The read-only tools (Read, Glob, Grep, Skill) need no grant. Source: `claude plugin eval --help` (the `--allow-tools` option).
- Graders apply checks: `tool_used` (a tool or skill was or was not called), `regex` (on the last message, the trace or a file in the workspace), `file_exists`, and `llm` for a stated criterion the default judge (`haiku`) checks.
- `tool_used` has `min: 1` unless set, so a "never called" check sets both `min: 0` and `max: 0`. `file_exists` sees only files the run created or removed; check a scaffold file with a `regex` on its contents.
- A case that only checks classification ends its prompt with a stop line ("write the lines ..., then stop"), so it costs a few turns.
- This folder is outside `skills/` and `agents/`, so the token budget does not count it and no session loads it.

## Run

From the repository root, signed in to Claude Code:

```sh
# one suite
claude plugin eval plugins/cl-workflow --allow-tools Bash Edit Write WebFetch --tag skill-lite --scaffold --no-publish --keep-temp --runs 3 --json skill-lite.json
# one case
claude plugin eval plugins/cl-workflow --allow-tools Edit Bash --case skill-lite-config-value-edit --scaffold --no-publish
# everything
claude plugin eval plugins/cl-workflow --allow-tools Bash Edit Write WebFetch --scaffold --no-publish --keep-temp --runs 3 --max-cost-usd 20 --json all.json
```

- `--allow-tools` grants the gated tools for the whole run, and each case still gets only the ones its `allowed_tools` lists, so the full list above is safe for any selection. A one-case run can grant just that case's list.
- Granted `Bash` runs in Claude Code's OS sandbox: built in on macOS, and on Linux it needs `bubblewrap` (`bwrap`) and `socat` installed ([Sandboxing](https://code.claude.com/docs/en/sandboxing)).
- `--scaffold` runs the cases' `setup.sh` (bash, as you); without it those cases run in an empty workspace and fail.
- `--keep-temp` keeps each run's temporary folder, with its `trace.jsonl` (`tracePath` in the JSON); the traces hold the token counts a pull request comparison needs and are deleted without it.
- `--no-publish` keeps the HTML report local; by default it is published to claude.ai where the account supports it.
- The first run asks whether you trust this plugin directory; `--trust-plugin` asserts it where nothing can ask (CI).
- Results (`aggregate-result.json`, `report.html`) go to the folder the run prints, by default `<eval dir>/results/<timestamp>/`, or to `--output-dir`; do not commit them.
- `--runs` defaults to 3 per case; `--model` pins the model for every case, `--judge-model` the judge.

## Cost

Each run is a full Claude Code child on your own credential (`claude plugin eval --help`): a claude.ai login spends the plan's usage, an `ANTHROPIC_API_KEY` in the environment bills the API (confidence: medium, from the CLI's messages, not yet seen on a run). The run reports an estimated cost per run (`cost_usd`) and for the judge (`judge_cost_usd`); `--max-cost-usd` stops the run with partial results when the estimate reaches the cap.

## Before and after in a pull request

A pull request that changes a skill or agent text reruns the suites it affects before (on the merge base) and after (on its head), with the same `--runs`, `--model`, `--judge-model` and `--allow-tools` and the same case files: the head's. When the pull request also adds or edits cases, both runs still use the head's cases, so a change in pass rate comes from the skill or agent text, not from the cases.

1. Run `git fetch origin`, update the branch with `main` if it is behind, then take the base: `git merge-base origin/main HEAD`. Do not run the before side on a newer `main`.
2. Add a worktree at that commit (`git worktree add --detach <path> <merge base>`) and replace its cases with the head's, so cases the head removed or renamed go too: `git -C <path> rm -r -q plugins/cl-workflow/evals`, then `git -C <path> checkout <head SHA> -- plugins/cl-workflow/evals`, with the SHA from `git rev-parse HEAD` in the branch's checkout (inside `-C <path>`, `HEAD` is the merge base). Run the before side there.
3. Run the after side in the branch's own checkout.

Compare only complete runs: both sides ran every selected case `--runs` times. A run stopped early, by `--max-cost-usd`, a failed child or an interrupt, has partial results; rerun it (with a higher cap) before it goes in the table. The pull request puts one table in its body:

| Suite | Pass rate before | Pass rate after | Tokens before | Tokens after | Wall time before | Wall time after | Cost before | Cost after |
|---|---|---|---|---|---|---|---|---|

Pass rate is passing runs over all with-plugin runs of the suite (its runs of the `with` arm), counting each of a case's `--runs` runs on its own: a case that passes 2 of its 3 runs adds 2 passing runs and 3 runs. The no-plugin arm's pass rate is a separate figure over its own runs, never mixed into this one. Cost is the sum of `costUsd` and `judgeCostUsd` in the JSON. Tokens are the sum, over every model in the `modelUsage` of each run's final `result` event in its `trace.jsonl`, of `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens` and `outputTokens`; `modelUsage` covers the main thread and its subagents, `usage` only the main thread. The run keeps the trace only with `--keep-temp`. Wall time is the run's duration. In the before and after table, pass rate, tokens, wall time and cost count the with-plugin runs only, so both sides compare like with like whether or not the no-plugin arm ran. Name the model, the judge and the run count above the table.

A pull request that lowers the pass rate of an affected suite does not merge until the case is fixed, or the drop is explained in the pull request and accepted in its review.

## Baseline

Runs on `main` at commit `dbea48552b3c85cf8a2fbecf0e016a0ed7219d1f`, model `claude-opus-5-5` at the default effort, judge `haiku` (default), `--runs 3`, with the no-plugin arm (`with-without`). Wall time and Cost per suite count the with-plugin runs only; the All cost covers both arms.

| Suite | Pass rate | Pass rate without plugin | Tokens | Wall time | Cost |
|---|---|---|---|---|---|
| `agent-gather` | 5/9 (56%) | 0/9 | | 6m52s | $1.22 |
| `agent-implement` | 6/9 (67%) | 0/9 | | 9m30s | $2.30 |
| `agent-plan` | 7/9 (78%) | 0/9 | | 15m08s | $2.82 |
| `agent-recheck` | 4/9 (44%) | 0/9 | | 17m07s | $2.42 |
| `agent-research` | 9/9 (100%) | 0/9 | | 7m33s | $1.98 |
| `agent-review` | 7/9 (78%) | 0/9 | | 11m52s | $2.85 |
| `agent-test` | 8/9 (89%) | 0/9 | | 15m37s | $3.33 |
| `agent-verify` | 6/9 (67%) | 0/9 | | 9m04s | $1.82 |
| `skill-away` | 2/9 (22%) | 1/9 | | 8m17s | $0.86 |
| `skill-dev` | 9/9 (100%) | 0/9 | | 5m33s | $1.35 |
| `skill-full` | 7/9 (78%) | 1/9 | | 6m20s | $1.56 |
| `skill-lite` | 6/9 (67%) | 0/9 | | 7m08s | $1.50 |
| `skill-plan` | 7/9 (78%) | 0/9 | | 7m56s | $2.38 |
| `skill-research` | 3/9 (33%) | 0/9 | | 13m22s | $2.59 |
| `skill-workflow` | 12/12 (100%) | 0/12 | | 8m58s | $1.84 |
| All | 98/138 (71%) | 2/138 | | 2h00m (run, 2 in parallel) | $44.66 (both arms) |

Tokens were not recorded for this run: the eval JSON has no token counts, and the traces that hold them are deleted unless the run passes `--keep-temp`.
