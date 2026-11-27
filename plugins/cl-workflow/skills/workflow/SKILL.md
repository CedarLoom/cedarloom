---
name: workflow
description: "Picks the workflow and depth for a task: a software change, a docs pass, research, or a batch of tasks on one branch, each at quick, standard or deep depth, with the checks and reviews each needs. Use before the first edit in a repository, before issue or pull request work, and before research with two or more items."
user-invocable: false
metadata:
  writes: "The depth line `Depth: <depth> (<reason>)` and the risk line `Risk: <class> (<reason>)` before the first edit; through its playbooks commits and a pull request in the project's convention."
---

# Workflow

Every depth:
- Before the first edit, state your assumptions and the check that proves each step done; loop until those checks pass, and stop and report on the stuck signals of step 6 of [the implement agent](../../agents/implement.md).
- Keep validation at trust boundaries, error handling that prevents data loss, and security checks.
- Without terminal questions, a step's questions go with your recommendations into one issue per task in the project's issue tracker, else the report; take each safe, reversible recommendation (an item without one waits) and go on.
- An installed skill may run a step of this skill or its playbooks in more detail: these texts set its floor and gates and win where the two differ; one only the user starts is suggested, then wait; none installed: do the step directly. Reviews, research notes and pull request text follow these playbooks.

1. **Classify.** Kind: software change, docs pass (several documents or product copy checked against the code; a one-file rewrite with no claim about code is a quick software change), research, or a mix or several requests (one item each). Each item gets one depth:

   | Depth | When |
   |---|---|
   | quick | the diff fits in one sentence; a question the code answers |
   | standard | one behavior, or a refactor that keeps behavior, approach clear; at least standard: a bug, a dependency major or security advisory, a review-thread follow-up, a log line that logs user data |
   | deep | several behaviors, a new capability, an uncertain approach, or a risky change; always deep: a schema migration, infrastructure as code, a performance change, a refactor across modules or with a changed interface |

   - Risky: authentication, permissions, secrets, input validation, production data, deploy or production configuration, an irreversible action.
   - Which depth, first match: the user's depth; the `Depth:` line of a coordinator's spec; your pick from the table. A `Depth minimum:` line in `AGENTS.md` raises your pick to that depth; a risky change, to deep.
   - A software change also gets its risk class and the `Risk:` line ([risk.md](risk.md)). The class raises your pick too: high to deep, medium to standard.
   - A software change's visible result (UI, site, CLI output, rendered document) at standard or deep, not risky and risk below `high`, takes the [draft-first](draft.md) route.
   - Before the first edit or command, write the depth line `Depth: <depth> (<reason>)`: the change type's name ([Change types](#change-types)), `research` or `docs pass`, or a few words when none fits, and `risky` when it is (`Depth: deep (new auth flow; risky)`).
   - Unsure between two depths: the deeper one.
   - The work grows past its depth: say so, write a new depth line, and run the skipped steps before the next edit.

2. **Settle.** Standard and deep: when goal, scope or result is open, grill the user in rounds (each question with your recommendation, all open ones per round) until goal, scope, acceptance criteria and risks are settled; a settled request skips the grill. Then explore read-only, as the plan phase where [software.md](software.md#phases) runs phases (Claude Code: in plan mode, only while terminal questions are allowed).

   A plan or spec for this task with an acceptance table (from `/cl-workflow:plan`, a coordinator or the user) settles it: skip this step and the Plan phase and build against that plan. It never lowers the depth or the risk class, and the plan check still runs unless the plan records one.
3. **Run the playbook.**
   - Software change at quick depth: this file is the whole playbook.
   - Standard and deep, and any risky change: also [software.md](software.md), deep also [deep.md](deep.md).
   - Docs pass: [docs.md](docs.md). Research: [research.md](research.md).
   - A typed entry skill (`/cl-workflow:<name>`, `$cl-workflow:<name>` in Codex, or `/<name>` in a project) fixes the kind and, where it names one, a depth floor; step 1 still writes its lines, and its rules may raise the depth.
   - Branches, commits and pull requests follow the project's own convention (`AGENTS.md`, a contributing guide, the history). Where it names none, commit subjects and pull request titles follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): a squash merge makes the title the commit subject.
   - A pull request body fills each section, in order, of the project's `pull_request_template.md` or `PULL_REQUEST_TEMPLATE/` (any documented location or case), else the owner's `.github` default, else [pull-request-template.md](pull-request-template.md): `gh pr create --body-file <file>`. Issues fill their kind's template (a form: one `### <field label>` per field, in order).
   - Two or more independent items, each more than a few files or searches: one subagent per item in parallel, then one merged report.

   The steps in order (the playbooks hold the detail):

   | Depth | Software change | Review before pushing |
   |---|---|---|
   | quick | edit, fast checks after each edit; verify; commit | none |
   | standard | settle; plan check; existing tests of the touched code; implement, tests by the [test rule](#verify); verify, review before pushing | one correctness pass (`/code-review high`) |
   | deep | settle, spec with acceptance table; plan check; existing tests; ticket by ticket, tests by the [test rule](#verify); verify and run it; review in rounds ([deep.md](deep.md)) | review rounds (`/code-review xhigh`) |

4. **Batch** when the user asks for it or names several tasks for one branch: the tasks run one after another, each at quick depth with no per-task review. Give each task its depth first (step 1): a task that is risky or above quick is not batched and runs at its own depth. Step 5 and the reviews then run once for the whole branch.
5. **Long checks last.**
   - Fast checks (types, lint, the tests of the touched code) after each edit.
   - The full suite, end-to-end and browser tests and builds run once, after the last edit, in a subagent that writes each to a log file and returns only its failures and last lines.
   - Reviews start then, by the depth's playbook with its remediation rounds.
   - Read-only lookups and mechanical reading (file searches, log and CI output, inventories, pull request status) run in a subagent on [map](models.md) task `gather` that edits no file (Claude Code: `cl-workflow:gather`), on `lookup` only for a bounded lookup whose whole input stays under 100,000 tokens.
   - Failed checks rerun after their fix.
   - Waiting for pull request checks: watch them in the background (a host without a watch command: one until-loop Monitor, 30 seconds or slower).
6. **Report done** with each check's command and result, a "steps skipped" line naming the checklist steps not run (or "none") and what was not checked. After a merge or when the next task is unrelated, suggest a new session (`/clear` in Claude Code).

A session itself on `fable` also follows [fable.md](fable.md).

## Change types

The check before done, per change type (it names the depth line). Never run a check that changes shared or production systems (`terraform apply`, `kubectl apply`, `helm upgrade`, migrations against shared databases).

| Change | Check before done |
|---|---|
| Docs, typo | docs build |
| Config value | tests, schema or lint |
| Tests only, log line | |
| Dependency patch or minor | full suite, package audit |
| UI tweak | browser check, screenshot baselines updated only for intended changes |
| UI behavior in an existing flow | end-to-end and accessibility tests |
| Bug | known cause: a failing test first, where the [test rule](#verify) allows one. Unknown: diagnose the cause first ([diagnose.md](diagnose.md)) |
| Refactor | suite unchanged and passing |
| Dependency major or security advisory | changelog read, full suite, package audit |
| CI workflow | `actionlint` |
| New CI check, hook or lint rule | reports only until it flags only what a human would |
| Feature, performance | performance: benchmark before and after on the same machine |
| Infrastructure as code | `fmt -check`, `validate`, `plan`; `ansible-lint --check --diff`; `kubeconform`, `kubectl diff`; `helm lint`, `helm template` |
| Schema migration | expand and contract, migrate a throwaway database |
| Production data fix | dry run on a copy, the user runs it |
| Auth, permissions, secrets, input validation | tests for denied paths |
| Review-thread follow-up on an open pull request | the fix verified, each thread answered |
| CI fix | the failing check rerun |
| Merge conflict | resolved the way the repository's conventions say, checks rerun |
| Live-system change or incident | backup first, verify live, record in the repository docs |

A follow-up commit on an open pull request keeps its depth and needs no workflow reload or new depth line.

## Verify

- Run the project's own build, types, lint and tests where `AGENTS.md` says, then run the change as a user meets it (app, CLI, browser with `webapp-testing` where installed, local service) as a project skill or doc says where one does (Claude Code: `/verify`); the pull request body says how, or "not run" and why.
- A failing test: diagnose first (code, test or environment) and fix the cause. A flaky one gets no rerun, sleep or skip to green; no cause found: delete it, the reason in the commit and an issue. Edit a test only when it is wrong or the requirement changed, and say so in the pull request.
- Test rule: no tests by default. Add one only when it meets all three:
  - it fails if the change is reverted;
  - it hardcodes its expected values (never computed by production code, locale files or mocks);
  - it runs at the single layer that owns the behavior.
- Test type, when chosen, at the owning layer: property for a parser, round trip or invariant; differential (old code as oracle, same inputs) for a rewrite; else end-to-end. The property or oracle replaces hardcoded values; a rewrite's need not fail first or on revert.
- A new test is written first and seen failing for the reason the change addresses; one that passes at once proves nothing.
- One slice (a row of the plan's acceptance table, where there is one) at a time: one test, the code that makes it pass, then the next.
- Leave untested: copy or translations, CSS classes, constants, third-party libraries, private state, timing and call counts. A test like that is deleted when touched, not updated. Coverage is no target.
- The project's own test rules in `AGENTS.md` win.
- Screenshots, browser and build output are git-ignored or deleted.

After a compaction, reread this skill and the current depth's playbook before the next step.
