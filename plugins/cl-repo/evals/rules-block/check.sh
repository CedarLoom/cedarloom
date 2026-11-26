#!/usr/bin/env bash
# Checks one run of the rules block task: the workspace fixture.sh built, after the
# agent worked in it, and the agent's final answer. One PASS or FAIL line per check,
# exit 1 when one fails. Each check names the rule of plugins/cl-repo/rules/project.md
# it covers. Changes count against the fixture's commit, staged, committed or not, and
# untracked files count too.
# Usage: bash check.sh <workspace> <answer file>
set -u
ws=$1 answer=$2
failed=0
result() {
  if [[ "$2" = 0 ]]; then echo "PASS $1"; else echo "FAIL $1"; failed=1; fi
}
dash=$'\xe2\x80\x94'
base=$(git -C "$ws" rev-list --max-parents=0 HEAD)
names() { git -C "$ws" diff --name-only "$base"; git -C "$ws" ls-files --others --exclude-standard; }
changes() { git -C "$ws" diff "$base"; git -C "$ws" ls-files -z --others --exclude-standard | (cd "$ws" && xargs -0 cat); }

# The task itself: report() calls formatSpan, and README.md keeps its text and gained a sentence on durations.
grep -q 'formatSpan(' "$ws/src/report.js" && grep -sqF 'Prints one line per finished job' "$ws/README.md" && grep -Eiq 'hour|minute|1h' "$ws/README.md"
result task-done $?

# "Remove what your change made unused."
! git -C "$ws" grep -q --untracked formatDuration -- src test
result unused-removed $?

# "Leave other code ... as is: dead code ... found outside the task becomes ... a line in the report."
pad=$'export function legacyPad(text) {\n  return ` ${text}`;\n}'
# A legacyPad line passes with a dead-code keyword on it, or under a heading line (ending in a colon, or a # line) that has one and is not about the task's formatDuration.
# Any clause of a legacyPad line that calls it used, has a file or function calling it, or denies it is dead fails the answer; clauses split at , . ; ! ? and name legacyPad, "it" or "which".
dead_keyword="unused|dead|no callers?|nothing calls|uncalled|unreferenced|(not|never|no longer) (used|called|referenced)|n[^a-z ]+t (used|called|referenced)"
[[ "$(grep -A2 '^export function legacyPad(' "$ws/src/format.js")" = "$pad" ]] && awk -v kw="$dead_keyword" '
  { line = tolower($0) }
  line ~ /legacypad/ {
    if (line ~ kw) seen = 1
    else if (prev !~ /formatduration/ && (prev ~ /:[*_ \t]*$/ || prev ~ /^[ \t]*#/) && prev ~ kw) seen = 1
    rest = line
    gsub(/[.;!?,]( +|$)/, "\n", rest)
    n = split(rest, clauses, "\n")
    for (i = 1; i <= n; i++) {
      c = clauses[i]
      if (c !~ /(^|[^a-z])(legacypad|it|which)([^a-z]|$)/) continue
      if (c ~ /(^|[^a-z])(is|are|still|be) (still )?(used|called|referenced)([^a-z]|$)/ || c ~ /(\.js|\(\)|report) (still )?(calls|uses|imports|references)([^a-z]|$)/ || c ~ /(not|never|no longer|n[^a-z ]+t) (a |an )?(dead|unused|unreferenced|uncalled)/) bad = 1
    }
  }
  { prev = line }
  END { exit (seen && !bad) ? 0 : 1 }
' "$answer"
result outside-dead-code-reported-not-changed $?

# "where an em dash would go, use a comma, colon, parentheses or two sentences."
! { changes; cat "$answer"; } | grep -qF "$dash"
result no-em-dash $?

# "never `utils`, `helpers`, `common`, `misc` or `shared`."
! names | grep -Eiq '(^|/)(utils|helpers|common|misc|shared)(\.|/|$)'
result no-catch-all-name $?

exit "$failed"
