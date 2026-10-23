import { describe, expect, it, vi } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { buildRetryTriggerBody, classifyRetryResponse, runSerialRetries, type RetryBoard } from "../inbox-retry";
import { card, interruptedCard } from "./inbox-fixtures";

function laneBoard(overrides: { autoProviderId?: string; stepProviderId?: string; transport?: "acp" | "a2a"; enabled?: boolean } = {}): RetryBoard {
  return {
    autoProviderId: overrides.autoProviderId,
    columns: [
      {
        id: "dev",
        name: "Dev",
        position: 0,
        stage: "dev",
        automation: {
          enabled: overrides.enabled ?? true,
          steps: [{ id: "s1", specialistId: "crafter", providerId: overrides.stepProviderId, transport: overrides.transport }],
        },
      },
    ],
  } as unknown as Pick<KanbanBoardInfo, "columns" | "autoProviderId">;
}

/**
 * Expected body written from kanban-tab.tsx retryTaskTrigger's four
 * conditions (source ≠ card, transport ≠ a2a, providerSource = auto, board
 * autoProviderId set), stated per case instead of calling the board code.
 */
describe("buildRetryTriggerBody", () => {
  const dev = interruptedCard("i", "dev");

  it.each([
    ["all four conditions hold", dev, laneBoard({ autoProviderId: "dsh" }), { retryTrigger: true, retryProviderId: "dsh" }],
    ["card override (source = card)", { ...dev, assignedProvider: "codex", assignedSpecialistId: "other" } as TaskInfo, laneBoard({ autoProviderId: "dsh" }), { retryTrigger: true }],
    // resolveKanbanAutomationStep normalizes a lane step's "a2a" to "acp", so
    // the board's retryTaskTrigger also sends the provider here.
    ["lane step a2a (normalized to acp, same as the board)", dev, laneBoard({ autoProviderId: "dsh", transport: "a2a" }), { retryTrigger: true, retryProviderId: "dsh" }],
    ["lane step pins a provider (providerSource = lane)", dev, laneBoard({ autoProviderId: "dsh", stepProviderId: "claude" }), { retryTrigger: true }],
    ["board has no autoProviderId", dev, laneBoard({}), { retryTrigger: true }],
    ["board is undefined", dev, undefined, { retryTrigger: true }],
    ["blank autoProviderId", dev, laneBoard({ autoProviderId: "  " }), { retryTrigger: true }],
  ])("%s", (_name, task, board, expected) => {
    const body = buildRetryTriggerBody(task, board);
    expect(body).toEqual(expected);
    if (!("retryProviderId" in expected)) expect(Object.keys(body)).toEqual(["retryTrigger"]);
  });
});

describe("buildRetryTriggerBody transport condition", () => {
  it("omits retryProviderId when the effective transport is a2a", async () => {
    vi.resetModules();
    vi.doMock("@/core/kanban/effective-task-automation", () => ({
      resolveEffectiveTaskAutomation: () => ({ canRun: true, source: "lane", steps: [], transport: "a2a", providerSource: "auto" }),
    }));
    const { buildRetryTriggerBody: build } = await import("../inbox-retry");
    expect(build(interruptedCard("i", "dev"), laneBoard({ autoProviderId: "dsh" }))).toEqual({ retryTrigger: true });
    vi.doUnmock("@/core/kanban/effective-task-automation");
    vi.resetModules();
  });
});

describe("classifyRetryResponse", () => {
  it.each([
    ["HTTP 500 with error", false, { error: "Task not found" }, 500, { phase: "failed", error: "Task not found" }],
    ["HTTP 502 without body", false, {}, 502, { phase: "failed", error: "HTTP 502" }],
    ["started (triggerSessionId)", true, { task: { triggerSessionId: "s-new" } }, 200, { phase: "started" }],
    ["start error (lastSyncError)", true, { task: { lastSyncError: "usage_limit_reached" } }, 200, { phase: "failed", error: "usage_limit_reached" }],
    ["queued (neither)", true, { task: {} }, 200, { phase: "queued" }],
  ])("%s", (_name, ok, json, status, expected) => {
    expect(classifyRetryResponse(ok, json, status)).toEqual(expected);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("runSerialRetries", () => {
  it("sends one card at a time, rechecks first, skips, and keeps going after a failure", async () => {
    const tasks: Record<string, TaskInfo> = {
      a: interruptedCard("a", "dev"),
      b: card("b", { columnId: "dev", triggerSessionId: "fresh" }),
      c: interruptedCard("c", "dev"),
      d: interruptedCard("d", "review", "timed_out"),
    };
    const log: string[] = [];
    const pending: Array<{ key: string; resolve: (response: Response) => void }> = [];
    const request = vi.fn((path: string, init?: RequestInit) => {
      const id = decodeURIComponent(path.split("/").pop()!);
      const key = `${init?.method ?? "GET"} ${id}`;
      log.push(key);
      const gate = deferred<Response>();
      pending.push({ key, resolve: gate.resolve });
      return gate.promise;
    });
    const states: string[] = [];
    const done = runSerialRetries(["a", "b", "c", "d"].map((taskId) => ({ taskId, board: laneBoard({ autoProviderId: "dsh" }) })), {
      request,
      onRowState: (taskId, state) => states.push(`${taskId}:${state.phase}`),
    });
    const settle = async (response: (key: string) => Response) => {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
      const next = pending.shift()!;
      // Nothing else may be in flight while this request is unresolved.
      expect(pending).toEqual([]);
      next.resolve(response(next.key));
    };
    const getOk = (key: string) => Response.json({ task: tasks[key.split(" ")[1]] });
    await settle(getOk); // GET a
    await settle(() => Response.json({ task: { triggerSessionId: "new-a" } })); // PATCH a
    await settle(getOk); // GET b → skip
    await settle(getOk); // GET c
    await settle(() => Response.json({ error: "boom" }, { status: 500 })); // PATCH c
    await settle(getOk); // GET d
    await settle(() => Response.json({ task: {} })); // PATCH d → queued
    const summary = await done;
    expect(log).toEqual(["GET a", "PATCH a", "GET b", "GET c", "PATCH c", "GET d", "PATCH d"]);
    expect(states).toEqual([
      "a:starting", "a:started",
      "b:starting", "b:skipped",
      "c:starting", "c:failed",
      "d:starting", "d:queued",
    ]);
    expect(summary).toEqual({ started: 1, queued: 1, skipped: 1, failed: 1 });
    const patch = request.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ retryTrigger: true, retryProviderId: "dsh" });
    expect(patch[0]).toBe("/tasks/a");
  });

  it("a thrown network error fails that card only", async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith("/x")) throw new Error("network down");
      return Response.json({ task: card("y", { columnId: "done" }) });
    });
    const states: string[] = [];
    const summary = await runSerialRetries([{ taskId: "x", board: undefined }, { taskId: "y", board: undefined }], {
      request,
      onRowState: (taskId, state) => states.push(`${taskId}:${state.phase}${state.phase === "failed" ? `:${state.error}` : ""}`),
    });
    expect(states).toEqual(["x:starting", "x:failed:network down", "y:starting", "y:skipped"]);
    expect(summary).toEqual({ started: 0, queued: 0, skipped: 1, failed: 1 });
  });
});
