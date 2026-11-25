#!/usr/bin/env bash
# Workspace: agent files with different model lines in their frontmatter.
set -eu
mkdir -p agents
for pair in gather:sonnet plan:inherit recheck:opus review:inherit verify:opus; do
  name=${pair%%:*}
  model=${pair#*:}
  printf -- '---\nname: %s\ndescription: "The %s agent."\nmodel: %s\n---\n\nYou are the %s agent.\n' "$name" "$name" "$model" "$name" > "agents/$name.md"
done
