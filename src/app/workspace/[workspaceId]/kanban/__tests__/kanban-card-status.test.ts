import { describe, expect, it } from "vitest";
import type { TaskInfo } from "../../types";
import {
  CARD_STALL_THRESHOLD_MS,
  CARD_TOOL_STALL_THRESHOLD_MS,
  cardRunStatusDotClass,
  describeCardActivity,
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

  it("keeps a run that paused briefly as working (dsh paragraphs are ~14 s apart)", () => {
    const status = resolveCardRunStatus({
      task: task(),
      acpStatus: "ready",
      session: { acpStatus: "ready", lastActivityAt: new Date(NOW - 45_000).toISOString(), lastEventType: "agent_message" },
      now: NOW,
    });
    expect(status).toBe("working");
  });

  it("flags a live, mid-turn run silent past the threshold as stalled", () => {
    const detail = describeCardActivity({
      task: task(),
      acpStatus: "ready",
      session: {
        acpStatus: "ready",
        lastActivityAt: new Date(NOW - CARD_STALL_THRESHOLD_MS - 1_000).toISOString(),
        lastEventType: "agent_message",
      },
      now: NOW,
    });
    expect(detail.status).toBe("stalled");
    expect(detail.quietMs).toBe(CARD_STALL_THRESHOLD_MS + 1_000);
  });

  it("gives a still-running tool a longer grace before calling it stuck", () => {
    const session = {
      acpStatus: "ready" as const,
      lastActivityAt: new Date(NOW - CARD_STALL_THRESHOLD_MS - 60_000).toISOString(),
      lastEventType: "tool_call",
      lastToolName: "Bash",
      lastToolStatus: "running",
    };
    const detail = describeCardActivity({ task: task(), acpStatus: "ready", session, now: NOW });
    expect(detail.status).toBe("working");
    expect(detail.runningTool).toBe("Bash");

    expect(resolveCardRunStatus({
      task: task(),
      acpStatus: "ready",
      session: { ...session, lastActivityAt: new Date(NOW - CARD_TOOL_STALL_THRESHOLD_MS - 1_000).toISOString() },
      now: NOW,
    })).toBe("stalled");
  });

  it("treats a finished turn as idle (parked), not stuck", () => {
    const detail = describeCardActivity({
      task: task(),
      acpStatus: "ready",
      session: { acpStatus: "ready", lastActivityAt: new Date(NOW - 20 * 60_000).toISOString(), lastEventType: "turn_complete" },
      now: NOW,
    });
    expect(detail.status).toBe("idle");
    expect(detail.turnDone).toBe(true);
  });

  it("does not stay 'starting' once the session has shown activity", () => {
    // The board's session snapshot is taken at creation (connecting); a
    // heartbeat proves the process is up.
    expect(resolveCardRunStatus({
      task: task(),
      acpStatus: "connecting",
      session: { acpStatus: "connecting", lastActivityAt: new Date(NOW - 5_000).toISOString(), lastEventType: "tool_call" },
      now: NOW,
    })).toBe("working");
  });

  it("surfaces the failure reason from a watchdog timeout or process error", () => {
    expect(describeCardActivity({
      task: task(),
      acpStatus: "ready",
      session: { acpStatus: "ready", terminalState: "timed_out", terminalReason: "No ACP activity for 10 minutes." },
      now: NOW,
    })).toMatchObject({ status: "failed", failureReason: "No ACP activity for 10 minutes." });

    expect(describeCardActivity({
      task: task(),
      acpStatus: "error",
      session: { acpStatus: "error", acpError: "provider exited" },
      now: NOW,
    })).toMatchObject({ status: "failed", failureReason: "provider exited" });
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
    expect(cardRunStatusDotClass("stalled")).not.toContain("animate-pulse");
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

  it("prefers the list endpoint's cheap deliveryLanding probe when present", () => {
    // Board tiles never receive deliveryReadiness (lean list path).
    expect(resolveCardMergeState(task({
      columnId: "done",
      deliveryLanding: { landedOnBase: false, commitsSinceBase: 3 },
    }))).toBe("unmerged");
    expect(resolveCardMergeState(task({
      columnId: "done",
      deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 },
    }))).toBe("merged");
    expect(resolveCardMergeState(task({
      columnId: "done",
      deliveryLanding: { landedOnBase: null, commitsSinceBase: 3 },
    }))).toBe("unknown");
    // Landing wins over a stale readiness object.
    expect(resolveCardMergeState(task({
      columnId: "done",
      deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 },
      deliveryReadiness: readiness({ landedOnBase: false }),
    }))).toBe("merged");
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
