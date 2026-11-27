# Sessions on `fable`

A session itself on `fable` follows these defaults unless the user or spec changes them:
- works one ticket and ends with that ticket's handoff (a coordinator's worker: the handoff block of its spec);
- hands off at a task boundary once its context holds 100,000 to 150,000 tokens;
- goes on only in a new session started from that handoff, never by resuming this one;
- waits on no other session, and starts one subagent at a time, waiting only on the one that runs its own current step.
