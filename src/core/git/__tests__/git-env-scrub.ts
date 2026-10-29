/** git hooks export GIT_DIR & co; scrub them so real-git calls in tests hit only the temp repos. */
const GIT_ENV_KEYS = [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];
const saved: Record<string, string | undefined> = {};

export function scrubGitEnv(): void {
  for (const k of GIT_ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
}

export function restoreGitEnv(): void {
  for (const k of GIT_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
}
