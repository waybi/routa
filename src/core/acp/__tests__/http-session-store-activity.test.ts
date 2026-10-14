/**
 * The store pushes kanban:session-activity so board cards stop showing the
 * creation-time "connecting" snapshot and can tell working from stuck.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHttpSessionStore } from "../http-session-store";
import { getKanbanEventBroadcaster } from "../../kanban/kanban-event-broadcaster";

describe("HttpSessionStore — kanban session activity", () => {
  let notify: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const store = getHttpSessionStore();
    for (const s of store.listSessions()) store.deleteSession(s.sessionId);
    notify = vi.spyOn(getKanbanEventBroadcaster(), "notifySessionActivity");
  });

  afterEach(() => {
    notify.mockRestore();
  });

  it("publishes immediately when the process becomes ready", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "act-1",
      cwd: "/tmp",
      workspaceId: "ws-act",
      provider: "opencode",
      acpStatus: "connecting",
      createdAt: new Date().toISOString(),
    });

    store.updateSessionAcpStatus("act-1", "ready");

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "ws-act",
      sessionId: "act-1",
      acpStatus: "ready",
    }));
  });

  it("reports the running tool and last activity in the summary", () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "act-2",
      cwd: "/tmp",
      workspaceId: "ws-act",
      provider: "opencode",
      acpStatus: "ready",
      createdAt: new Date().toISOString(),
    });

    store.pushNotification({
      sessionId: "act-2",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "Bash",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "npm test" },
      },
    });

    const summary = store.getSessionActivitySummary("act-2");
    expect(summary.acpStatus).toBe("ready");
    expect(summary.lastEventType).toBe("tool_call");
    expect(summary.lastToolName).toBeTruthy();
    expect(summary.lastActivityAt).toBeTruthy();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "act-2", lastEventType: "tool_call" }));
  });
});
