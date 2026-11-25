# cl-workflow evals

These suites check that each `cl-workflow` skill and agent does what its text says on tasks taken from real issues and pull requests, so a change to the text can show its pass rate, tokens and cost before and after. They run with `claude plugin eval`, which loads the plugin and runs each case in a fresh Claude Code child session.

## Layout

| Path | Holds |
|---|---|
| `skills/<skill>/<case>/case.yaml` | one case of a skill: the prompt, the limits and the graders |
| `agents/<agent>/<case>/case.yaml` | one case of an agent, started from the session through the Agent tool |
| `<case>/setup.sh` | the scaffold: builds the small git repository the case works in (runs only with `--scaffold`) |

- One suite per skill or agent, tagged `skill-<name>` or `agent-<name>`; every case is also tagged `cl-workflow`. Case names are `skill-<name>-<case>` or `agent-<name>-<case>`.
- Each case cites the issue or pull request it comes from in its `description`.
- Graders apply checks: `tool_used` (a tool or skill was or was not called), `regex` (on the last message, the trace or a file in the workspace), `file_exists`, and `llm` for a stated criterion the default judge (`haiku`) checks.
- `tool_used` has `min: 1` unless set, so a "never called" check sets both `min: 0` and `max: 0`. `file_exists` sees only files the run created or removed; check a scaffold file with a `regex` on its contents.
- A case that only checks classification ends its prompt with a stop line ("write the lines ..., then stop"), so it costs a few turns.
- This folder is outside `skills/` and `agents/`, so the token budget does not count it and no session loads it.

## Run

From the repository root, signed in to Claude Code:

```sh
# one suite
claude plugin eval plugins/cl-workflow --tag skill-lite --scaffold --no-publish --runs 3 --json skill-lite.json
# one case
claude plugin eval plugins/cl-workflow --case skill-lite-config-value-edit --scaffold --no-publish
# everything
claude plugin eval plugins/cl-workflow --scaffold --no-publish --runs 3 --max-cost-usd 20 --json all.json
```

- `--scaffold` runs the cases' `setup.sh` (bash, as you); without it those cases run in an empty workspace and fail.
- `--no-publish` keeps the HTML report local; by default it is published to claude.ai where the account supports it.
- The first run asks whether you trust this plugin directory; `--trust-plugin` asserts it where nothing can ask (CI).
- Results (`aggregate-result.json`, `report.html`) go to the folder the run prints, by default `<eval dir>/results/<timestamp>/`, or to `--output-dir`; do not commit them.
- `--runs` defaults to 3 per case; `--model` pins the model for every case, `--judge-model` the judge.

## Cost

Each run is a full Claude Code child on your own credential (`claude plugin eval --help`): a claude.ai login spends the plan's usage, an `ANTHROPIC_API_KEY` in the environment bills the API (confidence: medium, from the CLI's messages, not yet seen on a run). The run reports an estimated cost per run (`cost_usd`) and for the judge (`judge_cost_usd`); `--max-cost-usd` stops the run with partial results when the estimate reaches the cap.

## Before and after in a pull request

A pull request that changes a skill or agent text reruns the suites it affects, on `main` and on its branch, with the same `--runs`, `--model` and `--judge-model` and the same case files: the branch's. For the before run, check out `main` in a separate worktree, copy the branch's cases into it with `git checkout <branch> -- plugins/cl-workflow/evals`, and run there. The pull request puts one table in its body:

| Suite | Pass rate before | Pass rate after | Tokens before | Tokens after | Wall time before | Wall time after | Cost before | Cost after |
|---|---|---|---|---|---|---|---|---|

Pass rate is cases passed over cases run, tokens and cost are the sums the run reports, wall time is the run's duration. Name the model, the judge and the run count above the table.
