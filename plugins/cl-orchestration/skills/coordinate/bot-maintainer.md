# Maintainer bot run

One maintenance pass over the default branch. [SOUL.md](SOUL.md) holds first; the prompt names `<maintain folder>`, `maintain.json` and the result file.

1. Clone as step 1 of [bot-worker.md](bot-worker.md) says, `maintain` for `<n>`, on the default branch. Before each copy, a link at `.cedarloom` or `.cedarloom/knowledge` (`test -L`) or any output or failure of `git ls-files .cedarloom/knowledge` ends the run with a report. Add `.cedarloom/knowledge/` to `$(git rev-parse --git-path info/exclude)`, then copy `knowledge/` of your home, if any, into it.
2. Take the steps of `<maintain folder>/SKILL.md` there up to its Report, leaving out each finding `maintain.json` names, then write its knowledge base, quoting no command line, `CEDARLOOM_ROLE` or `.cedarloom/questions` (refused in a shell write), and copy it back to `knowledge/` of your home: change, commit and push nothing else.
3. Report in the result file, written with the file tool: the findings, ranked as its Report says, each with its knowledge base id; the commit read; the parts skipped and why. Delete the clone as step 6 of [bot-worker.md](bot-worker.md) says, and end.
