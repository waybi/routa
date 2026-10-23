/**
 * Rerun feedback (card 1e7dd356): the board's error toast, the "starting"
 * marker and when it is dropped, and the status helpers it feeds.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, TaskInfo } from "../../types";
import { describeCardActivity } from "../kanban-card-status";
import { resolveCardLinkedSession } from "../kanban-session-activity";
import {
  RETRY_PENDING_TIMEOUT_MS,
  settleRetryPending,
  useKanbanRetryPending,
} from "../use-kanban-retry-feedback";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("@/client/components/toast", () => ({ toast: { error: toastError, success: vi.fn() } }));

function session(sessionId: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return { sessionId, cwd: "/tmp", workspaceId: "ws", createdAt: "2026-10-23T13:00:00.000Z", ...overrides } as SessionInfo;
}

const failedRun = { sessionId: "old-run", columnId: "todo", status: "failed" as const, startedAt: "2026-10-23T13:00:00.000Z" };
const failedMap = new Map([["old-run", session("old-run", { acpStatus: "error", acpError: "process exited" })]]);

beforeEach(() => {
  toastError.mockReset();
});

describe("status helpers with a pending rerun", () => {
  it("does not fall back to the previous failed lane session", () => {
    const task = { columnId: "todo", triggerSessionId: undefined, laneSessions: [failedRun] };
    expect(resolveCardLinkedSession(task, failedMap)?.sessionId).toBe("old-run");
    expect(resolveCardLinkedSession(task, failedMap, { retryPending: true })).toBeUndefined();
  });

  it("reads starting for both a queued rerun and a started one not yet listed", () => {
    const queued = { columnId: "todo", triggerSessionId: undefined, laneSessions: [failedRun] };
    const started = {
      columnId: "todo",
      triggerSessionId: "new-run",
      laneSessions: [failedRun],
    };
    expect(describeCardActivity({ task: queued, acpStatus: undefined, retryPending: true }).status).toBe("starting");
    expect(describeCardActivity({ task: started, acpStatus: undefined, retryPending: true }).status).toBe("starting");
    expect(describeCardActivity({ task: queued, acpStatus: undefined }).status).toBe("failed");
    // A board queue position still wins.
    expect(describeCardActivity({ task: queued, acpStatus: undefined, retryPending: true, queuePosition: 2 }).status).toBe("queued");
  });
});

describe("settleRetryPending", () => {
  const now = Date.UTC(2026, 9, 23, 13, 20);
  const tasks = [{ id: "card-1", columnId: "todo", triggerSessionId: undefined as string | undefined }];

  it("keeps the marker while the new run is not visible", () => {
    const pending = { "card-1": { startedAt: now, columnId: "todo" } };
    expect(settleRetryPending(pending, tasks, failedMap, now + 1000)).toBe(pending);
  });

  it("drops it once the run's session is listed, the card left the column, is gone, or waited too long", () => {
    const pending = { "card-1": { startedAt: now, columnId: "todo" } };
    const listed = new Map([["new-run", session("new-run")]]);
    expect(settleRetryPending(pending, [{ ...tasks[0], triggerSessionId: "new-run" }], listed, now)).toEqual({});
    expect(settleRetryPending(pending, [{ ...tasks[0], columnId: "dev" }], failedMap, now)).toEqual({});
    expect(settleRetryPending(pending, [], failedMap, now)).toEqual({});
    expect(settleRetryPending(pending, tasks, failedMap, now + RETRY_PENDING_TIMEOUT_MS)).toEqual({});
  });
});

describe("useKanbanRetryPending", () => {
  const card = { id: "card-1", columnId: "todo", triggerSessionId: undefined } as TaskInfo;

  it("marks the card pending after a successful rerun request", async () => {
    const { result } = renderHook(() => useKanbanRetryPending({ tasks: [card], sessionMap: failedMap }));
    await act(async () => {
      await result.current.trackRetry("card-1", async () => card);
    });
    expect(result.current.retryPendingTaskIds.has("card-1")).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("stops marking the card as soon as the new run's session is listed", async () => {
    const started = { ...card, triggerSessionId: "new-run" } as TaskInfo;
    const { result, rerender } = renderHook(
      ({ sessionMap }) => useKanbanRetryPending({ tasks: [started], sessionMap }),
      { initialProps: { sessionMap: failedMap } },
    );
    await act(async () => {
      await result.current.trackRetry("card-1", async () => started);
    });
    expect(result.current.retryPendingTaskIds.has("card-1")).toBe(true);

    rerender({ sessionMap: new Map(failedMap).set("new-run", session("new-run", { acpStatus: "ready" })) });
    expect(result.current.retryPendingTaskIds.has("card-1")).toBe(false);
  });

  it("shows the board error toast and leaves the card unmarked when the request fails", async () => {
    const { result } = renderHook(() => useKanbanRetryPending({ tasks: [card], sessionMap: failedMap }));
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.trackRetry("card-1", async () => {
          throw new Error("Cannot rerun: board missing");
        });
      } catch (error) {
        thrown = error;
      }
    });
    expect(thrown).toBeInstanceOf(Error);
    expect(toastError).toHaveBeenCalledWith("Rerun failed", { description: "Cannot rerun: board missing" });
    expect(result.current.retryPendingTaskIds.has("card-1")).toBe(false);
  });
});
