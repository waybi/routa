/**
 * Card 87810657 (AC3): handleAgentPrompt passes the dispatch bar's model as
 * createSession argument 6 and reasoningEffort as argument 20.
 */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanAgentPromptHandler } from "../../types";

const { stable, captured } = vi.hoisted(() => ({
  stable: {
    acp: {
      connected: true,
      loading: false,
      selectedProvider: "dsh",
      providers: [{ id: "dsh", status: "available" }],
      connect: async () => {},
      setProvider: () => {},
      createSession: (() => {}) as unknown as (...args: unknown[]) => Promise<{ sessionId: string } | null>,
      promptSession: async () => {},
    },
    workspaces: { workspaces: [], loading: false, createWorkspace: () => {} },
    codebases: [{ id: "cb", repoPath: "/tmp/repo", isDefault: true }] as unknown[],
    router: { push: () => {} },
    params: { workspaceId: "workspace-1" },
    translation: { locale: "en", t: { workspace: { defaultWorkspace: "Default" }, feedback: {} } },
    lifecycle: () => {},
  },
  captured: { onAgentPrompt: null as KanbanAgentPromptHandler | null },
}));

vi.mock("next/navigation", () => ({
  useParams: () => stable.params,
  useRouter: () => stable.router,
}));
vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));
vi.mock("@/client/hooks/use-kanban-events", () => ({ useKanbanEvents: () => {} }));
vi.mock("@/client/hooks/use-acp", () => ({ useAcp: () => stable.acp }));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => stable.workspaces,
  useCodebases: () => ({ codebases: stable.codebases, fetchCodebases: async () => {} }),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("../kanban-tab", () => ({
  KanbanTab: ({ onAgentPrompt }: { onAgentPrompt: KanbanAgentPromptHandler }) => {
    captured.onAgentPrompt = onAgentPrompt;
    return null;
  },
}));
vi.mock("../use-task-lifecycle-notifications", () => ({ useTaskLifecycleNotifications: () => stable.lifecycle }));
vi.mock("../kanban-task-change-signal", () => ({ publishKanbanTaskChanges: () => {} }));
vi.mock("@/i18n", () => ({ useTranslation: () => stable.translation }));

import { KanbanPageClient } from "../kanban-page-client";

const createSession = vi.fn(async (..._args: unknown[]) => ({ sessionId: "session-new" }));

beforeEach(() => {
  createSession.mockClear();
  stable.acp.createSession = createSession;
  captured.onAgentPrompt = null;
});

async function prompt(options: Parameters<KanbanAgentPromptHandler>[1]) {
  render(<KanbanPageClient />);
  await waitFor(() => expect(captured.onAgentPrompt).toBeTruthy());
  const sessionId = await captured.onAgentPrompt!("Plan it", options);
  expect(sessionId).toBe("session-new");
  expect(createSession).toHaveBeenCalledTimes(1);
  return createSession.mock.calls[0];
}

describe("handleAgentPrompt → acp.createSession (AC3)", () => {
  it("passes model as argument 6 and reasoningEffort as argument 20", async () => {
    const args = await prompt({ provider: "dsh", role: "CRAFTER", model: "claude-opus-5-5", reasoningEffort: "high", boardId: "board-1" });
    expect(args[1]).toBe("dsh");
    expect(args[5]).toBe("claude-opus-5-5");
    expect(args[19]).toBe("high");
    expect(args[18]).toBe("board-1");
  });

  it("keeps both undefined when nothing was picked (F2: other arguments unchanged)", async () => {
    const args = await prompt({ provider: "dsh", role: "CRAFTER", toolMode: "full", mcpProfile: "kanban-planning", boardId: "board-1" });
    expect(args[5]).toBeUndefined();
    expect(args[19]).toBeUndefined();
    expect(args.slice(0, 5)).toEqual(["/tmp/repo", "dsh", undefined, "CRAFTER", "workspace-1"]);
    expect(args[12]).toBe("full");
    expect(args[14]).toBe("kanban-planning");
    expect(args[16]).toBe(true);
  });
});
