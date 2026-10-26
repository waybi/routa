/**
 * Card 87810657 (AC4): the kanban task-detail rebuild keeps the original
 * provider/model/effort, and the side-panel session creator forwards the
 * reasoning effort as createSession argument 20.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { buildKanbanSessionReplacementArgs } from "../kanban-tab-panels";
import { useEnsureKanbanAgentSession } from "../use-ensure-kanban-agent-session";
import type { SessionInfo } from "../../types";

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: "s-1",
    cwd: "/tmp/repo",
    branch: "main",
    workspaceId: "workspace-1",
    role: "CRAFTER",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildKanbanSessionReplacementArgs (C4 kanban-tab-panels)", () => {
  it("reuses the record's provider, model and effort", () => {
    const args = buildKanbanSessionReplacementArgs(
      session({ provider: "dsh", model: "claude-opus-5-5", reasoningEffort: "low" }),
      "claude",
      "workspace-1",
    );
    expect(args).toHaveLength(20);
    expect(args[1]).toBe("dsh");
    expect(args[5]).toBe("claude-opus-5-5");
    expect(args[19]).toBe("low");
    expect(args[0]).toBe("/tmp/repo");
    expect(args[11]).toBe("main");
  });

  it("falls back to the board provider for an old record without provider or effort", () => {
    const args = buildKanbanSessionReplacementArgs(session(), "dsh", "workspace-1");
    expect(args[1]).toBe("dsh");
    expect(args[19]).toBeUndefined();
    expect(args.slice(0, 6)).toEqual(["/tmp/repo", "dsh", undefined, "CRAFTER", "workspace-1", undefined]);
  });
});

describe("useEnsureKanbanAgentSession (C5)", () => {
  function setup(agentSessionId: string | null = null) {
    const createSession = vi.fn(async (..._args: unknown[]) => ({ sessionId: "agent-new" }));
    const openAgentPanel = vi.fn();
    const acp = { createSession } as unknown as UseAcpState & UseAcpActions;
    const { result } = renderHook(() => useEnsureKanbanAgentSession({
      acp,
      agentSessionId,
      boardAutoProviderId: "dsh",
      defaultRepoPath: "/tmp/repo",
      workspaceId: "workspace-1",
      openAgentPanel,
    }));
    return { ensure: result.current, createSession, openAgentPanel };
  }

  it.each([["high", "high"], [undefined, undefined], ["", undefined]])("effort %j -> argument 20 = %j", async (effort, expected) => {
    const { ensure, createSession, openAgentPanel } = setup();
    expect(await ensure(undefined, undefined, undefined, "claude-opus-5-5", effort)).toBe("agent-new");
    const args = createSession.mock.calls[0];
    expect(args[19]).toBe(expected);
    // F2: everything else is what the old inline callback sent.
    expect(args.slice(0, 17)).toEqual([
      "/tmp/repo", "dsh", undefined, "DEVELOPER", "workspace-1", "claude-opus-5-5",
      undefined, undefined, undefined, undefined, undefined, undefined,
      "full", [], undefined, undefined, true,
    ]);
    expect(openAgentPanel).toHaveBeenCalledWith("agent-new");
  });

  it("returns the open agent session without creating a new one", async () => {
    const { ensure, createSession } = setup("agent-open");
    expect(await ensure(undefined, undefined, undefined, undefined, "high")).toBe("agent-open");
    expect(createSession).not.toHaveBeenCalled();
  });
});
