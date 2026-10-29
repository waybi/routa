/**
 * Resolves the exports of `workflow-orchestrator-singleton` from whatever
 * shape the bundler hands back.
 *
 * Why: in the production webpack bundle, `require()` of that module returns a
 * **Promise** (an "async module": its import graph reaches an ESM-only
 * external, so webpack wraps every module on the path). The old resolver only
 * knew plain objects and threw `startWorkflowOrchestrator is not a function`
 * (card 2d21984e, 28 occurrences in the pm2 error log).
 *
 * This file has no imports on purpose: it must stay out of the cycle it helps
 * to break (routa-system → orchestrator → … → routa-system).
 */

export interface OrchestratorModuleShape {
  startWorkflowOrchestrator: (...args: never[]) => unknown;
  enqueueKanbanTaskSession?: (...args: never[]) => unknown;
}

export interface ResolveOrchestratorOptions {
  /** kanban-tools also calls enqueueKanbanTaskSession. */
  requireEnqueue?: boolean;
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof (value as { then?: unknown }).then === "function"
  );
}

function hasExports(record: Record<string, unknown>, requireEnqueue: boolean): boolean {
  return (
    typeof record.startWorkflowOrchestrator === "function"
    && (!requireEnqueue || typeof record.enqueueKanbanTaskSession === "function")
  );
}

/**
 * Synchronous resolution. Accepts the module namespace, an ESM-interop
 * `default`, or a CommonJS `module.exports` wrapper. A Promise is rejected
 * with a message that says so: callers that can wait use
 * {@link resolveWorkflowOrchestratorSingletonModuleAsync}.
 */
export function resolveWorkflowOrchestratorSingletonModule<T = OrchestratorModuleShape>(
  value: unknown,
  options: ResolveOrchestratorOptions = {},
): T {
  const requireEnqueue = options.requireEnqueue === true;
  if (isPromiseLike(value)) {
    throw new TypeError(
      "workflow-orchestrator-singleton is an async module (Promise); await it before resolving",
    );
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (hasExports(record, requireEnqueue)) return record as T;
    for (const key of ["default", "module.exports"]) {
      const inner = record[key];
      if (inner && typeof inner === "object" && hasExports(inner as Record<string, unknown>, requireEnqueue)) {
        return inner as T;
      }
    }
  }
  throw new TypeError(
    requireEnqueue
      ? "workflow-orchestrator-singleton module exports are incompatible: startWorkflowOrchestrator/enqueueKanbanTaskSession is not a function"
      : "startWorkflowOrchestrator is not a function",
  );
}

/** Same as the sync form, but awaits an async-module Promise first. */
export async function resolveWorkflowOrchestratorSingletonModuleAsync<T = OrchestratorModuleShape>(
  value: unknown,
  options: ResolveOrchestratorOptions = {},
): Promise<T> {
  return resolveWorkflowOrchestratorSingletonModule<T>(await value, options);
}
