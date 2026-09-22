import { describe, expect, it } from "vitest";
import type { TaskInfo } from "../../types";
import {
  CARD_WORKING_ACTIVITY_WINDOW_MS,
  cardRunStatusDotClass,
  resolveCardMergeState,
  resolveCardRunStatus,
} from "../kanban-card-status";

const NOW = new Date("2026-01-01T12:00:00.000Z").getTime();

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

function laneSession(overrides: Partial<LaneSession> = {}): LaneSession {
  return {
    sessionId: "session-1",
    status: "running",
    startedAt: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  } as LaneSession;
}

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    columnId: "dev",
    triggerSessionId: "session-1",
    laneSessions: [laneSession()],
    ...overrides,
  } as TaskInfo;
}

describe("resolveCardRunStatus", () => {
  it("reports queued regardless of process state", () => {
    expect(resolveCardRunStatus({
      task: task(),
      acpStatus: "ready",
      queuePosition: 2,
      now: NOW,
    })).toBe("queued");
  });

  it("maps connecting to starting", () => {
    expect(resolveCardRunStatus({ task: task(), acpStatus: "connecting", now: NOW })).toBe("starting");
  });

  it("maps an errored process to failed", () => {
    expect(resolveCardRunStatus({ task: task(), acpStatus: "error", now: NOW })).toBe("failed");
  });

  it("treats a live process with recent activity as working", () => {
    const status = resolveCardRunStatus({
      task: task({
        laneSessions: [laneSession({ lastActivityAt: new Date(NOW - 5_000).toISOString() })],
      }),
      acpStatus: "ready",
      now: NOW,
    });
    expect(status).toBe("working");
  });

  it("treats a live process gone quiet as idle, not live", () => {
    // This is the case the old three-state model could not express: the
    // process is alive, so the card used to claim "live" forever.
    const status = resolveCardRunStatus({
      task: task({
        laneSessions: [laneSession({
          lastActivityAt: new Date(NOW - CARD_WORKING_ACTIVITY_WINDOW_MS - 1_000).toISOString(),
        })],
      }),
      acpStatus: "ready",
      now: NOW,
    });
    expect(status).toBe("idle");
  });

  it("lets a terminal lane status win over a lingering process", () => {
    expect(resolveCardRunStatus({
      task: task({ laneSessions: [laneSession({ status: "completed" })] }),
      acpStatus: "ready",
      now: NOW,
    })).toBe("completed");

    expect(resolveCardRunStatus({
      task: task({ laneSessions: [laneSession({ status: "timed_out" })] }),
      acpStatus: "ready",
      now: NOW,
    })).toBe("failed");
  });

  it("treats a fresh live session with no activity record as working", () => {
    expect(resolveCardRunStatus({
      task: task({ laneSessions: [] }),
      acpStatus: "ready",
      now: NOW,
    })).toBe("working");
  });

  it("falls back to idle when no process is attached", () => {
    expect(resolveCardRunStatus({
      task: task({ laneSessions: [] }),
      acpStatus: undefined,
      now: NOW,
    })).toBe("idle");
  });

  it("treats a done column with no live process as completed", () => {
    expect(resolveCardRunStatus({
      task: task({ columnId: "done", laneSessions: [] }),
      acpStatus: undefined,
      now: NOW,
    })).toBe("completed");
  });

  it("falls back to the most recent lane session when the trigger is unset", () => {
    const status = resolveCardRunStatus({
      task: task({
        triggerSessionId: undefined,
        laneSessions: [
          laneSession({ sessionId: "old", status: "completed", startedAt: new Date(NOW - 600_000).toISOString() }),
          laneSession({
            sessionId: "new",
            status: "running",
            startedAt: new Date(NOW - 10_000).toISOString(),
            lastActivityAt: new Date(NOW - 2_000).toISOString(),
          }),
        ],
      }),
      acpStatus: "ready",
      now: NOW,
    });
    expect(status).toBe("working");
  });
});

describe("cardRunStatusDotClass", () => {
  it("animates only while actively working or starting", () => {
    expect(cardRunStatusDotClass("working")).toContain("animate-pulse");
    expect(cardRunStatusDotClass("starting")).toContain("animate-pulse");
    // A parked card must look parked.
    expect(cardRunStatusDotClass("idle")).not.toContain("animate-pulse");
    expect(cardRunStatusDotClass("completed")).not.toContain("animate-pulse");
  });
});

describe("resolveCardMergeState", () => {
  function readiness(overrides: Partial<NonNullable<TaskInfo["deliveryReadiness"]>> = {}) {
    return {
      checked: true,
      modified: 0,
      untracked: 0,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: false,
      isGitHubRepo: false,
      canCreatePullRequest: false,
      landedOnBase: false,
      ...overrides,
    } as NonNullable<TaskInfo["deliveryReadiness"]>;
  }

  it("flags a done card whose commits are not reachable from base", () => {
    expect(resolveCardMergeState(task({ columnId: "done", deliveryReadiness: readiness() }))).toBe("unmerged");
  });

  it("reports merged once HEAD is reachable from base", () => {
    expect(resolveCardMergeState(task({
      columnId: "done",
      deliveryReadiness: readiness({ landedOnBase: true, commitsSinceBase: 0, hasCommitsSinceBase: false }),
    }))).toBe("merged");
  });

  it("stays unknown outside the done column", () => {
    expect(resolveCardMergeState(task({ columnId: "review", deliveryReadiness: readiness() }))).toBe("unknown");
  });

  it("stays unknown when readiness is unchecked, undeterminable, or there is nothing to merge", () => {
    expect(resolveCardMergeState(task({ columnId: "done" }))).toBe("unknown");
    expect(resolveCardMergeState(task({
      columnId: "done",
      deliveryReadiness: readiness({ checked: false }),
    }))).toBe("unknown");
    expect(resolveCardMergeState(task({
      columnId: "done",
      deliveryReadiness: readiness({ landedOnBase: null }),
    }))).toBe("unknown");
    // No commits beyond base and not landed: nothing to claim either way.
    expect(resolveCardMergeState(task({
      columnId: "done",
      deliveryReadiness: readiness({ commitsSinceBase: 0, hasCommitsSinceBase: false }),
    }))).toBe("unknown");
  });
});
