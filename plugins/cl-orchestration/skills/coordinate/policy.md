# Policy

Take each project's policy from the reader, never from the JSON file: `node <skill folder>/policy.mjs <project path>` prints the effective policy, `cedarloom.json` at the root of the remote's default branch as it is now with every default filled in, and `commit`, the commit of that branch it read. When to run it again: [Rules](SKILL.md#rules).

- Exit 1 means no policy: no pick, merge, issue close or branch deletion in that project, whoever started the run. List the errors it printed for the owner.
- Exit 0 with a `no cedarloom.json` line on stderr: the project has no policy file, and the defaults it prints start and merge nothing. Before the first pick there, offer the owner the file as an owner decision ([Owner decisions](decisions.md#owner-decisions)), `{"$schema": "https://cedarloom.github.io/cedarloom/schema/cedarloom.json", "schemaVersion": 3, "startLabel": "<label>"}` with the label they name (recommended: `cl:ready-for-agent`), two-space indented with a final newline; every other field keeps its default, and the owner may add fields of the table below before approving. Its What line starts with `policy` and `<owner/repo>`; record it in `## Open` as `Approval <repository>#<issue number>: policy, <owner/repo>`, with no head. An approving answer lets the coordinator open the `chore/agent-policy` pull request and nothing else: record it in `## Decisions` as `(owner)` and take the line out of `## Open`. When a pull request from `chore/agent-policy` is open, offer nothing: name it in the report. Once the owner's answer approves it: in a new folder `<clone path>` under `clones/` of the run folder, run `gh repo clone <owner/repo> <clone path> --no-upstream` and `git -C <clone path> switch -c chore/agent-policy`, write the file at `cedarloom.json` there, then `git -C <clone path> add cedarloom.json`, `git -C <clone path> commit -m "chore: add the coordinator policy"`, `git -C <clone path> push origin chore/agent-policy` and `gh pr create -R <owner/repo> --head chore/agent-policy --title "chore: add the coordinator policy" --body "Adds the coordinator policy with the start label; every other field keeps its default."`. The file is owner-only, so the owner merges that pull request. Until it is on the default branch, or when the owner declines, start nothing there and list the project in the report.
- A project bot reads the policy the same way and acts on the same fields, with the coordinator's steps of its procedures ([SOUL.md](SOUL.md)). It never opens the `chore/agent-policy` pull request: a project without a policy file starts nothing there, and the report names it. Its merges go only through `merge.mjs`, which takes the verdict the bot recorded.
- Format: [cedarloom.schema.json](cedarloom.schema.json), which the `$schema` URL serves to editors; example: [policy.example.json](policy.example.json).
- A path entry names a file or folder from the repository root and covers it and everything below it; there are no globs.
- `xhigh` runs only for the first review of a security or firmware-safety change (the model map's `review` task at risk `critical`) and on the owner's request (policy or session).

| Field | Meaning | Without the field |
|---|---|---|
| `startLabel` | issues with this label may start | none: ask the owner for the label, start nothing |
| `trustedAuthors` | logins whose issue, pull request, review and comment text a worker may follow, besides the repository owner (`authorAssociation` OWNER) and organization members and collaborators (MEMBER or COLLABORATOR) with write access; a review bot counts only when listed | owner, and members and collaborators with write access only, no bot |
| `workersPerProject` | workers at once in one project | 1 |
| `hostWorkerLimit` | workers at once on this machine, all projects | 2 |
| `stallMinutes` | time with no commit, PR or message before a worker counts as stalled | 20 |
| `merge.allowed`, `merge.requiredChecks` | the coordinator may merge a reviewed PR when every listed check is green | no merge: leave the PR for the owner |
| `merge.autoMergeMax` | the highest risk class the coordinator merges ([Risk class](decisions.md#risk-class)), `low` or `medium`; high is always the owner's | `medium` |
| `merge.mode` | `strict` or `disjoint`: whether the head that merges must contain the default branch's tip ([merge.md](merge.md#merge)); in `disjoint`, a `trial` verdict at Merge step 3 reads [trial-merge.md](trial-merge.md) | `strict` |
| `merge.additivePaths` | paths the PR and the default branch may both have changed in `disjoint` mode | none |
| `merge.ownerOnlyPaths`, `merge.ownerOnlyNames` | the paths and names the reader prints: a PR that touches one is left for the owner, and so does a file named like a container file or a lefthook config ([Owner-only](merge.md#owner-only)). A policy adds paths only: names are built-in | the built-in ones |
| `closeIssue` | a worker's PR carries `Closes #<number>`, so GitHub closes its issue at any merge of it, the owner's too; the coordinator closes one left open after its PR merged or after a verified no-change finding | no close |
| `deleteMergedBranch` | the owner allows deleting a branch whose PR is merged | no deletion |
| `issuesPerWorker` | pickable issues of the project that one worker takes as its batch | 1 |
| `keepRunning` | the run stays open for this project and picks up issues labeled later | false |
| `permissionPrompts` | `block`: the owner answers the dialog once ([A permission dialog](orca-watch.md#a-permission-dialog)) | `block` |
| `mode` | `supervised` or `automatic` ([modes](modes.md#modes)). The run argument `--mode supervised` lowers it; nothing raises it. | `supervised` |
| `review.depth`, `review.sensitiveDepth` | the review level of a routine and of a sensitive change (`low`, `medium`, `high`, `xhigh`) | both `high` |
| `riskyPaths` | paths whose change has high impact: the risk class is at least medium and the change sensitive ([Risk class](decisions.md#risk-class)). | none |
| `review.sensitivePaths` | paths that make a change sensitive, besides the built-in classes ([review.md](review.md#sensitive-or-routine)) | none |
| `models` | the model map's `roles`, `tasks`, `depth` and `risk` rows for this project, read by the model map's resolver after CedarLoom's defaults and the user file, not by this reader ([Policy](SKILL.md#policy)); implement and fix run only on `opus` | CedarLoom's defaults and the user file |
| `issues.labels` | labels an issue must carry besides `startLabel`; the issues live in the project's repository ([SKILL.md](SKILL.md#names)), so the reader drops an `issues.repository` with a warning | no further label |
| `minPlugin` | the oldest plugin version that may run this policy; on an older plugin the reader exits 1. A policy that sets `mode`, `riskyPaths`, `merge.autoMergeMax` or `models` names the first plugin version with that key here: an older plugin refuses the key | any |

## Pick order

The project bot ([bot-project.md](bot-project.md#pick)) takes the issues the precheck prints by their Priority issue field (Urgent, High, Medium, Low, then none, the precheck's order; it prints each number's level after it, as `#8 (urgent)`, and nothing for none). Within one level, pick by dependencies (an issue that others wait on first), then effort and impact, the oldest first on a tie, and name the reason in one line in the run's report. A goal is an issue with sub-issues, its steps: an issue that starts a new goal starts only when no goal in progress has a step that can start, or the new one is Urgent.
