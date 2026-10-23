/**
 * Session detail layout (card 7, AC1 / AC6 / AC7): context sidebar sits on
 * the right of the chat column, folds when the canvas / CRAFTERs column
 * opens, opens as a right-hand drawer on narrow screens and closes with Esc
 * or the overlay, returning focus to the toggle.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionPageClient } from "../[sessionId]/session-page-client";

const crafterState = vi.hoisted(() => ({ agents: [] as Array<{ id: string }> }));
const sessionRecord = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ workspaceId: "default", sessionId: "session-1" }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workspace/default/sessions/session-1",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: "default", title: "Default Workspace", status: "active", metadata: {}, createdAt: "", updatedAt: "" }],
    loading: false,
    createWorkspace: vi.fn(async () => null),
  }),
  useCodebases: () => ({ codebases: [], fetchCodebases: vi.fn(async () => {}) }),
}));

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: true,
    loading: false,
    sessionId: "session-1",
    updates: [],
    providers: [{ id: "dsh", name: "DSH", description: "", command: "dsh" }],
    selectedProvider: "dsh",
    connect: vi.fn(async () => {}),
    createSession: vi.fn(async () => null),
    resumeSession: vi.fn(async () => null),
    selectSession: vi.fn(),
    setProvider: vi.fn(),
    prompt: vi.fn(async () => {}),
    promptSession: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/hooks/use-notes", () => ({
  useNotes: () => ({ notes: [], connected: true, updateNote: vi.fn(), deleteNote: vi.fn() }),
}));

vi.mock("@/client/components/chat-panel", () => ({
  ChatPanel: () => <div data-testid="chat-panel">chat</div>,
}));

vi.mock("@/client/components/session-context-panel", () => ({
  SessionContextPanel: () => <div data-testid="session-context-panel" />,
}));

vi.mock("@/client/components/task-panel", () => ({
  TaskPanel: () => <div data-testid="task-panel" />,
  CraftersView: () => <div data-testid="crafters-view" />,
}));

vi.mock("../[sessionId]/use-session-crafters", () => ({
  useSessionCrafters: () => ({
    routaTasks: [],
    crafterAgents: crafterState.agents,
    activeCrafterId: null,
    concurrency: 1,
  }),
}));

vi.mock("../[sessionId]/use-session-page-bootstrap", () => ({
  useSessionPageBootstrap: () => ({ specialists: [] }),
}));

vi.mock("@/client/components/agent-install-panel", () => ({ AgentInstallPanel: () => null }));
vi.mock("@/client/components/specialist-manager", () => ({ SpecialistManager: () => null }));
vi.mock("@/client/components/settings-panel", () => ({
  DockerConfigModal: () => null,
  loadDefaultProviders: () => ({}),
  loadProviderConnectionConfig: () => ({}),
  getModelDefinitionByAlias: () => undefined,
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === "/api/sessions/session-1") {
    return { ok: true, json: async () => ({ session: sessionRecord.value }) } as Response;
  }
  return { ok: true, json: async () => ({}) } as Response;
});

function chatColumn() {
  return screen.getByTestId("session-chat-column");
}
function contextSidebar() {
  return screen.getByTestId("session-context-sidebar");
}

describe("session detail layout", () => {
  beforeEach(() => {
    crafterState.agents = [];
    sessionRecord.value = { sessionId: "session-1", provider: "dsh", branch: "issue/abc" };
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("puts the context sidebar to the right of the chat column", () => {
    render(<SessionPageClient />);
    const aside = contextSidebar();
    expect(aside.getAttribute("data-placement")).toBe("right");
    expect(aside.className).toContain("border-l");
    expect(aside.className).not.toContain("border-r ");
    // DOCUMENT_POSITION_FOLLOWING: the sidebar comes after the chat column.
    expect(chatColumn().compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(chatColumn()).getByTestId("chat-panel")).toBeTruthy();
  });

  it("collapses to the icon strip on the right and expands again", () => {
    render(<SessionPageClient />);
    fireEvent.click(screen.getByTestId("session-context-collapse"));
    const aside = contextSidebar();
    expect(aside.style.width).toBe("44px");
    expect(aside.getAttribute("data-placement")).toBe("right");
    expect(chatColumn().compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByTestId("session-context-expand"));
    expect(contextSidebar().style.width).toBe("320px");
  });

  it("orders chat | crafters | context and folds the context sidebar when the crafters column opens", () => {
    const { rerender } = render(<SessionPageClient />);
    expect(contextSidebar().style.width).toBe("320px");
    crafterState.agents = [{ id: "crafter-1" }];
    rerender(<SessionPageClient />);
    const crafters = screen.getByTestId("crafters-view");
    const aside = contextSidebar();
    expect(chatColumn().compareDocumentPosition(crafters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(crafters.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aside.style.width).toBe("44px");
    fireEvent.click(screen.getByTestId("session-context-expand"));
    expect(contextSidebar().style.width).toBe("320px");
  });

  it("opens a right-hand drawer; Esc closes it and returns focus to the toggle", () => {
    render(<SessionPageClient />);
    const toggle = screen.getByTestId("session-context-toggle");
    fireEvent.click(toggle);
    const aside = contextSidebar();
    expect(aside.getAttribute("data-drawer")).toBe("open");
    expect(aside.className).toContain("right-0");
    expect(aside.className).not.toContain("left-0");
    expect(aside.className).toContain("w-[min(360px,calc(100vw-16px))]");
    (screen.getByTestId("session-context-collapse") as HTMLElement).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(contextSidebar().getAttribute("data-drawer")).toBeNull();
    expect(screen.queryByTestId("session-context-overlay")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("closes the drawer from the overlay and returns focus to the toggle", () => {
    render(<SessionPageClient />);
    const toggle = screen.getByTestId("session-context-toggle");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("session-context-overlay"));
    expect(contextSidebar().getAttribute("data-drawer")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("shows the session context rows from the record and 'unconfirmed' when the run state is unknown", async () => {
    render(<SessionPageClient />);
    await waitFor(() => expect(screen.getByTestId("session-context-branch").textContent).toBe("issue/abc"));
    expect(screen.getByTestId("session-context-workspace").textContent).toBe("Default Workspace");
    expect(screen.getByTestId("session-context-provider").textContent).toBe("dsh");
    const status = screen.getByTestId("session-context-status");
    expect(status.getAttribute("data-status")).toBe("unknown");
    expect(status.textContent).toBe("Unconfirmed");
    expect(screen.getByTestId("session-context-link-traces").getAttribute("href")).toBe("/traces?workspaceId=default");
    expect(screen.getByTestId("session-context-link-replay").getAttribute("href")).toBe("/debug/acp-replay");
  });
});
