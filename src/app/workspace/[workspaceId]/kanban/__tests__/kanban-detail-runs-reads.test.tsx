import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { KanbanTab } from "../kanban-tab";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";

/**
 * Card 8a2d2555 AC9 / C6 ⑥ / F2-d: opening a card detail with its session
 * pane (run bar + chat panel) reads the runs ledger as often as on the
 * baseline 633b6437 and writes nothing to /api/tasks. Imports only what the
 * baseline also has, so this file runs unchanged on the baseline commit.
 */

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return { useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus };
});

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  desktopAwareFetch.mockImplementation(async () => new Response(JSON.stringify({ runs: [], artifacts: [] }), { status: 200 }));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", "/workspace/workspace-1/kanban?taskId=task-1");
});

const acp = {
  connected: true,
  sessionId: null,
  updates: [],
  providers: [{ id: "claude", name: "Claude Code", description: "", command: "claude" }],
  selectedProvider: "claude",
  loading: false,
  error: null,
  authError: null,
  dockerConfigError: null,
  connect: vi.fn(),
  createSession: vi.fn(),
  resumeSession: vi.fn(),
  forkSession: vi.fn(),
  selectSession: vi.fn(),
  setProvider: vi.fn(),
  setMode: vi.fn(),
  prompt: vi.fn(),
  promptSession: vi.fn(),
  respondToUserInput: vi.fn(),
  respondToUserInputForSession: vi.fn(),
  writeTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
  cancel: vi.fn(),
  disconnect: vi.fn(),
  clearAuthError: vi.fn(),
  clearDockerConfigError: vi.fn(),
  listProviderModels: vi.fn(),
} satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

function countCalls(match: (url: string, method: string) => boolean): number {
  return desktopAwareFetch.mock.calls.filter(([input, init]) => (
    match(String(input), String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase())
  )).length;
}

describe("opening a detail with its session pane", () => {
  it("reads /api/tasks/<id>/runs as often as the baseline and writes nothing", async () => {
    const task = createDetailTask("task-1", "Story One", {
      sessionIds: ["s-1", "s-2"],
      triggerSessionId: "s-2",
      laneSessions: [
        { sessionId: "s-1", columnId: "backlog", columnName: "Backlog", status: "completed", startedAt: "2026-10-21T00:00:00.000Z" },
        { sessionId: "s-2", columnId: "backlog", columnName: "Backlog", status: "completed", startedAt: "2026-10-22T00:00:00.000Z" },
      ],
    });
    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[detailBoard]}
        tasks={[task]}
        sessions={[]}
        providers={acp.providers}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
        acp={acp}
      />,
    );
    await screen.findByTestId("kanban-card-detail");
    await screen.findByTestId("kanban-session-pane-top-row");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const runReads = countCalls((url, method) => /\/api\/tasks\/task-1\/runs/.test(url) && method === "GET");
    console.info(`[runs-reads] /api/tasks/task-1/runs GET = ${runReads}`);
    expect(runReads).toBe(RUN_READS_ON_BASELINE);
    expect(countCalls((url, method) => url.includes("/api/tasks") && (method === "PATCH" || method === "POST"))).toBe(0);
  });
});

// Measured by running this file on 633b6437 (see the card's evidence table).
const RUN_READS_ON_BASELINE = 1;
