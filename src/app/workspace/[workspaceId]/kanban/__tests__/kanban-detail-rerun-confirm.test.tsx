/**
 * Card fd27d00c: with a running step in the card's lane the detail button reads
 * "End & rerun", asks first, and sends force. Without one it is unchanged.
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogProvider } from "@/client/components/confirm-dialog";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { KanbanDetailExecution } from "../kanban-detail-execution";
import { KanbanTab } from "../kanban-tab";
import { TaskPatchError } from "../use-kanban-card-move";
import { useKanbanRetryPending } from "../use-kanban-retry-feedback";
import type { KanbanBoardInfo, KanbanColumnInfo, TaskInfo } from "../../types";
import { classifyRetryResponse } from "../../overview/inbox-retry";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

const { desktopAwareFetch, toast } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  MouseSensor: class {},
  TouchSensor: class {},
  closestCorners: vi.fn(),
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn(), transform: null }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));
vi.mock("@/client/utils/diagnostics", async () => ({
  ...(await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics")),
  desktopAwareFetch,
}));
vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
  shortenRepoPath: (value: string) => value,
}));
vi.mock("@/client/components/toast", () => ({ toast }));
vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return { useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus };
});
vi.mock("../use-task-runs", () => ({ useTaskRuns: () => ({ runs: null, error: null }) }));

const devColumn: KanbanColumnInfo = {
  id: "dev",
  name: "Dev",
  position: 2,
  stage: "dev",
  automation: { enabled: true, steps: [{ id: "s1", providerId: "claude", role: "CRAFTER" }] },
};

type Lane = NonNullable<TaskInfo["laneSessions"]>[number];
const lane = (sessionId: string, columnId: string, status: Lane["status"]): Lane => ({
  sessionId, columnId, columnName: columnId, status, startedAt: "2026-10-29T00:00:00.000Z",
});

function devTask(laneSessions: Lane[]): TaskInfo {
  return createDetailTask("task-1", "Story", { columnId: "dev", laneSessions, sessionIds: laneSessions.map((e) => e.sessionId) });
}

function renderExecution(task: TaskInfo, onRetryTrigger: (taskId: string, options?: { force?: boolean }) => Promise<void> = vi.fn(async () => undefined)) {
  const view = render(
    <ConfirmDialogProvider>
      <KanbanDetailExecution
        task={task}
        lane={devColumn}
        boardColumns={[devColumn]}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        onPatchTask={vi.fn(async () => task)}
        onRetryTrigger={onRetryTrigger}
      />
    </ConfirmDialogProvider>,
  );
  return { ...view, onRetryTrigger: onRetryTrigger as ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("C8: running step in this lane", () => {
  it("renders End & rerun, enabled, and sends nothing until clicked", () => {
    const { onRetryTrigger } = renderExecution(devTask([lane("s1", "dev", "running")]));
    const button = screen.getByTestId("kanban-detail-run");
    expect(button.textContent).toBe("End & rerun");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(onRetryTrigger).not.toHaveBeenCalled();
  });

  it("asks through the in-app dialog (not window.confirm), then force-reruns on confirm", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    const { onRetryTrigger } = renderExecution(devTask([lane("s1", "dev", "running")]));

    fireEvent.click(screen.getByTestId("kanban-detail-run"));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("End the running builder?");
    expect(onRetryTrigger).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(onRetryTrigger).toHaveBeenCalledTimes(1));
    expect(onRetryTrigger).toHaveBeenCalledWith("task-1", { force: true });
  });

  it("sends nothing when the dialog is cancelled", async () => {
    const { onRetryTrigger } = renderExecution(devTask([lane("s1", "dev", "running")]));
    fireEvent.click(screen.getByTestId("kanban-detail-run"));
    await screen.findByTestId("confirm-dialog");
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull());
    expect(onRetryTrigger).not.toHaveBeenCalled();
  });
});

describe("no running step in this lane: unchanged (F2-8)", () => {
  it.each([
    ["no runs yet", [], "Run"],
    ["finished run in this lane", [lane("s1", "dev", "completed")], "Rerun"],
    ["running step in another lane", [lane("s1", "review", "running")], "Rerun"],
  ] as const)("%s: plain label, no dialog, no force", async (_name, laneSessions, label) => {
    const { onRetryTrigger } = renderExecution(devTask([...laneSessions]));
    const button = screen.getByTestId("kanban-detail-run");
    expect(button.textContent?.toLowerCase()).toBe(label.toLowerCase());
    fireEvent.click(button);
    await waitFor(() => expect(onRetryTrigger).toHaveBeenCalledTimes(1));
    expect(onRetryTrigger).toHaveBeenCalledWith("task-1");
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });
});

describe("C10 / C11 / C16: look and busy state", () => {
  it("keeps the same button class, no icon, and no extra execution content when a step runs", () => {
    const plain = renderExecution(devTask([lane("s1", "dev", "completed")]));
    const plainButton = screen.getByTestId("kanban-detail-run");
    const plainClass = plainButton.className;
    const plainText = screen.getByTestId("kanban-detail-execution-settings").textContent?.replace(/Rerun|End & rerun/, "");
    plain.unmount();

    renderExecution(devTask([lane("s1", "dev", "running")]));
    const button = screen.getByTestId("kanban-detail-run");
    expect(button.className).toBe(plainClass);
    expect(button.querySelector("svg")).toBeNull();
    expect(screen.getByTestId("kanban-detail-execution-settings").textContent?.replace(/Rerun|End & rerun/, "")).toBe(plainText);
  });

  it("after confirming, shows Starting… disabled and aria-busy until the request settles", async () => {
    let settle: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { settle = resolve; });
    renderExecution(devTask([lane("s1", "dev", "running")]), vi.fn(() => pending));
    fireEvent.click(screen.getByTestId("kanban-detail-run"));
    await screen.findByTestId("confirm-dialog");
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(screen.getByTestId("kanban-detail-run").textContent).toBe("Starting…"));
    const button = screen.getByTestId("kanban-detail-run");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await act(async () => settle());
  });
});

describe("force reaches the PATCH body (AC6)", () => {
  it("KanbanTab sends retryTrigger and force after the user confirms", async () => {
    const tabBoard: KanbanBoardInfo = {
      ...detailBoard,
      columns: [{ ...devColumn, position: 0 }],
    };
    const task = devTask([lane("s1", "dev", "running")]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH" && String(input) === "/api/tasks/task-1") {
        return { ok: true, json: async () => ({ task: { ...task, triggerSessionId: "s2" } }) } as Response;
      }
      return { ok: true, json: async () => ({ artifacts: [], runs: [] }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const acp = {
      connected: true, sessionId: null, updates: [], providers: [], selectedProvider: "claude", loading: false,
      error: null, authError: null, dockerConfigError: null, connect: vi.fn(), createSession: vi.fn(),
      resumeSession: vi.fn(), forkSession: vi.fn(), selectSession: vi.fn(), setProvider: vi.fn(), setMode: vi.fn(),
      prompt: vi.fn(), promptSession: vi.fn(), respondToUserInput: vi.fn(), respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(), resizeTerminal: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
      clearAuthError: vi.fn(), clearDockerConfigError: vi.fn(), listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ConfirmDialogProvider>
        <KanbanTab
          workspaceId="workspace-1"
          boards={[tabBoard]}
          tasks={[task]}
          sessions={[]}
          providers={[{ id: "claude", name: "Claude Code", description: "Claude Code provider", command: "claude", status: "available" }]}
          specialists={[]}
          codebases={[]}
          onRefresh={vi.fn()}
          acp={acp}
        />
      </ConfirmDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Story" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Execution" }));
    const run = await screen.findByTestId("kanban-detail-run");
    expect(run.textContent).toBe("End & rerun");
    const patchCalls = () => fetchMock.mock.calls.filter(([input, init]) => init?.method === "PATCH" && String(input).startsWith("/api/tasks/"));
    expect(patchCalls()).toHaveLength(0);

    fireEvent.click(run);
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(JSON.parse(String(patchCalls()[0][1]?.body))).toMatchObject({ retryTrigger: true, force: true });
  });
});

describe("C9: a 409 step_running reply", () => {
  it("shows the info toast, not the failure toast", async () => {
    const { result } = renderHook(() => useKanbanRetryPending({ tasks: [], sessionMap: new Map() }));
    const error = new TaskPatchError("Failed to update task", { reason: "step_running" });
    await expect(result.current.trackRetry("task-1", async () => { throw error; })).rejects.toBe(error);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(String(toast.info.mock.calls[0][1]?.description)).toContain("End & rerun");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("other failures still show the failure toast", async () => {
    const { result } = renderHook(() => useKanbanRetryPending({ tasks: [], sessionMap: new Map() }));
    await expect(result.current.trackRetry("task-1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("F4-8 / C26: the overview inbox on a 409 step_running reply", () => {
  it("returns a readable failed row and does not throw", () => {
    const body = { retrySkipped: true, reason: "step_running", sessionId: "S1", task: { id: "task-1" } };
    expect(classifyRetryResponse(false, body, 409)).toEqual({ phase: "failed", error: "HTTP 409" });
  });
});
