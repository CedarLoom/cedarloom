---
name: away
description: "Works alone in this Claude Code session: refuses the question tool and plan mode until off or for a span. Off comes back and asks up to 5 queued owner questions."
disable-model-invocation: true
argument-hint: "[30|30m|2h|until HH:MM|off]"
metadata:
  when: "On request: when you leave the terminal, and with off when you are back. Off asks the queue of this folder's repository and local queue: run it in each project's clone and the coordinator's folder."
  writes: "One file per Claude Code process in the plugin's data folder (ask/<process id>.json: the away span's end, or the answer flag off sets). Off also writes a comment and new labels on each issue you answer or defer in this repository, a close as not planned of each one you reject, and the cl:deferred label there when it lacks it; status and answer lines in the local queue."
---

# Away

Questions are open by default; the plugin option `mode` sets how a session starts: unset or `here` here, any other value away. Alone, this command is away until `off`; a span sets an end: `30` or `30m` minutes, `2h` hours, `until HH:MM` (local time, the next such time). Only `off` ends an away sooner. While away, the question tool and plan mode are refused, agents take the safe, reversible defaults and put owner-only items into the issue tracker. `/clear`, compaction and a fork keep the state; a new Claude Code process or a resumed conversation starts in the mode.

The plugin's hook has already set the state and added a line above as context.
- A span, or a hook line that names the forms: answer with that line alone.
- `off`: in Claude Code, when the hook set no answer flag, give its reason and stop; Codex sets no flag and skips this check. Else run the [question queue](queue.md) from its **Earlier runs** bullet, at most 5 questions.
- No such line: the hook did not run; say so in one line.

Codex runs none of the question hooks: there a span changes nothing, and `off` asks the queue in chat.
