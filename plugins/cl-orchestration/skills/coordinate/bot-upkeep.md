# Upkeep runs

The project bot's weekly maintenance and daily reconciliation. Names and [Every run](bot-project.md#every-run) are those of [bot-project.md](bot-project.md); a run about no pull request skips its step 3.

## Maintenance

Weekly, where a maintain bot or its fallback exists:

1. **Answer.** A `maintain` question answered in the local queue (`approval.mjs queue`): `state write <state>/answered.json --add <its key>`; `added: false` skips it. Then `state decide <state> --ids <its finding ids>` with `--approved` all of them for (a), the listed ones for (b), `--hold` for (c); another answer is reported. A private repository: file each approved one as an issue without `startLabel` (behavior-preserving, tests unchanged, normal review), then write its number as its `issue` in `maintain.json`; one without a number is reported, never filed again. Elsewhere list them for the owner.
2. **Findings.** A maintain result: one naming a security weakness goes in the report only; the others as one `maintain` question (`approval.mjs file`, local queue only): (a) all, (b) those the answer lists, (c) Hold. Delete its prompt file.
3. **Start.** No open `maintain` question, maintain prompt file or maintenance pull request: one maintain run ([Start](bot-project.md#start)) at the [map's](SKILL.md#policy) `implement` for `deep`. In a private repository, a maintenance pull request is an open one of `gh pr list -R <owner/repo> --state open --limit 1000 --json number,headRefName,isCrossRepository` with `isCrossRepository` false and a branch `<type>/<issue>-<slug>` whose `<issue>` is in `maintain.json`; the report names it.

## Reconciliation

Daily: [Reconciliation](run-files.md#reconciliation) with `node <skill folder>/reconcile.mjs --project <clone> --repo <owner/repo> --default-branch <default branch> --log <state>/merge-log.md`, plus a report of each event rule of a closed pull request (`ORCA automations list --json`), each UTC day without a catch-up run (no `counts-<day>.json` with `catchUp` above 0) and each prompt file older than `stallMinutes`. It changes nothing.
