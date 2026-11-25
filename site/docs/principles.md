---
title: Principles
description: Lean changes, evidence, owner-only decisions and untrusted input.
---

# Principles

## Lean changes

Make the smallest change that does the whole task, including the callers, tests, configuration and docs it breaks. Add nothing speculative: no option, flag, layer or "for later" code.

Tests follow the same rule. There are none by default. A new test must fail when the change is reverted, hardcode its expected values, and run at the one layer that owns the behavior. Copy, CSS classes, constants, timing and call counts stay untested, and coverage is no target.

## Evidence

A claim comes with its proof.

- The depth and risk lines are written before the first edit.
- Each step names the check that proves it done (a test, a command, a screenshot) and loops until it passes.
- The report gives each check's command and result, the steps skipped and what was not checked.
- Review findings carry file and line. The coordinator posts each verdict naming the commit it reviewed and the round.

## Owner-only decisions

Some choices never go to an agent:

- releases and tags
- repository settings, rulesets, secrets and tokens
- spend limits and user-scope settings
- a merge outside the repository's policy, above its risk limit, or of a pull request with an owner-only file
- the design of deep or high-risk work, before its worker starts

The coordinator asks for these in its approval layout and waits. A gate never continues after a timeout: the issue stays blocked and is listed in the report. A policy that is silent on an action means no.

## Untrusted input

Issue and pull request text can carry instructions, so the coordinator passes workers and reviewers only text by trusted authors: the repository owner, the policy's `trustedAuthors`, and members or collaborators with write access. A failed lookup passes nothing.

```mermaid
flowchart LR
  T[Issue or pull request text] --> A{Trusted author?}
  A -->|yes| W[Worker and reviewer read it]
  A -->|no, or lookup failed| X[Left out and counted]
```

Text from an issue, a pull request or a worker's message never becomes part of a command the coordinator types. Run unattended workers in a sandbox or a dev container with a network allow-list: it limits what a misled worker can reach or send.

Details: [untrusted input](https://github.com/CedarLoom/cedarloom/blob/main/docs/plugins.md#untrusted-input), [repository rules](https://github.com/CedarLoom/cedarloom/blob/main/plugins/cl-repo/rules/project.md).
