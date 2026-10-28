/**
 * Per-tab record of repositories whose "pull to latest" request was already
 * sent. Module-level on purpose: it survives the board page remounting when
 * the user moves between workspaces, and is cleared by a full page reload
 * (the server-side cooldown then covers that case).
 */
const requestedRepoPaths = new Set<string>();

/** Returns true the first time a repo path is claimed in this tab. */
export function claimRepoSync(repoPath: string): boolean {
  if (requestedRepoPaths.has(repoPath)) return false;
  requestedRepoPaths.add(repoPath);
  return true;
}

/** Let the next board open retry a repo whose sync failed. */
export function releaseRepoSync(repoPath: string): void {
  requestedRepoPaths.delete(repoPath);
}

/** Test hook. */
export function resetRepoSyncDedupe(): void {
  requestedRepoPaths.clear();
}
