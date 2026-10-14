import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../types";
import { mergeSessionActivity } from "../kanban-session-activity";

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: "s1",
    cwd: "/tmp",
    workspaceId: "ws",
    createdAt: "2026-10-14T01:00:00.000Z",
    acpStatus: "connecting",
    ...overrides,
  };
}

describe("mergeSessionActivity", () => {
  it("returns the same array when nothing was pushed", () => {
    const sessions = [session()];
    expect(mergeSessionActivity(sessions, {})).toBe(sessions);
  });

  it("lets a heartbeat replace the stale connecting snapshot", () => {
    const [merged] = mergeSessionActivity([session()], {
      s1: { sessionId: "s1", acpStatus: "ready", lastActivityAt: "2026-10-14T01:05:00.000Z", lastEventType: "tool_call", lastToolName: "Bash" },
    });
    expect(merged.acpStatus).toBe("ready");
    expect(merged.lastToolName).toBe("Bash");
  });

  it("keeps a refetched session that is newer than the held heartbeat", () => {
    const [merged] = mergeSessionActivity(
      [session({ acpStatus: "ready", lastActivityAt: "2026-10-14T01:10:00.000Z", lastEventType: "turn_complete" })],
      { s1: { sessionId: "s1", acpStatus: "ready", lastActivityAt: "2026-10-14T01:05:00.000Z", lastEventType: "tool_call" } },
    );
    expect(merged.lastEventType).toBe("turn_complete");
  });
});
