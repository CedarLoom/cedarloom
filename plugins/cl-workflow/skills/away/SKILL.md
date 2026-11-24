---
name: away
description: "Works alone in this Claude Code session: refuses the question tool and plan mode until off or for a span. Off comes back and asks up to 5 queued owner questions."
disable-model-invocation: true
argument-hint: "[30|30m|2h|until HH:MM|off]"
when: "On request: when you leave the terminal, and with off when you are back."
writes: "One file per Claude Code process in the plugin's data folder (ask/<process id>.json: the away span's end, or the answer flag off sets); off also writes what the question queue writes."
---

# Away

Questions are open by default; the plugin option `mode` (`here` or `away`) sets how a session starts. Alone, this command is away until `off`; a span ends it sooner: `30` or `30m` minutes, `2h` hours, `until HH:MM` (local time, the next such time). While away, the question tool and plan mode are refused, agents take the safe, reversible defaults and put owner-only items into the issue tracker. `/clear`, compaction and a fork keep the state; a new Claude Code process or a resumed conversation starts in the mode.

The plugin's hook has already set the state and added a line above as context.
- A span, or a hook line that names the forms: answer with that line alone.
- `off`: when the hook set no answer flag, give its reason and stop. Else run the [question queue](../questions/SKILL.md) from its **Earlier runs** bullet, at most 5 questions.
- No such line: the hook did not run; say so in one line.

Codex runs none of the question hooks: there a span changes nothing, and `off` asks the queue in chat.
