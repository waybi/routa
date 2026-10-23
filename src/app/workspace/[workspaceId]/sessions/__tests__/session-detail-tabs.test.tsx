/**
 * Chat / Events / Evidence tabs (card 7, AC2 / AC3 / AC8): switching tabs
 * keeps the ChatPanel instance (draft, pending re-send after Resume) alive,
 * keyboard moves between tabs, and typing arrows in the composer does not.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionPageClient } from "../[sessionId]/session-page-client";

const chatProbe = vi.hoisted(() => ({ mounts: 0, propsLog: [] as Array<Record<string, unknown>> }));
const traceFetch = vi.hoisted(() => vi.fn());

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

/** Stateful stand-in for ChatPanel: keeps a draft and counts mounts. */
function ChatPanelProbe(props: Record<string, unknown>) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    chatProbe.mounts += 1;
  }, []);
  chatProbe.propsLog.push(props);
  return (
    <div data-testid="chat-panel">
      <input data-testid="chat-draft" aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
    </div>
  );
}
vi.mock("@/client/components/chat-panel", () => ({ ChatPanel: (props: Record<string, unknown>) => <ChatPanelProbe {...props} /> }));
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
  chatProbe.mounts = 0;
  chatProbe.propsLog = [];
  traceFetch.mockReset();
  traceFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/traces")) return { ok: true, json: async () => ({ traces: [], count: 0 }) } as Response;
    if (url === "/api/sessions/session-1") return { ok: true, json: async () => ({ session: { sessionId: "session-1" } }) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", traceFetch);
});

function tab(name: "Chat" | "Events" | "Evidence") {
  return screen.getByRole("tab", { name });
}
function chatPanelElement() {
  return screen.getByTestId("chat-panel").closest('[role="tabpanel"]') as HTMLElement;
}

describe("session detail tabs", () => {
  it("renders Chat / Events / Evidence with Chat selected and the chat panel visible", () => {
    render(<SessionPageClient />);
    expect(screen.getAllByRole("tab").map((node) => node.textContent)).toEqual(["Chat", "Events", "Evidence"]);
    expect(tab("Chat").getAttribute("aria-selected")).toBe("true");
    expect(chatPanelElement().hidden).toBe(false);
  });

  it("keeps the ChatPanel instance, its draft and its props across tab switches", () => {
    render(<SessionPageClient />);
    fireEvent.change(screen.getByTestId("chat-draft"), { target: { value: "half-written reply" } });
    const propsBefore = chatProbe.propsLog[chatProbe.propsLog.length - 1];
    expect(chatProbe.mounts).toBe(1);

    fireEvent.click(tab("Events"));
    expect(screen.getByTestId("session-events-pane")).toBeTruthy();
    expect(chatPanelElement().hidden).toBe(true);
    fireEvent.click(tab("Evidence"));
    expect(screen.getByTestId("session-evidence-pane")).toBeTruthy();
    fireEvent.click(tab("Chat"));

    expect(chatPanelElement().hidden).toBe(false);
    expect(chatProbe.mounts).toBe(1);
    expect((screen.getByTestId("chat-draft") as HTMLInputElement).value).toBe("half-written reply");
    const propsAfter = chatProbe.propsLog[chatProbe.propsLog.length - 1];
    expect(Object.keys(propsAfter).sort()).toEqual(Object.keys(propsBefore).sort());
    for (const key of ["activeSessionId", "traceSessionId", "activeWorkspaceId", "inputPrefill", "canvasPromptActive", "agentRole"]) {
      expect(propsAfter[key]).toEqual(propsBefore[key]);
    }
  });

  it("moves between tabs with the arrow keys, Home and End", () => {
    render(<SessionPageClient />);
    tab("Chat").focus();
    fireEvent.keyDown(tab("Chat"), { key: "ArrowRight" });
    expect(tab("Events").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Events"));
    fireEvent.keyDown(tab("Events"), { key: "ArrowLeft" });
    expect(tab("Chat").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Chat"));
    fireEvent.keyDown(tab("Chat"), { key: "ArrowLeft" });
    expect(tab("Evidence").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Evidence"));
    fireEvent.keyDown(tab("Evidence"), { key: "Home" });
    expect(tab("Chat").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Chat"), { key: "End" });
    expect(tab("Evidence").getAttribute("aria-selected")).toBe("true");
  });

  it("does not switch tabs when arrow keys are pressed in the composer", () => {
    render(<SessionPageClient />);
    const draft = screen.getByTestId("chat-draft");
    draft.focus();
    fireEvent.keyDown(draft, { key: "ArrowRight" });
    fireEvent.keyDown(draft, { key: "ArrowLeft" });
    expect(tab("Chat").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(draft);
  });

  it("reads traces only after the Events tab opens", async () => {
    render(<SessionPageClient />);
    const tracesCalls = () => traceFetch.mock.calls.filter(([input]) => String(input).startsWith("/api/traces")).length;
    expect(tracesCalls()).toBe(0);
    fireEvent.click(tab("Events"));
    await screen.findByTestId("ui-empty-state");
    expect(tracesCalls()).toBe(1);
    expect(String(traceFetch.mock.calls.find(([input]) => String(input).startsWith("/api/traces"))?.[0])).toBe(
      "/api/traces?sessionId=session-1&limit=200",
    );
    fireEvent.click(tab("Evidence"));
    fireEvent.click(tab("Events"));
    expect(tracesCalls()).toBe(1);
  });
});
