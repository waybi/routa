// @vitest-environment node
/**
 * Card 2d21984e (C1, F2a/b): the shapes `require("workflow-orchestrator-singleton")`
 * hands back. The production webpack bundle returns a Promise that resolves to
 * a module namespace whose exports are getters (probe output saved in the card:
 * toStringTag "[object Promise]", keys []).
 */
import { describe, expect, it } from "vitest";

import {
  resolveWorkflowOrchestratorSingletonModule,
  resolveWorkflowOrchestratorSingletonModuleAsync,
} from "../resolve-orchestrator-module";

const start = () => undefined;
const enqueue = () => undefined;

/** Namespace object as webpack builds it: getters, __esModule, no own plain values. */
function webpackNamespace(withEnqueue = true) {
  const ns: Record<string, unknown> = {};
  Object.defineProperty(ns, "__esModule", { value: true });
  Object.defineProperty(ns, "startWorkflowOrchestrator", { enumerable: true, get: () => start });
  if (withEnqueue) Object.defineProperty(ns, "enqueueKanbanTaskSession", { enumerable: true, get: () => enqueue });
  return ns;
}

describe("resolveWorkflowOrchestratorSingletonModule", () => {
  // The three shapes the old resolver already took: same function references after the change (F2a).
  it.each([
    { label: "plain namespace", value: { startWorkflowOrchestrator: start, enqueueKanbanTaskSession: enqueue } },
    { label: "default interop", value: { default: { startWorkflowOrchestrator: start, enqueueKanbanTaskSession: enqueue } } },
    { label: "module.exports wrapper", value: { "module.exports": { startWorkflowOrchestrator: start, enqueueKanbanTaskSession: enqueue } } },
  ])("keeps resolving $label to the same functions", ({ value }) => {
    for (const requireEnqueue of [false, true]) {
      const resolved = resolveWorkflowOrchestratorSingletonModule(value, { requireEnqueue });
      expect(resolved.startWorkflowOrchestrator).toBe(start);
      if (requireEnqueue) expect(resolved.enqueueKanbanTaskSession).toBe(enqueue);
    }
  });

  // C1: the production shape, for the routa-system use and the kanban-tools use.
  it.each([
    { label: "routa-system use", options: {} },
    { label: "kanban-tools use (requireEnqueue)", options: { requireEnqueue: true } },
  ])("resolves the production async-module shape: $label", async ({ options }) => {
    const value = Promise.resolve(webpackNamespace());
    const resolved = await resolveWorkflowOrchestratorSingletonModuleAsync(value, options);
    expect(typeof resolved.startWorkflowOrchestrator).toBe("function");
    expect(typeof resolved.enqueueKanbanTaskSession).toBe("function");
  });

  it("the synchronous form says why it cannot take a Promise", () => {
    expect(() => resolveWorkflowOrchestratorSingletonModule(Promise.resolve(webpackNamespace())))
      .toThrow(/async module/);
  });

  // F2b: shapes that failed before still fail loudly.
  it.each([
    { label: "empty object", value: {} },
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "start is not a function", value: { startWorkflowOrchestrator: 1 } },
  ])("throws for $label", ({ value }) => {
    expect(() => resolveWorkflowOrchestratorSingletonModule(value)).toThrow(/startWorkflowOrchestrator is not a function/);
  });

  it("kanban-tools use throws when enqueueKanbanTaskSession is missing", async () => {
    expect(() => resolveWorkflowOrchestratorSingletonModule(webpackNamespace(false), { requireEnqueue: true }))
      .toThrow(/incompatible/);
    await expect(
      resolveWorkflowOrchestratorSingletonModuleAsync(Promise.resolve(webpackNamespace(false)), { requireEnqueue: true }),
    ).rejects.toThrow(/incompatible/);
    // The routa-system use does not need it.
    expect(resolveWorkflowOrchestratorSingletonModule(webpackNamespace(false)).startWorkflowOrchestrator).toBe(start);
  });

  it("an async module resolving to an empty object rejects", async () => {
    await expect(resolveWorkflowOrchestratorSingletonModuleAsync(Promise.resolve({}))).rejects.toThrow(
      /startWorkflowOrchestrator is not a function/,
    );
  });
});
