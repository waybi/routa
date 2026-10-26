/**
 * Card 87810657 (AC6): the new-card modal has a model · effort picker; the
 * pick is sent as assignedModel / assignedReasoningEffort in POST /api/tasks,
 * an empty pick leaves both fields out.
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import { resetModelEffortChoicesCache } from "../kanban-model-effort-fields";
import type { KanbanBoardInfo } from "../../types";
import { draftModelEffortFields, EMPTY_DRAFT } from "../../kanban-create-modal";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  MouseSensor: class {},
  TouchSensor: class {},
  closestCorners: vi.fn(),
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn(), transform: null }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));
// TipTap does not run in jsdom: a textarea stands in for the objective editor.
const editorState = vi.hoisted(() => ({ onUpdate: null as null | ((args: { editor: { getHTML: () => string } }) => void) }));
vi.mock("@tiptap/react", () => ({
  useEditor: (config: { onUpdate: (args: { editor: { getHTML: () => string } }) => void }) => {
    editorState.onUpdate = config.onUpdate;
    return null;
  },
  EditorContent: () => (
    <textarea
      data-testid="objective-editor"
      onChange={(event) => editorState.onUpdate?.({ editor: { getHTML: () => `<p>${event.target.value}</p>` } })}
    />
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ workspaceId: "workspace-1" }),
  usePathname: () => "/workspace/workspace-1/kanban",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});
vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
  shortenRepoPath: (value: string) => value,
}));
vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return { useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus };
});

const board = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Board",
  isDefault: true,
  autoProviderId: "dsh",
  sessionConcurrencyLimit: 1,
  queue: { runningCount: 0, runningCards: [], queuedCount: 0, queuedCardIds: [], queuedCards: [], queuedPositions: {} },
  columns: [{ id: "backlog", name: "Backlog", position: 0, stage: "backlog" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as KanbanBoardInfo;

const providers = [
  { id: "dsh", name: "DeepSeek Harness", description: "", command: "dsh", status: "available" as const },
  { id: "claude", name: "Claude Code", description: "", command: "claude", status: "available" as const },
];
const acp = { connected: true, loading: false, error: null, updates: [], selectedProvider: "dsh", providers, setProvider: vi.fn(), selectSession: vi.fn() } as unknown as UseAcpState & UseAcpActions;

const MODEL_VALUE = "[\"local-7357\",\"claude-opus-5-5\"]";
const CONFIG_OPTIONS = {
  configOptions: [
    { id: "model", name: "Model", type: "select", currentValue: MODEL_VALUE, options: [{ value: MODEL_VALUE, name: "Claude Opus 5.5" }] },
    { id: "reasoning_effort", name: "Reasoning", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }] },
  ],
};

function json(status: number, body: unknown): Response {
  return { ok: status < 300, status, json: async () => body } as Response;
}

function mockFetch() {
  desktopAwareFetch.mockReset();
  desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/providers/") && url.includes("config-options")) return json(200, CONFIG_OPTIONS);
    if (url === "/api/tasks" && init?.method === "POST") {
      return json(200, { task: { id: "t-new", title: "Demo", status: "PENDING", boardId: "board-1", columnId: "backlog", createdAt: "2026-01-01T00:00:00.000Z" } });
    }
    return json(200, {});
  });
}

function postedTaskBody(): Record<string, unknown> {
  const call = desktopAwareFetch.mock.calls.find(([url, init]) => String(url) === "/api/tasks" && (init as RequestInit | undefined)?.method === "POST");
  expect(call).toBeTruthy();
  return JSON.parse(String((call![1] as RequestInit).body));
}

async function openAndFill() {
  renderTab();
  fireEvent.click(screen.getByRole("button", { name: "Manual" }));
  fireEvent.change(await screen.findByPlaceholderText("Task title"), { target: { value: "Demo card" } });
  fireEvent.change(screen.getByTestId("objective-editor"), { target: { value: "Demo objective" } });
}

function renderTab() {
  render(
    <KanbanTab
      workspaceId="workspace-1"
      boards={[board]}
      tasks={[]}
      sessions={[]}
      acp={acp}
      providers={providers}
      specialists={[]}
      codebases={[]}
      onRefresh={vi.fn()}
      onAgentPrompt={vi.fn(async () => null)}
    />,
  );
}

beforeEach(() => {
  resetModelEffortChoicesCache();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/workspace/workspace-1/kanban");
  mockFetch();
});

describe("draftModelEffortFields (AC6)", () => {
  it("sends picked values and leaves empty ones out", () => {
    expect(draftModelEffortFields({ ...EMPTY_DRAFT, assignedModel: "claude-opus-5-5", assignedReasoningEffort: "medium" }))
      .toEqual({ assignedModel: "claude-opus-5-5", assignedReasoningEffort: "medium" });
    expect(draftModelEffortFields({ ...EMPTY_DRAFT, assignedModel: "", assignedReasoningEffort: "" })).toEqual({});
    expect(draftModelEffortFields(EMPTY_DRAFT)).toEqual({});
  });
});

describe("new-card modal model · effort picker (AC6 / C6)", () => {
  async function submitWith(pick: boolean) {
    await openAndFill();
    const picker = await screen.findByTestId("kanban-create-model-effort");
    expect(screen.getByTestId("kanban-create-model-effort-field")).toBeTruthy();
    if (pick) {
      await waitFor(() => expect(picker.hasAttribute("disabled")).toBe(false));
      fireEvent.click(picker);
      const models = await screen.findAllByTestId("kanban-create-model-effort-model-option");
      fireEvent.click(models.find((node) => node.textContent?.includes("Claude Opus 5.5"))!);
      if (!screen.queryByTestId("kanban-create-model-effort-panel")) fireEvent.click(picker);
      const efforts = await screen.findAllByTestId("kanban-create-model-effort-effort-option");
      fireEvent.click(efforts.find((node) => node.textContent?.includes("Medium"))!);
    }
    const submit = screen.getByTestId("kanban-create-submit") as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(postedTaskBody()).toBeTruthy());
    return postedTaskBody();
  }

  it("posts assignedModel and assignedReasoningEffort for a pick", async () => {
    const body = await submitWith(true);
    expect(body.assignedModel).toBe("claude-opus-5-5");
    expect(body.assignedReasoningEffort).toBe("medium");
    expect(body).toMatchObject({ title: "Demo card", objective: "Demo objective", creationSource: "manual" });
  });

  it("leaves both fields out without a pick (F2: other fields unchanged)", async () => {
    const body = await submitWith(false);
    expect("assignedModel" in body).toBe(false);
    expect("assignedReasoningEffort" in body).toBe(false);
    // Same keys as before the change (repoPath is undefined without codebases, so JSON drops it).
    expect(Object.keys(body).sort()).toEqual([
      "boardId", "codebaseIds", "createGitHubIssue", "creationSource", "labels", "objective",
      "priority", "testCases", "title", "workspaceId",
    ]);
  });

  it("renders with the board provider's options and keeps the old fields", async () => {
    await openAndFill();
    await screen.findByTestId("kanban-create-model-effort");
    expect(desktopAwareFetch.mock.calls.some(([url]) => String(url).includes("/providers/dsh/config-options"))).toBe(true);
    expect(screen.getByTestId("kanban-create-submit")).toBeTruthy();
    expect(screen.getByTestId("kanban-create-model-effort-label").textContent).toContain("Use lane default");
  });
});
