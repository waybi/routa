/**
 * Per-repository mutual exclusion for async git sequences that modify the
 * working tree (checkout, pull, reset). The sync git helpers were implicitly
 * serialized by blocking the event loop; async ones need this so two requests
 * for one repo cannot race on `.git/index.lock`.
 */
import * as path from "path";

const tails = new Map<string, Promise<unknown>>();

export async function runExclusiveForRepo<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(repoPath);
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
