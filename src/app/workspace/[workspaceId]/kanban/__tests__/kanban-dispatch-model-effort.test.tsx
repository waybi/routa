/**
 * Card 87810657 (AC2/AC3): the dispatch bar has a model · effort picker next
 * to the provider dropdown, and the pick reaches acp.createSession as the 6th
 * (model) and 20th (reasoningEffort) arguments. Empty pick = undefined.
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import { useKanbanAgentInput } from "../use-kanban-agent-input";
import { getKanbanTaskAgentCopy } from "../i18n/kanban-task-agent";
import { resetModelEffortChoicesCache } from "../kanban-model-effort-fields";
import type { KanbanAgentPromptOptions, KanbanBoardInfo } from "../../types";
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
    { id: "reasoning_effort", name: "Reasoning", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
  ],
};

function json(status: number, body: unknown): Response {
  return { ok: status < 300, status, json: async () => body } as Response;
}

function mockFetch(configOptionsStatus: number) {
  desktopAwareFetch.mockReset();
  desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/providers/") && url.includes("config-options")) {
      return configOptionsStatus === 200 ? json(200, CONFIG_OPTIONS) : json(configOptionsStatus, { error: "x" });
    }
    return json(200, {});
  });
}

function renderTab(onAgentPrompt = vi.fn(async (_prompt: string, _options?: KanbanAgentPromptOptions) => null as string | null)) {
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
      onAgentPrompt={onAgentPrompt}
    />,
  );
  return onAgentPrompt;
}

beforeEach(() => {
  resetModelEffortChoicesCache();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/workspace/workspace-1/kanban");
});

describe("dispatch bar model · effort picker (AC2)", () => {
  it("renders next to the old controls, with hover text and no visible explanation", async () => {
    mockFetch(200);
    renderTab();
    const bar = screen.getByTestId("kanban-dispatch-bar");
    const picker = await waitFor(() => {
      const node = bar.querySelector("[data-testid='kanban-dispatch-model-effort']");
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    for (const id of ["kanban-agent-provider", "kanban-agent-input", "kanban-agent-submit"]) {
      expect(bar.querySelector(`[data-testid='${id}']`)).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Manual" })).toBeTruthy();
    const copy = getKanbanTaskAgentCopy("en");
    expect(picker.getAttribute("title")).toContain(copy.modelEffortHint);
    expect(bar.textContent).not.toContain(copy.modelEffortHint);
    await waitFor(() => expect(picker.hasAttribute("disabled")).toBe(false));
    // Options come from the board provider's config-options.
    expect(desktopAwareFetch.mock.calls.some(([url]) => String(url).includes("/providers/dsh/config-options"))).toBe(true);
  });

  it("has zh-CN and en hover copy", () => {
    for (const lang of ["en", "zh-CN"] as const) {
      const copy = getKanbanTaskAgentCopy(lang);
      for (const key of ["modelEffortAriaLabel", "modelEffortDefault", "modelEffortHint", "modelEffortUnsupported"]) {
        expect(copy[key]?.length).toBeGreaterThan(0);
      }
    }
    expect(getKanbanTaskAgentCopy("zh-CN").modelEffortHint).not.toBe(getKanbanTaskAgentCopy("en").modelEffortHint);
  });

  it.each([500, 404])("falls back to default and still dispatches when config-options answers %i", async (status) => {
    mockFetch(status);
    const onAgentPrompt = renderTab();
    const picker = await screen.findByTestId("kanban-dispatch-model-effort");
    expect(screen.getByTestId("kanban-dispatch-model-effort-label").textContent).toContain("Default");
    expect(picker).toBeTruthy();
    fireEvent.change(screen.getByTestId("kanban-agent-input"), { target: { value: "Plan it" } });
    expect((screen.getByTestId("kanban-agent-submit") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("kanban-agent-submit"));
    await waitFor(() => expect(onAgentPrompt).toHaveBeenCalledTimes(1));
    const options = onAgentPrompt.mock.calls[0][1];
    expect(options?.model).toBeUndefined();
    expect(options?.reasoningEffort).toBeUndefined();
  });

  it("sends the picked model and effort with the dispatch", async () => {
    mockFetch(200);
    const onAgentPrompt = renderTab();
    const picker = await screen.findByTestId("kanban-dispatch-model-effort");
    await waitFor(() => expect(picker.hasAttribute("disabled")).toBe(false));
    fireEvent.click(picker);
    const modelOptions = await screen.findAllByTestId("kanban-dispatch-model-effort-model-option");
    fireEvent.click(modelOptions.find((node) => node.textContent?.includes("Claude Opus 5.5"))!);
    if (!screen.queryByTestId("kanban-dispatch-model-effort-panel")) fireEvent.click(picker);
    const effortOptions = await screen.findAllByTestId("kanban-dispatch-model-effort-effort-option");
    fireEvent.click(effortOptions.find((node) => node.textContent?.includes("High"))!);
    fireEvent.change(screen.getByTestId("kanban-agent-input"), { target: { value: "Plan it" } });
    fireEvent.click(screen.getByTestId("kanban-agent-submit"));
    await waitFor(() => expect(onAgentPrompt).toHaveBeenCalledTimes(1));
    const options = onAgentPrompt.mock.calls[0][1];
    expect(options?.model).toBe("claude-opus-5-5");
    expect(options?.reasoningEffort).toBe("high");
    expect(options?.provider).toBe("dsh");
  });
});

describe("useKanbanAgentInput forwards the pick (AC3)", () => {
  function setup() {
    const onAgentPrompt = vi.fn(async (_prompt: string, _options?: KanbanAgentPromptOptions) => "session-1" as string | null);
    const { result } = renderHook(() => useKanbanAgentInput({
      workspaceId: "workspace-1",
      selectedBoardId: "board-1",
      defaultBoardId: "board-1",
      defaultCodebase: null,
      boardAutoProviderId: "dsh",
      specialistLanguage: "en",
      ensureBoardAutoProviderPersisted: async () => {},
      openAgentPanel: vi.fn(),
      onAgentPrompt,
      onRefresh: vi.fn(),
    }));
    act(() => result.current.setAgentInput("Plan it"));
    return { result, onAgentPrompt };
  }

  it("passes model and reasoningEffort through unchanged", async () => {
    const { result, onAgentPrompt } = setup();
    await act(async () => {
      await result.current.handleAgentSubmit({ model: "claude-opus-5-5", reasoningEffort: "high" });
    });
    expect(onAgentPrompt.mock.calls[0][1]).toMatchObject({ provider: "dsh", model: "claude-opus-5-5", reasoningEffort: "high" });
  });

  it.each([[undefined], [{ model: "", reasoningEffort: "" }]])("leaves both undefined for an empty pick (%j)", async (pick) => {
    const { result, onAgentPrompt } = setup();
    await act(async () => {
      await result.current.handleAgentSubmit(pick);
    });
    const options = onAgentPrompt.mock.calls[0][1];
    expect(options?.model).toBeUndefined();
    expect(options?.reasoningEffort).toBeUndefined();
    expect(options).toMatchObject({ provider: "dsh", role: "CRAFTER", toolMode: "full", mcpProfile: "kanban-planning" });
  });
});
