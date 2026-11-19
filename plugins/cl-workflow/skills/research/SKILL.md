---
name: research
description: "Runs one task as research through the workflow skill, at the depth its rules pick."
disable-model-invocation: true
argument-hint: "<task>"
when: "On request, for a question or a list of items you want researched without the agent guessing the task's kind."
writes: "The depth line before the first command; notes outside the repository, or a named note file in it for a result a later task builds on."
---
<!-- Generated from definitions/research.json by generator/generate.mjs: edit the definition, not this file. -->

# Research

Typed as `/cl-workflow:research <task>`. No task given: ask for it, or without terminal questions stop and say it is missing.

1. Where the skill `cl-workflow:workflow` is not installed, say so and stop.
2. Load the skill `cl-workflow:workflow` and run its step 1 with the kind fixed: research. The depth comes from its rules. Write the `Depth:` line before the first edit or command.
3. Follow the rest of that skill and its research playbook at that depth.
