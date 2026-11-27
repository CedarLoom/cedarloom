# Recurring runs

A scheduled run starts a session only when there is work, so a tick with nothing to do costs no session. Read this file before you set up or run a scheduled or unattended run. `ORCA` is the executable of [orca.md](orca.md).

```text
ORCA automations create --name <name> --trigger <cron> --provider claude --repo path:<coordinator project> --precheck "node <skill folder>/precheck.mjs <its arguments in SKILL.md, Loop>" --prompt "<the skill invocation>" --json
ORCA automations runs --id <automation id> --limit 5 --json
```

- A scheduled session starts only after its precheck exits 0; any other exit records a skipped run (`status` `skipped_precheck`). The sample [precheck.mjs](precheck.mjs) (arguments as in [SKILL.md](SKILL.md#loop)) exits 0 when a project has an issue to pick and prints which; it starts and merges nothing. An issue that carries `cl:in-progress` is not pickable, so a schedule whose other issues are all done starts no session while it carries the label: tell the owner when setting up the schedule.
- One live session per automation: the scheduled session first lists `automations runs` and ends at once when an earlier run of the same automation still has a live terminal. Tell a live run by `terminalPtyId` and the terminal's state, not by `status`.
- An unattended run starts each worker in a disposable worktree: without `--workspace`, Orca makes a new worktree per run.
- A project bot's automations each name one procedure ([SOUL.md](SOUL.md)). Schedule its catch-up sweep only once [bot-catch-up.md](bot-catch-up.md) and the other `bot-*.md` procedures are installed: its runs act on the state the other runs write.
