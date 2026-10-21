import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hook mocks return stable references; fresh arrays per render would loop effects.
const { desktopAwareFetch, kanbanEvents, codebasesHook, publishKanbanTaskChanges, stable } = vi.hoisted(() => ({
  stable: {
    acp: { connected: true, loading: false, providers: [], connect: () => {} },
    workspaces: { workspaces: [], loading: false, createWorkspace: () => {} },
    codebases: [] as unknown[],
    router: { push: () => {} },
    params: { workspaceId: "workspace-1" },
    translation: { locale: "en", t: { workspace: { defaultWorkspace: "Default" }, feedback: {} } },
    lifecycle: () => {},
  },
  desktopAwareFetch: vi.fn(),
  kanbanEvents: {
    options: null as null | {
      onInvalidate: () => void;
      onTasksInvalidate?: (taskIds: string[]) => void;
    },
  },
  codebasesHook: { fetchCodebases: vi.fn(async () => {}) },
  publishKanbanTaskChanges: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => stable.params,
  useRouter: () => stable.router,
}));
vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch }));
vi.mock("@/client/hooks/use-kanban-events", () => ({
  useKanbanEvents: (options: typeof kanbanEvents.options) => {
    kanbanEvents.options = options;
  },
}));
vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => stable.acp,
}));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => stable.workspaces,
  useCodebases: () => ({ codebases: stable.codebases, fetchCodebases: codebasesHook.fetchCodebases }),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("../kanban-tab", () => ({ KanbanTab: () => null }));
vi.mock("../use-task-lifecycle-notifications", () => ({ useTaskLifecycleNotifications: () => stable.lifecycle }));
vi.mock("../kanban-task-change-signal", () => ({ publishKanbanTaskChanges }));
vi.mock("@/i18n", () => ({
  useTranslation: () => stable.translation,
}));

import { KanbanPageClient } from "../kanban-page-client";

function requestedPaths(): string[] {
  return desktopAwareFetch.mock.calls.map(([url]) => String(url).split("?")[0]);
}

describe("KanbanPageClient refresh fan-out", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
    codebasesHook.fetchCodebases.mockClear();
    publishKanbanTaskChanges.mockClear();
    kanbanEvents.options = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function renderAndSettle() {
    render(<KanbanPageClient />);
    await waitFor(() => {
      expect(requestedPaths()).toEqual(expect.arrayContaining(["/api/kanban/boards", "/api/tasks", "/api/sessions"]));
    });
    desktopAwareFetch.mockClear();
    codebasesHook.fetchCodebases.mockClear();
  }

  it("refetches only /api/tasks for a task invalidate", async () => {
    await renderAndSettle();

    await act(async () => {
      kanbanEvents.options?.onTasksInvalidate?.(["task-1"]);
    });

    await waitFor(() => {
      expect(requestedPaths()).toEqual(["/api/tasks"]);
    });
    expect(codebasesHook.fetchCodebases).not.toHaveBeenCalled();
    expect(publishKanbanTaskChanges).toHaveBeenCalledWith(["task-1"]);
  });

  it("keeps the full refresh for a board-level invalidate", async () => {
    await renderAndSettle();

    await act(async () => {
      kanbanEvents.options?.onInvalidate();
    });

    await waitFor(() => {
      expect(requestedPaths()).toEqual(expect.arrayContaining(["/api/kanban/boards", "/api/tasks", "/api/sessions"]));
    });
    expect(codebasesHook.fetchCodebases).toHaveBeenCalledTimes(1);
  });
});
