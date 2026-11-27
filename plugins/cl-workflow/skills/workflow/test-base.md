# New and changed tests on the base commit

List the tests the change adds or changes, and take the base commit (the commit the change starts from) as a SHA: the start of the diff range, else `git merge-base <head> origin/<default branch>` run in the repository itself, since a local clone's `origin` is the repository, not its remote. In one scratch clone outside the repository (`git clone --no-hardlinks <repository path> <scratch path>` on the host; a worktree would change the shared git directory), check out that SHA detached, then the change's version of those test files and the test-only helpers and fixtures they use (`git checkout <head> -- <paths>`); set it up the way `AGENTS.md` sets up a checkout (dependencies, container) and run each test there. Record per test, with the key line:
- `fails on base`: an assertion fails, or the test itself uses code the change adds and cannot build or load.
- `passes on base`: it does not prove the change. Flag it, and fail this phase for it only when the change claims to fix a bug that test covers.
- `not run on base`: a build or load error from code only other tests use. Leave those files out and rerun first; a bug-fix test still not run leaves that gate not checked.
When that setup is not possible, report the check as not run.
