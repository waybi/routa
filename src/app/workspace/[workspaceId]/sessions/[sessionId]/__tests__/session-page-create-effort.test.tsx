/**
 * Card 87810657 (AC4): session page create / rebuild paths forward the
 * reasoning effort, and the rebuild keeps the original provider.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AcpClientError } from "@/client/acp-client";
import { SessionPageClient } from "../session-page-client";

const {
  mockPush,
  mockConnect,
  mockCreateSession,
  mockResumeSession,
  mockPromptSession,
  mockSelectSession,
  mockSetProvider,
  mockPrompt,
  mockCreateWorkspace,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockConnect: vi.fn(async () => {}),
  mockCreateSession: vi.fn(async (): Promise<{ sessionId: string; provider: string; role?: string; acpStatus?: string } | null> => null),
  mockResumeSession: vi.fn(async () => ({ sessionId: "session-1", provider: "codex", acpStatus: "ready", resumeMode: "native" })),
  mockPromptSession: vi.fn(async () => {}),
  mockSelectSession: vi.fn(),
  mockSetProvider: vi.fn(),
  mockPrompt: vi.fn(async () => {}),
  mockCreateWorkspace: vi.fn(async () => null),
}));

const chatPanelProps = vi.hoisted(() => ({
  current: null as null | {
    onEnsureSession: (cwd?: string, provider?: string, modeId?: string, model?: string, reasoningEffort?: string) => Promise<string | null>;
    onCreateSession?: (provider: string, reasoningEffort?: string) => void | Promise<void>;
  },
}));

const navState = vi.hoisted(() => ({
  params: { workspaceId: "default", sessionId: "session-1" },
  searchParams: new URLSearchParams(),
}));

const workspaceState = vi.hoisted(() => ({
  workspaces: [
    {
      id: "default",
      title: "Default Workspace",
      status: "active" as const,
      metadata: {},
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  ],
  codebases: [],
}));

const acpState = vi.hoisted(() => ({
  connected: true,
  loading: false,
  sessionId: null as string | null,
  updates: [] as Array<Record<string, unknown>>,
  selectedProvider: "opencode",
}));

const notesState = vi.hoisted(() => ({
  notes: [],
  connected: true,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => navState.params,
  useSearchParams: () => navState.searchParams,
  usePathname: () => `/workspace/${navState.params.workspaceId}/sessions/${navState.params.sessionId}`,
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: workspaceState.workspaces,
    loading: false,
    fetchWorkspaces: vi.fn(async () => {}),
    createWorkspace: mockCreateWorkspace,
    archiveWorkspace: vi.fn(async () => {}),
  }),
  useCodebases: () => ({
    codebases: workspaceState.codebases,
    fetchCodebases: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({
    connected: acpState.connected,
    loading: acpState.loading,
    sessionId: acpState.sessionId,
    updates: acpState.updates,
    providers: [{ id: "opencode", name: "OpenCode", description: "OpenCode", command: "opencode" }],
    selectedProvider: acpState.selectedProvider,
    error: null,
    authError: null,
    dockerConfigError: null,
    connect: mockConnect,
    createSession: mockCreateSession,
    resumeSession: mockResumeSession,
    selectSession: mockSelectSession,
    setProvider: mockSetProvider,
    setMode: vi.fn(async () => {}),
    prompt: mockPrompt,
    promptSession: mockPromptSession,
    respondToUserInput: vi.fn(async () => {}),
    respondToUserInputForSession: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    disconnect: vi.fn(),
    clearAuthError: vi.fn(),
    clearDockerConfigError: vi.fn(),
    listProviderModels: vi.fn(async () => []),
    writeTerminal: vi.fn(async () => {}),
    resizeTerminal: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/hooks/use-notes", () => ({
  useNotes: () => ({
    notes: notesState.notes,
    loading: false,
    error: null,
    connected: notesState.connected,
    fetchNotes: vi.fn(async () => {}),
    fetchNote: vi.fn(async () => null),
    createNote: vi.fn(async () => null),
    updateNote: vi.fn(async () => null),
    deleteNote: vi.fn(async () => {}),
  }),
}));

vi.mock("@/client/components/chat-panel", () => ({
  ChatPanel: (props: {
    onEnsureSession: (cwd?: string, provider?: string, modeId?: string, model?: string, reasoningEffort?: string) => Promise<string | null>;
    onCreateSession?: (provider: string, reasoningEffort?: string) => void;
  }) => {
    chatPanelProps.current = props;
    return <div data-testid="chat-panel">chat</div>;
  },
}));

vi.mock("../left-sidebar", () => ({
  LeftSidebar: () => <div data-testid="left-sidebar">sidebar</div>,
}));

vi.mock("@/client/components/app-header", () => ({
  AppHeader: ({ leftSlot, rightSlot }: { leftSlot?: React.ReactNode; rightSlot?: React.ReactNode }) => (
    <div data-testid="app-header">
      <div data-testid="header-left">{leftSlot}</div>
      <div data-testid="header-right">{rightSlot}</div>
    </div>
  ),
}));

vi.mock("@/client/components/task-panel", () => ({
  CraftersView: ({ agents }: { agents: Array<{ id: string }> }) => (
    <div data-testid="crafters-view">{agents.length}</div>
  ),
}));

vi.mock("@/client/components/agent-install-panel", () => ({
  AgentInstallPanel: () => <div data-testid="agent-install-panel">install</div>,
}));

vi.mock("@/client/components/specialist-manager", () => ({
  SpecialistManager: ({ open }: { open: boolean }) => (open ? <div data-testid="specialist-manager" /> : null),
}));

vi.mock("@/client/components/settings-panel", () => ({
  SettingsPanel: ({ open }: { open: boolean }) => (open ? <div data-testid="settings-panel" /> : null),
  DockerConfigModal: ({ open }: { open: boolean }) => (open ? <div data-testid="docker-config-modal" /> : null),
  loadDefaultProviders: () => ({}),
  loadProviderConnectionConfig: () => ({ model: undefined, baseUrl: undefined, apiKey: undefined }),
  getModelDefinitionByAlias: () => undefined,
}));

vi.mock("@/client/components/desktop-nav-rail", () => ({
  DesktopNavRail: () => <div data-testid="desktop-nav-rail" />,
}));

vi.mock("@/client/acp-client", () => ({
  AcpClientError: class MockAcpClientError extends Error {
    code: number;

    constructor(message: string, code: number) {
      super(message);
      this.name = "AcpClientError";
      this.code = code;
    }
  },
  BrowserAcpClient: class MockBrowserAcpClient {
    initialize = vi.fn(async () => {});
    newSession = vi.fn(async () => ({ sessionId: "child-session-1", routaAgentId: "agent-1" }));
    onUpdate = vi.fn();
    disconnect = vi.fn();
  },
}));

type SessionFixture = { provider?: string; model?: string; reasoningEffort?: string };

function stubFetch(session: SessionFixture) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/specialists") return { ok: true, json: async () => ({ specialists: [] }) } as Response;
    if (url === "/api/sessions/session-1") {
      return {
        ok: true,
        json: async () => ({
          session: {
            sessionId: "session-1",
            name: "Original Session",
            cwd: "/tmp/repo",
            branch: "main",
            role: "DEVELOPER",
            resumeCapabilities: { supported: true, mode: "native" },
            ...session,
          },
        }),
      } as Response;
    }
    if (url === "/api/sessions/session-1/transcript") return { ok: true, json: async () => ({ messages: [] }) } as Response;
    if (url === "/api/sessions?parentSessionId=session-1") return { ok: true, json: async () => ({ sessions: [] }) } as Response;
    if (url === "/api/mcp/tools") return { ok: true, json: async () => ({ globalMode: "essential" }) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

beforeEach(() => {
  navState.params = { workspaceId: "default", sessionId: "session-1" };
  navState.searchParams = new URLSearchParams();
  acpState.selectedProvider = "opencode";
  chatPanelProps.current = null;
  mockCreateSession.mockReset();
  mockResumeSession.mockReset();
  mockPush.mockReset();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

async function rebuild(session: SessionFixture) {
  stubFetch(session);
  mockResumeSession.mockRejectedValueOnce(new AcpClientError("session/load not supported - create a new session instead", -32601));
  mockCreateSession.mockResolvedValueOnce({ sessionId: "session-rebuilt", provider: session.provider ?? "opencode" });
  render(<SessionPageClient />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
  await waitFor(() => expect(mockCreateSession).toHaveBeenCalledTimes(1));
  return mockCreateSession.mock.calls[0] as unknown[];
}

describe("session page rebuild keeps provider, model and effort (AC4 / C4)", () => {
  it("reuses the record's dsh provider, model and effort", async () => {
    const args = await rebuild({ provider: "dsh", model: "claude-opus-5-5", reasoningEffort: "low" });
    expect(args[1]).toBe("dsh");
    expect(args[5]).toBe("claude-opus-5-5");
    expect(args[19]).toBe("low");
  });

  it("falls back to the selected provider for an old record without provider or effort", async () => {
    const args = await rebuild({});
    expect(args[1]).toBe("opencode");
    expect(args[19]).toBeUndefined();
  });
});

describe("session page new-session paths forward the effort (AC4 / C5)", () => {
  async function renderReady() {
    stubFetch({ provider: "dsh" });
    render(<SessionPageClient />);
    await waitFor(() => expect(chatPanelProps.current).toBeTruthy());
    return chatPanelProps.current!;
  }

  it.each([["high", "high"], [undefined, undefined]])("handleCreateSession(effort=%s) passes argument 20 = %s", async (effort, expected) => {
    mockCreateSession.mockResolvedValue({ sessionId: "session-new", provider: "dsh" });
    const props = await renderReady();
    await props.onCreateSession!("dsh", effort);
    await waitFor(() => expect(mockCreateSession).toHaveBeenCalledTimes(1));
    const args = mockCreateSession.mock.calls[0] as unknown[];
    expect(args[1]).toBe("dsh");
    expect(args[19]).toBe(expected);
    expect(args.slice(12, 19)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it.each([["high", "high"], [undefined, undefined]])("ensureSessionForChat(effort=%s) passes argument 20 = %s when no session is open", async (effort, expected) => {
    navState.params = { workspaceId: "default", sessionId: "" };
    mockCreateSession.mockResolvedValue({ sessionId: "session-new", provider: "dsh" });
    const props = await renderReady();
    const sid = await props.onEnsureSession("/tmp/repo", "dsh", undefined, "claude-opus-5-5", effort);
    expect(sid).toBe("session-new");
    const args = mockCreateSession.mock.calls[0] as unknown[];
    expect(args[0]).toBe("/tmp/repo");
    expect(args[5]).toBe("claude-opus-5-5");
    expect(args[19]).toBe(expected);
  });
});
