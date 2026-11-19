---
name: dev
description: "Runs one task as a software change through the workflow skill, at the depth its rules pick."
disable-model-invocation: true
argument-hint: "<task>"
when: "On request, for a task you want run as a software change without the agent guessing its kind."
writes: "The depth and risk lines before the first edit; through the workflow skill's playbooks commits and a pull request in the project's convention."
---
<!-- Generated from definitions/dev.json by generator/generate.mjs: edit the definition, not this file. -->

# Dev

Typed as `/cl-workflow:dev <task>`. No task given: ask for it, or without terminal questions stop and say it is missing.

1. Where the skill `cl-workflow:workflow` is not installed, say so and stop.
2. Load the skill `cl-workflow:workflow` and run its step 1 with the kind fixed: software change. The depth comes from its rules. Write the `Depth:` and `Risk:` lines before the first edit or command.
3. Follow the rest of that skill and its software change playbook at that depth.
