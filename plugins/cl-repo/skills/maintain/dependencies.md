# Dependency pass

1. Collect the package manager's audit (`npm audit --json`, `pip-audit`, `cargo audit`: id, severity, first fixed version) and its outdated list (`npm outdated --json`, `pip list --outdated`, `cargo outdated`: current and newest version at least 3 days old).
2. Group, each update in one group, in this order:
   1. Each advisory fix, by severity (critical, high, moderate, low).
   2. Packages released together (one monorepo, a shared version, or peers that need each other): one group, a major included.
   3. Each other major: alone.
   4. All other minors and patches: one group.
3. For every update, read the changelog or release notes of each release after the current version up to the new one. For each breaking change and deprecation, search the repository for the API, option or key it names (`git grep -nw -- <name>`): each hit is a file and line to change in that group; no hit is "not used here". No changelog: say so, and treat a major as breaking wherever it is used.
4. Each group is one finding: packages with current and new version, advisories fixed, each breaking change or deprecation with its hits or "not used here". After approval, each group is one pull request under `cl-workflow:workflow` (a major at least standard) that lists the versions and how each breaking change was handled. A group whose tests fail stays unmerged; the others go on.
