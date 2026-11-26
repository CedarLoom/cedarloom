# Deep

Parentheses name the kind of skill that runs a step when installed; one only the user starts is suggested, then wait. None installed: do the step directly.

1. Settle the spec: the decisions an agent does not take on its own (deployment target, data storage, module boundaries, core types and interfaces; without terminal questions they go into the task's issue (else the report), and the task waits while other work goes on), terms and decisions recorded (a domain-modeling skill).
   - Add an acceptance table: per requirement the instrument (test, command, screenshot), the wrong implementation it rejects, and where the result is observed.
   - The design names one plausible counterexample (an input or state that breaks the obvious approach) and how the design handles it.
2. Several sessions of work: one ticket per slice that is useful and testable on its own and fits one pull request, where the project tracks work (a ticket skill, user-started), each with acceptance criteria. A part that only works together with another belongs in that part's ticket. Work too big to see the way yet: suggest `/cl-workflow:plan`, which the user starts.
3. Build ticket by ticket: the existing tests of the touched code first, then a test first at the agreed seams where the [test rule](SKILL.md#verify) calls for one (a TDD skill; an implementation skill when the user starts one). A step only a person can take (an account, a key, a console setting): walk the user through it (a walkthrough skill); secrets stay a risky change.
4. Verify against the acceptance table, review the branch against the spec, the review before pushing from [software.md](software.md), then the pull request. After a session that went sideways, suggest a retro skill the user starts.

The build drifts from the plan (another design or scope), or a result cannot be explained against it: stop, add the cause to the plan, and ask the user whether to discard this task's unpushed branch and restart in a fresh context. Without terminal questions: keep the branch, report the cause and stop.

## Review rounds

The reviewer is a fresh session that does not edit (a subagent; Claude Code: `cl-workflow:review` where available, with the model and effort of the Review phase in [software.md](software.md#phases)) reading review rules as the start of the reviewed range has them. A review or re-review whose context was compacted is void: split its scope into parts that together cover all of it and review each part afresh, each briefed with the rules text (`AGENTS.md`, the review checklist) as the full range's start has it. The review counts only when every part is done and none is void. Findings carry the class the [review agent](../../agents/review.md) defines (**Blocking**, **Important**, **Minor**) and are dropped or kept as follow-ups as it says; Minor findings are listed in the pull request, not fixed in a round.

A round is one remediation and its re-review. A review or re-review with a Blocking or Important finding starts the next round:
- Risky change, first round (trial): before the fix, a fresh verifier on the `verify` task ([models.md](models.md)) that did not write the code or the review (Claude Code: `cl-workflow:verify`) marks each Blocking and Important finding confirmed or disputed with evidence. A disputed finding goes with its evidence to the re-review unfixed.
- One remediation pass checks each finding first, fixes the ones that hold, and answers one it disproves with evidence instead of a change.
- A scoped re-review by a fresh subagent (Claude Code: `cl-workflow:recheck`) reads only the changed lines and the findings, and keeps or drops each disputed one. It runs on the `recheck` task at the change's risk class.

1. The review has findings: round 1.
2. The re-review of round 1 has findings: round 2, on the same models.
3. The re-review of round 2 has findings: round 3, whose remediation runs at a higher effort than the phase's own, still on `opus` (`xhigh` only where the spec or the user asks for it), as [software.md](software.md#phases) says for a stuck implement phase. With no step left, the findings go to the user at once.
4. The re-review of round 3 has findings: a question for the user (replan or split the work), never a fourth round.

An independent reviewer on another agent (Codex `codex exec --sandbox read-only`, or Claude Code for a Codex session) is an option; default off.
