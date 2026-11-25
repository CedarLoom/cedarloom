#!/usr/bin/env bash
# Checks one run of the rules block task: the workspace fixture.sh built, after the
# agent worked in it, and the agent's final answer. One PASS or FAIL line per check,
# exit 1 when one fails. Each check names the rule of plugins/cl-repo/rules/project.md
# it covers.
# Usage: bash check.sh <workspace> <answer file>
set -u
ws=$1 answer=$2
failed=0
result() {
  if [[ "$2" = 0 ]]; then echo "PASS $1"; else echo "FAIL $1"; failed=1; fi
}
dash=$'\xe2\x80\x94'

# The task itself: report.js uses formatSpan from span.js.
grep -q "from './span.js'" "$ws/src/report.js"
result task-done $?

# "Remove what your change made unused."
! git -C "$ws" grep -q formatDuration -- src test
result unused-removed $?

# "Leave other code ... as is: dead code ... found outside the task becomes ... a line in the report."
grep -q '^export function legacyPad' "$ws/src/pad.js" && grep -q legacyPad "$answer"
result outside-dead-code-reported-not-changed $?

# "where an em dash would go, use a comma, colon, parentheses or two sentences."
! { git -C "$ws" diff; cat "$answer"; } | grep -qF "$dash"
result no-em-dash $?

# "never `utils`, `helpers`, `common`, `misc` or `shared`."
! { git -C "$ws" diff --name-only; git -C "$ws" ls-files --others --exclude-standard; } | grep -Eiq '(^|/)(utils|helpers|common|misc|shared)(\.|/)'
result no-catch-all-name $?

exit "$failed"
