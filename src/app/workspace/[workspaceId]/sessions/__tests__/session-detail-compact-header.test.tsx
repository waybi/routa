/**
 * Card a273fa68: the session detail page top is compressed. Planning
 * sessions keep "Sessions" / "Go to board" but inside the header row (no
 * separate action row); ChatPanel's session info (ID, Debug, Chat/Trace)
 * shares the Chat / Events / Evidence tab row, outside role="tablist", and
 * is hidden on the Events / Evidence tabs.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionPageClient } from "../[sessionId]/session-page-client";

const routerPush = vi.hoisted(() => vi.fn());
const sessionRecord = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useParams: () => ({ workspaceId: "default", sessionId: "session-1" }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workspace/default/sessions/session-1",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({ workspaces: [{ id: "default", title: "Default" }], loading: false, createWorkspace: vi.fn() }),
  useCodebases: () => ({ codebases: [] }),
}));
vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: true, loading: false, sessionId: "session-1", updates: [], providers: [], selectedProvider: "dsh",
    connect: vi.fn(), createSession: vi.fn(), resumeSession: vi.fn(), selectSession: vi.fn(), setProvider: vi.fn(), prompt: vi.fn(), promptSession: vi.fn(),
  }),
}));
vi.mock("@/client/hooks/use-notes", () => ({
  useNotes: () => ({ notes: [], connected: true, updateNote: vi.fn(), deleteNote: vi.fn() }),
}));

/** Stand-in for ChatPanel's portal mode: renders its info row into the slot it is given. */
function ChatPanelPortalProbe(props: Record<string, unknown>) {
  const [viewMode, setViewMode] = useState<"chat" | "trace">("chat");
  const target = props.sessionInfoPortalTarget as HTMLElement | null | undefined;
  const row = (
    <div data-testid="chat-session-info-row">
      <span title={String(props.activeSessionId)}>{String(props.activeSessionId)}</span>
      <a href={`/traces?sessionId=${String(props.traceSessionId)}&workspaceId=${String(props.activeWorkspaceId)}`} target="_blank" rel="noreferrer">Debug</a>
      <button type="button" aria-pressed={viewMode === "chat"} onClick={() => setViewMode("chat")}>Chat view</button>
      <button type="button" aria-pressed={viewMode === "trace"} onClick={() => setViewMode("trace")}>Trace view</button>
    </div>
  );
  return (
    <div data-testid="chat-panel" data-view-mode={viewMode} data-compact={String(props.compactSessionHeader)}>
      {props.compactSessionHeader && target ? createPortal(row, target) : null}
    </div>
  );
}
vi.mock("@/client/components/chat-panel", () => ({ ChatPanel: (props: Record<string, unknown>) => <ChatPanelPortalProbe {...props} /> }));
vi.mock("../[sessionId]/left-sidebar", () => ({ LeftSidebar: () => <aside data-testid="session-context-sidebar" /> }));
vi.mock("../[sessionId]/use-session-crafters", () => ({
  useSessionCrafters: () => ({ routaTasks: [], crafterAgents: [], activeCrafterId: null, concurrency: 1 }),
}));
vi.mock("../[sessionId]/use-session-page-bootstrap", () => ({ useSessionPageBootstrap: () => ({ specialists: [] }) }));
vi.mock("@/client/components/task-panel", () => ({ CraftersView: () => null }));
vi.mock("@/client/components/agent-install-panel", () => ({ AgentInstallPanel: () => null }));
vi.mock("@/client/components/specialist-manager", () => ({ SpecialistManager: () => null }));
vi.mock("@/client/components/settings-panel", () => ({
  DockerConfigModal: () => null, loadDefaultProviders: () => ({}), loadProviderConnectionConfig: () => ({}), getModelDefinitionByAlias: () => undefined,
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("../../kanban/kanban-card-artifacts", () => ({ KanbanCardArtifacts: () => null }));

beforeEach(() => {
  routerPush.mockClear();
  sessionRecord.value = { sessionId: "session-1", name: "Plan the board" };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/sessions/session-1") return { ok: true, json: async () => ({ session: sessionRecord.value }) } as Response;
    if (url.startsWith("/api/traces")) return { ok: true, json: async () => ({ traces: [], count: 0 }) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  }));
});

function header() {
  return screen.getByTestId("session-detail-header");
}

describe("session detail compact header", () => {
  it("planning session: Sessions / Go to board sit inside the header next to the context toggle", async () => {
    sessionRecord.value = { sessionId: "session-1", name: "Plan the board", mcpProfile: "kanban-planning" };
    render(<SessionPageClient />);
    const sessions = await waitFor(() => within(header()).getByTestId("session-planning-sessions"));
    const board = within(header()).getByTestId("session-planning-board");
    expect(sessions.textContent).toBe("Sessions");
    expect(board.textContent).toBe("Go to board");
    expect(within(header()).getByTestId("session-context-toggle")).toBeTruthy();
    // No separate action row: the header is the first row of the page content.
    expect(header().parentElement?.firstElementChild).toBe(header());

    fireEvent.click(sessions);
    expect(routerPush).toHaveBeenLastCalledWith("/workspace/default/sessions");
    fireEvent.click(board);
    expect(routerPush).toHaveBeenLastCalledWith("/workspace/default/kanban");
  });

  it("non-planning session: no Sessions / Go to board buttons", async () => {
    render(<SessionPageClient />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plan the board"));
    expect(screen.queryByTestId("session-planning-sessions")).toBeNull();
    expect(screen.queryByTestId("session-planning-board")).toBeNull();
    expect(within(header()).getByTestId("session-context-toggle")).toBeTruthy();
  });

  it("puts the session info row (Debug, Chat/Trace) on the tab row, outside the tablist, only on the Chat tab", async () => {
    render(<SessionPageClient />);
    expect(screen.getByTestId("chat-panel").getAttribute("data-compact")).toBe("true");
    const tablist = screen.getByRole("tablist");
    const tabRow = screen.getByTestId("tabs-row");
    const slot = screen.getByTestId("session-tabs-trailing");
    expect(tablist.parentElement).toBe(tabRow);
    expect(slot.parentElement).toBe(tabRow);
    expect(tablist.contains(slot)).toBe(false);

    const row = await waitFor(() => within(slot).getByTestId("chat-session-info-row"));
    expect(within(row).getByTitle("session-1")).toBeTruthy();
    const debug = within(row).getByRole("link", { name: "Debug" });
    expect(debug.getAttribute("href")).toBe("/traces?sessionId=session-1&workspaceId=default");
    expect(debug.getAttribute("target")).toBe("_blank");
    expect(within(tablist).queryByRole("link")).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: "Trace view" }));
    expect(screen.getByTestId("chat-panel").getAttribute("data-view-mode")).toBe("trace");
    fireEvent.click(within(row).getByRole("button", { name: "Chat view" }));
    expect(screen.getByTestId("chat-panel").getAttribute("data-view-mode")).toBe("chat");

    expect(slot.hidden).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(slot.hidden).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(slot.hidden).toBe(false);
    // Arrow keys still move between the three tabs only.
    screen.getByRole("tab", { name: "Chat" }).focus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Chat" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Evidence" }).getAttribute("aria-selected")).toBe("true");
  });
});
