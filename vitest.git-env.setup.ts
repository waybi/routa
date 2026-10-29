// git hooks (pre-push, pre-commit) export GIT_DIR & co. Tests that shell out to
// `git init --bare <tmp>` would otherwise re-init the hook's GIT_DIR — whose config
// is shared with the main checkout — as bare (core.bare=true). Scrub before any test runs.
import { scrubGitEnv } from "./src/core/git/__tests__/git-env-scrub";

scrubGitEnv();
