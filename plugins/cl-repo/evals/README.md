# cl-repo evals

These suites check that each `cl-repo` skill does what its text says, on small scaffolded repositories, with `claude plugin eval`. Layout, graders, cost and the before and after table follow the [cl-workflow evals](../../cl-workflow/evals/README.md); here every case is tagged `cl-repo` and `skill-<name>`, and named `skill-<name>-<case>`.

```sh
# one suite
claude plugin eval plugins/cl-repo --tag skill-maintain --scaffold --no-publish --runs 3 --json skill-maintain.json
```
