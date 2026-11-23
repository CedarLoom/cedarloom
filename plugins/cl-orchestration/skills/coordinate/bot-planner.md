# Planner bot run

One plan for one issue, from the spec in the prompt ([spec-template.md](spec-template.md)). [SOUL.md](SOUL.md) holds first; the prompt names the result file.

1. Clone as step 1 of [bot-worker.md](bot-worker.md) says, on the default branch.
2. Plan the issue at the spec's depth as the `plan` agent of the cl-workflow plugin says: read only, no edit, commit or push. A choice the spec, the code or the docs do not settle goes into its open questions with your recommendation.
3. Report in the result file, with the file tool: the plan, the commit it read and what was not checked. Delete the clone as step 6 of [bot-worker.md](bot-worker.md) says, and end.
