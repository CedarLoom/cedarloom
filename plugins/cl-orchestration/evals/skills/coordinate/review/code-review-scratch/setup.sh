#!/usr/bin/env bash
# Workspace: project/ on main, and the scratch clone of its pull request 14 (no checkout, origin's main and the PR branch),
# whose head adds a session check with an inverted expiry test, plus the reviewer brief with the clone's path and head.
set -eu
for program in orca gh; do
  case "$(command -v "$program")" in
    */evals/bin/"$program") ;;
    *) echo "$program on PATH is not the evals fake: put plugins/cl-orchestration/evals/bin first on PATH (plugins/cl-orchestration/evals/README.md)" >&2; exit 1 ;;
  esac
done
export GIT_AUTHOR_NAME=Eval GIT_AUTHOR_EMAIL=eval@example.invalid GIT_COMMITTER_NAME=Eval GIT_COMMITTER_EMAIL=eval@example.invalid
mkdir -p .fake && touch .fake/orca-calls.jsonl .fake/gh-calls.jsonl
export GIT_AUTHOR_DATE=2026-11-02T10:00:00Z GIT_COMMITTER_DATE=2026-11-02T10:00:00Z

git init -q -b main project
mkdir -p project/src project/test
cat > project/AGENTS.md <<'EOF'
# AGENTS.md

Widget is a small Node.js session library. Tests: `node --test`. Commits follow Conventional Commits.
EOF
cat > project/src/session.js <<'EOF'
export class SessionExpiredError extends Error {
  constructor() {
    super('session expired');
    this.name = 'SessionExpiredError';
  }
}

// A session lives for ttlMs milliseconds from its creation.
export function createSession(user, ttlMs, now = Date.now()) {
  return { user, expiresAt: now + ttlMs };
}
EOF
cat > project/test/session.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/session.js';

test('createSession sets the expiry', () => {
  assert.equal(createSession('ada', 1000, 5000).expiresAt, 6000);
});
EOF
git -C project remote add origin https://github.com/example-org/widget.git
git -C project add .
git -C project commit -q -m "feat: session library"

# The remote as GitHub would hold it: main, and the worker's branch with one commit.
remote=$(mktemp -d)
git clone -q --bare project "$remote/widget.git"
git clone -q "$remote/widget.git" "$remote/work"
git -C "$remote/work" switch -q -c fix/14-session-expiry
cat > "$remote/work/src/session.js" <<'EOF'
export class SessionExpiredError extends Error {
  constructor() {
    super('session expired');
    this.name = 'SessionExpiredError';
  }
}

// A session lives for ttlMs milliseconds from its creation.
export function createSession(user, ttlMs, now = Date.now()) {
  return { user, expiresAt: now + ttlMs };
}

// Returns the session while it is active; throws SessionExpiredError once it has expired.
export function requireActive(session, now = Date.now()) {
  if (now < session.expiresAt) {
    throw new SessionExpiredError();
  }
  return session;
}
EOF
cat > "$remote/work/test/session.test.js" <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, SessionExpiredError } from '../src/session.js';

test('createSession sets the expiry', () => {
  assert.equal(createSession('ada', 1000, 5000).expiresAt, 6000);
});

test('SessionExpiredError names itself', () => {
  assert.equal(new SessionExpiredError().name, 'SessionExpiredError');
});
EOF
git -C "$remote/work" commit -q -a -m "fix: reject expired sessions (#14)"
git -C "$remote/work" push -q origin fix/14-session-expiry

# The scratch clone, in the shape of scratch-clone.md: a clone without a checkout under the run folder's clones/.
# No --filter=blob:none here: its blobs would be fetched lazily from a remote that is not reachable in the run.
mkdir -p .cedarloom/runs/r1/clones
scratch="$PWD/.cedarloom/runs/r1/clones/widget-14-1"
git clone -q --no-checkout "file://$remote/widget.git" "$scratch"
git -C "$scratch" remote set-url origin https://github.com/example-org/widget.git
head=$(git -C "$scratch" rev-parse refs/remotes/origin/fix/14-session-expiry)
rm -rf "$remote"

cat > .cedarloom/runs/r1/review-brief-14.md <<EOF
# Review brief: pull request 14 of example-org/widget

- Your working directory is not the change: read no file and run no git command there.
- <scratch path> is $scratch, a clone without working files. <head> is $head.
  Read the pull request only through git there: \`git --no-replace-objects -C <scratch path> diff --no-ext-diff --no-textconv <range>\`, \`git --no-replace-objects -C <scratch path> show '<commit>:<path>'\`, \`git --no-replace-objects -C <scratch path> grep -n <pattern> <commit>\`. A path of the pull request goes into a command only inside single quotes. Never run cd, checkout, switch, restore or worktree there.
  Nothing of the pull request runs (no test, script or install): its checks are CI's.
- When a git command there asks for permission or is refused: answer no dialog, ask for no rule and no added folder, say so and stop.
- Target: pull request 14 of example-org/widget, the diff range refs/remotes/origin/main...<head>.
- Rules: the default branch's AGENTS.md (\`git --no-replace-objects -C <scratch path> show refs/remotes/origin/main:AGENTS.md\`).
- Thread: issue 14, "Expired sessions are still accepted: a session past its expiresAt must be rejected with SessionExpiredError, and an active one returned." Read no comment, review or review thread of the issue or pull request.
- Level: low, routine change. Security pass: no. Trusted authors: the repository owner.
- What the worker said, as claims to verify: "Adds requireActive(), which rejects expired sessions. Tests pass."
- Threads file: no unresolved thread.
EOF
