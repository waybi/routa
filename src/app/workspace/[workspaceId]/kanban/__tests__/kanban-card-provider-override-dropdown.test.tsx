import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanCardDetail } from "../kanban-card-detail";
import { resetModelEffortChoicesCache } from "../kanban-model-effort-fields";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Default Board",
  isDefault: true,
  sessionConcurrencyLimit: 1,
  queue: {
    runningCount: 0,
    runningCards: [],
    queuedCount: 0,
    queuedCardIds: [],
    queuedCards: [],
    queuedPositions: {},
  },
  columns: [
    { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function createTask(id: string, title: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title,
    objective: `${title} objective`,
    status: "PENDING",
    boardId: board.id,
    columnId: "backlog",
    position: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("KanbanCardDetail provider override", () => {
  it("uses the ACP provider dropdown for card session overrides", async () => {
    const onPatchTask = vi.fn(async (_taskId: string, payload: Record<string, unknown>) =>
      createTask("task-provider", "Story Provider", payload as Partial<TaskInfo>),
    );

    render(
      <KanbanCardDetail
        task={createTask("task-provider", "Story Provider")}
        boardColumns={board.columns}
        availableProviders={[{
          id: "claude",
          name: "Claude Code",
          description: "Claude provider",
          command: "claude",
          status: "available",
        }]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    fireEvent.click(screen.getByText("Card session override").closest("summary")!);

    const providerDropdown = screen.getByTestId("kanban-detail-provider-override");
    expect(providerDropdown.tagName).toBe("BUTTON");
    expect(providerDropdown.textContent).toContain("Use lane default");

    fireEvent.click(providerDropdown);
    fireEvent.click(await screen.findByRole("button", { name: /Claude Code/ }));

    await waitFor(() => {
      expect(onPatchTask).toHaveBeenCalledWith("task-provider", {
        assignedProvider: "claude",
        assignedRole: "DEVELOPER",
      });
    });
  });
});

describe("KanbanCardDetail model and reasoning effort override", () => {
  const configOptions = {
    configOptions: [
      {
        id: "model",
        options: [
          { value: "[\"local-7357\",\"claude-opus-5-5\"]", name: "Claude Opus 5.5" },
          { value: "[\"local-7357\",\"gpt-6.1-sol\"]", name: "GPT 6.1 Sol" },
        ],
      },
      { id: "reasoning_effort", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
    ],
  };
  const laneBoardColumns: KanbanBoardInfo["columns"] = [{
    id: "dev",
    name: "Dev",
    position: 0,
    stage: "dev",
    automation: { enabled: true, steps: [{ id: "dev-1", providerId: "codex", role: "DEVELOPER" }] },
  }];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetModelEffortChoicesCache();
    fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify(configOptions),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetModelEffortChoicesCache();
  });

  const renderDetail = (task: TaskInfo, onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>) => {
    render(
      <KanbanCardDetail
        task={task}
        boardColumns={laneBoardColumns}
        availableProviders={[]}
        specialists={[]}
        specialistLanguage="en"
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        sessions={[]}
        fullWidth
        onPatchTask={onPatchTask}
        onRetryTrigger={vi.fn()}
        onDelete={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Execution" }));
    fireEvent.click(screen.getByText("Card session override").closest("summary")!);
  };

  const picker = () => screen.getByTestId("kanban-detail-override-model-effort");
  const pickerLabel = () => screen.getByTestId("kanban-detail-override-model-effort-label").textContent;

  it("loads options from the lane step provider and patches only the changed field", async () => {
    const onPatchTask = vi.fn(async (_taskId: string, payload: Record<string, unknown>) =>
      createTask("task-model", "Story Model", { columnId: "dev", ...payload } as Partial<TaskInfo>),
    );
    renderDetail(createTask("task-model", "Story Model", { columnId: "dev" }), onPatchTask);

    expect(screen.getByText("Model / reasoning effort override")).toBeTruthy();
    expect(screen.queryByTestId("kanban-detail-override-model")).toBeNull();
    expect(pickerLabel()).toBe("Use lane default · Use lane default");
    await waitFor(() => expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/providers/codex/config-options"));

    fireEvent.click(picker());
    fireEvent.click(await screen.findByRole("option", { name: "GPT 6.1 Sol" }));
    await waitFor(() => expect(onPatchTask).toHaveBeenCalledWith("task-model", { assignedModel: "gpt-6.1-sol" }));
    expect(onPatchTask).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    await waitFor(() => expect(onPatchTask).toHaveBeenCalledWith("task-model", { assignedReasoningEffort: "high" }));
  });

  it("sends null to clear when Use lane default is chosen and shows the stored value", async () => {
    const onPatchTask = vi.fn(async (_taskId: string, payload: Record<string, unknown>) =>
      createTask("task-model", "Story Model", payload as Partial<TaskInfo>),
    );
    renderDetail(createTask("task-model", "Story Model", {
      columnId: "dev",
      assignedModel: "claude-opus-5-5",
      assignedReasoningEffort: "low",
    }), onPatchTask);

    await waitFor(() => expect(pickerLabel()).toBe("Claude Opus 5.5 · Low"));
    fireEvent.click(picker());
    expect(screen.getByRole("option", { name: "Claude Opus 5.5" }).getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByTestId("kanban-detail-override-model-effort-panel");
    expect(within(panel).getAllByRole("option")[0]?.textContent).toBe("Follow default");

    fireEvent.click(screen.getByRole("option", { name: "Follow default" }));
    await waitFor(() => expect(onPatchTask).toHaveBeenCalledWith("task-model", { assignedModel: null }));
    fireEvent.click(screen.getByRole("radio", { name: "Default" }));
    await waitFor(() => expect(onPatchTask).toHaveBeenCalledWith("task-model", { assignedReasoningEffort: null }));
  });
});
