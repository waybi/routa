import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { ChatPanel } from "../chat-panel";

const {
  mockVisibleMessages,
  mockSetMessagesBySession,
  mockFetchSessions,
  mockChatMessagesState,
  mockDesktopAwareFetch,
  mockToastError,
  mockTiptapProps,
} = vi.hoisted(() => ({
  mockVisibleMessages: [] as Array<Record<string, unknown>>,
  mockSetMessagesBySession: vi.fn(),
  mockFetchSessions: vi.fn(),
  mockChatMessagesState: {
    isSessionRunning: false,
    sessions: [] as Array<{ sessionId: string; model?: string }>,
    sessionConfigOptionsById: {} as Record<string, unknown[]>,
  },
  mockDesktopAwareFetch: vi.fn(),
  mockToastError: vi.fn(),
  mockTiptapProps: { current: null as null | Record<string, unknown> },
}));

vi.mock("../../utils/diagnostics", () => ({
  desktopAwareFetch: mockDesktopAwareFetch,
}));

vi.mock("../toast", () => ({
  toast: { error: mockToastError, success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      chat: {
        typeMessage: "Type a message...",
        typeCreateSession: "Type to create session...",
        connectFirst: "Connect first",
        authRequiredTitle: "Authentication required",
        availableAuthMethods: "Available auth methods",
        working: "Working...",
        viewToggle: {
          chat: "Chat",
          trace: "Trace",
        },
        sessionConfig: {
          model: "Model",
          reasoningEffort: "Reasoning effort",
          defaultEffort: "Default",
          unknownEffort: "Unknown",
          unknownModel: "Unknown",
          resumeToSwitch: "Send a message to resume the session, then you can switch",
          defaultModel: "Default model",
        },
      },
      kanbanModelSelection: {
        model: "Model",
        reasoningEffort: "Reasoning effort",
        followDefault: "Follow default",
        defaultEffort: "Default",
        pickerAriaLabel: "Model and reasoning effort",
        noModels: "No models",
      },
      sessions: {
        placeholder: "Send a message to start.",
        repoPath: "Repo path",
        sessionInfo: "Session info",
      },
      common: {
        tasks: "Tasks",
        dismiss: "Dismiss",
        copyToClipboard: "Copy to clipboard",
        save: "Save",
        cancel: "Cancel",
      },
      messageBubble: {
        requestPermissions: "Request permissions",
        permissionReason: "Reason",
        permissionCommand: "Command",
        permissionSuggestedAccess: "Suggested access",
        permissionTechnicalDetails: "Technical details",
        permissionAllow: "Allow",
        permissionDeny: "Deny",
        permissionScopeSession: "Entire session",
        permissionScopeTurn: "This turn only",
        permissionApproved: "Approved",
        permissionDenied: "Denied",
        permissionScopeHint: "Scope hint",
        failedToSubmit: "Failed to submit",
      },
    },
  }),
}));

vi.mock("../tiptap-input", () => ({
  TiptapInput: (props: {
    onSend: (text: string, context: Record<string, unknown>) => Promise<void>;
    beforeProviderSlot?: React.ReactNode;
  }) => {
    mockTiptapProps.current = props as unknown as Record<string, unknown>;
    return (
      <div data-testid="tiptap-toolbar-mock">
        {props.beforeProviderSlot}
        <button type="button" onClick={() => void props.onSend("continue", {})}>
          Send mock prompt
        </button>
      </div>
    );
  },
}));

vi.mock("../chat-panel/hooks", () => ({
  useChatMessages: () => ({
    visibleMessages: mockVisibleMessages,
    sessions: mockChatMessagesState.sessions,
    sessionModeById: {},
    sessionConfigOptionsById: mockChatMessagesState.sessionConfigOptionsById,
    isSessionRunning: mockChatMessagesState.isSessionRunning,
    checklistItems: [],
    fileChangesState: { files: new Map(), totalAdded: 0, totalRemoved: 0 },
    usageInfo: null,
    setMessagesBySession: mockSetMessagesBySession,
    setIsSessionRunning: vi.fn(),
    fetchSessions: mockFetchSessions,
    resetStreamingRefs: vi.fn(),
  }),
}));

describe("ChatPanel session targeting", () => {
  beforeEach(() => {
    mockVisibleMessages.splice(0, mockVisibleMessages.length);
    mockSetMessagesBySession.mockReset();
    mockFetchSessions.mockReset();
    mockChatMessagesState.isSessionRunning = false;
    mockChatMessagesState.sessions = [];
    mockChatMessagesState.sessionConfigOptionsById = {};
    mockDesktopAwareFetch.mockReset();
    mockDesktopAwareFetch.mockResolvedValue(new Response("{}", { status: 404 }));
  });

  it("dismisses stale permission cards when the server reports no pending interactive request", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockVisibleMessages.splice(0, mockVisibleMessages.length, {
      id: "tool-1",
      role: "tool",
      content: "RequestPermissions",
      timestamp: new Date(),
      toolCallId: "request-permission-1",
      toolKind: "request-permissions",
      toolStatus: "running",
      toolRawInput: {
        permissions: { "fs.read": true },
        reason: "Need repo read access",
      },
    });
    const acp = {
      connected: true,
      sessionId: "session-123",
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(async () => {}),
      respondToUserInput: vi.fn(async () => {
        throw new Error("No pending interactive request found for this session");
      }),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ChatPanel
        acp={acp}
        activeSessionId="session-123"
        onEnsureSession={vi.fn(async () => "session-123")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(mockSetMessagesBySession).toHaveBeenCalledTimes(1);
    });

    const updateMessages = mockSetMessagesBySession.mock.calls[0][0] as (prev: Record<string, Array<Record<string, unknown>>>) => Record<string, Array<Record<string, unknown>>>;
    const nextState = updateMessages({
      "session-123": mockVisibleMessages,
    });
    expect(nextState["session-123"][0]).toMatchObject({
      toolStatus: "failed",
      toolRawOutput: {
        message: "No pending interactive request found for this session",
      },
    });
  });

  it("sends prompts to the ensured active session even when ACP has not selected it yet", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const onSelectSession = vi.fn(async () => {});
    const onEnsureSession = vi.fn(async () => "session-123");
    const acp = {
      connected: true,
      sessionId: null,
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(async () => {}),
      respondToUserInput: vi.fn(),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ChatPanel
        acp={acp}
        activeSessionId="session-123"
        onEnsureSession={onEnsureSession}
        onSelectSession={onSelectSession}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send mock prompt" }));

    await waitFor(() => {
      expect(onSelectSession).toHaveBeenCalledWith("session-123");
      expect(acp.promptSession).toHaveBeenCalledWith("session-123", "continue", undefined);
    });
  });

  it("hides non-interactive process output cards from the chat stream", () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockVisibleMessages.splice(0, mockVisibleMessages.length, {
      id: "process-1",
      role: "terminal",
      content: "stderr line",
      timestamp: new Date(),
      terminalId: "process-session-123",
      terminalCommand: "Codex",
      terminalArgs: ["stderr"],
      terminalInteractive: false,
      terminalExited: false,
      terminalExitCode: null,
    }, {
      id: "assistant-1",
      role: "assistant",
      content: "Done",
      timestamp: new Date(),
    });

    const acp = {
      connected: true,
      sessionId: "session-123",
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(async () => {}),
      respondToUserInput: vi.fn(),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ChatPanel
        acp={acp}
        activeSessionId="session-123"
        onEnsureSession={vi.fn(async () => "session-123")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("stderr line")).toBeNull();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("shows a working indicator while the session is running and hides it when idle", () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockVisibleMessages.splice(0, mockVisibleMessages.length, {
      id: "user-1",
      role: "user",
      content: "do the thing",
      timestamp: new Date(),
    });
    mockChatMessagesState.isSessionRunning = true;

    const makeAcp = (loading: boolean) => ({
      connected: true,
      sessionId: "session-123",
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(async () => {}),
      respondToUserInput: vi.fn(),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions);

    const { unmount } = render(
      <ChatPanel
        acp={makeAcp(false)}
        activeSessionId="session-123"
        onEnsureSession={vi.fn(async () => "session-123")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("chat-working-indicator")).toBeTruthy();
    expect(screen.getByText("Working...")).toBeTruthy();
    unmount();

    // Idle session (not running, not loading) → no indicator
    mockChatMessagesState.isSessionRunning = false;
    render(
      <ChatPanel
        acp={makeAcp(false)}
        activeSessionId="session-123"
        onEnsureSession={vi.fn(async () => "session-123")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("chat-working-indicator")).toBeNull();
  });

  it("shows the working indicator while a prompt is in flight before any stream update", () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockVisibleMessages.splice(0, mockVisibleMessages.length, {
      id: "user-1",
      role: "user",
      content: "do the thing",
      timestamp: new Date(),
    });
    // isSessionRunning stays false — only acp.loading is true (prompt sent,
    // no streaming update received yet). This is the "looks stuck" window.
    const acp = {
      connected: true,
      sessionId: "session-123",
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading: true,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(async () => {}),
      respondToUserInput: vi.fn(),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ChatPanel
        acp={acp}
        activeSessionId="session-123"
        onEnsureSession={vi.fn(async () => "session-123")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("chat-working-indicator")).toBeTruthy();
  });

  it("disables the Canvas prompt action while the composer is disconnected", () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const onPrepareCanvasPrompt = vi.fn();
    const acp = {
      connected: false,
      sessionId: "session-123",
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(async () => {}),
      respondToUserInput: vi.fn(),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ChatPanel
        acp={acp}
        activeSessionId="session-123"
        onEnsureSession={vi.fn(async () => "session-123")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
        onPrepareCanvasPrompt={onPrepareCanvasPrompt}
        canvasPromptLabel="Use Canvas"
        canvasPromptShortLabel="Canvas"
      />,
    );

    const canvasButton = screen.getByRole("button", { name: "Use Canvas" });

    expect(canvasButton).toHaveProperty("disabled", true);
    expect(canvasButton.getAttribute("title")).toBe("Connect first");
    fireEvent.click(canvasButton);
    expect(onPrepareCanvasPrompt).not.toHaveBeenCalled();
  });
});

function makeSessionAcp(): UseAcpState & UseAcpActions {
  return {
    connected: true,
    sessionId: "session-123",
    updates: [],
    providers: [],
    selectedProvider: "opencode",
    loading: false,
    error: null,
    authError: null,
    dockerConfigError: null,
    connect: vi.fn(),
    createSession: vi.fn(),
    resumeSession: vi.fn(),
    forkSession: vi.fn(),
    selectSession: vi.fn(),
    setProvider: vi.fn(),
    setMode: vi.fn(),
    prompt: vi.fn(),
    promptSession: vi.fn(async () => {}),
    respondToUserInput: vi.fn(),
    respondToUserInputForSession: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    cancel: vi.fn(),
    disconnect: vi.fn(),
    clearAuthError: vi.fn(),
    clearDockerConfigError: vi.fn(),
    listProviderModels: vi.fn(),
  } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;
}

function configOptions(model: string, effort: string) {
  return [
    {
      id: "model",
      name: "Model",
      currentValue: model,
      options: [
        { group: "deepseek", name: "DeepSeek", options: [{ value: "[\"deepseek\",\"deepseek-v4-pro\"]", name: "deepseek-v4-pro" }] },
        { group: "local-7357", name: "Local 7357", options: [{ value: "[\"local-7357\",\"claude-opus-5-5\"]", name: "claude-opus-5-5" }] },
      ],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      currentValue: effort,
      options: [{ value: "", name: "Default" }, { value: "low", name: "Low" }, { value: "high", name: "High" }],
    },
  ];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderSessionPanel() {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  mockVisibleMessages.splice(0, mockVisibleMessages.length, {
    id: "assistant-1",
    role: "assistant",
    content: "Done",
    timestamp: new Date(),
  });
  return render(
    <ChatPanel
      acp={makeSessionAcp()}
      activeSessionId="session-123"
      onEnsureSession={vi.fn(async () => "session-123")}
      onSelectSession={vi.fn(async () => {})}
      repoSelection={null}
      onRepoChange={vi.fn()}
    />,
  );
}

describe("ChatPanel session model / reasoning effort", () => {
  const OPUS = "[\"local-7357\",\"claude-opus-5-5\"]";
  const DEEPSEEK = "[\"deepseek\",\"deepseek-v4-pro\"]";

  beforeEach(() => {
    mockVisibleMessages.splice(0, mockVisibleMessages.length);
    mockChatMessagesState.isSessionRunning = false;
    mockChatMessagesState.sessions = [];
    mockChatMessagesState.sessionConfigOptionsById = {};
    mockDesktopAwareFetch.mockReset();
    mockToastError.mockReset();
    mockTiptapProps.current = null;
  });

  const picker = () => screen.getByTestId("session-config-picker") as HTMLButtonElement;
  const pickerLabel = () => screen.getByTestId("session-config-picker-label").textContent ?? "";
  const openPicker = () => fireEvent.click(picker());

  it("renders the picker in the composer toolbar from GET config-options and hides the legacy picker", async () => {
    mockDesktopAwareFetch.mockResolvedValue(jsonResponse({ sessionId: "session-123", configOptions: configOptions(OPUS, "high") }));
    renderSessionPanel();

    await waitFor(() => expect(pickerLabel()).toBe("claude-opus-5-5 · High"));
    expect(mockDesktopAwareFetch.mock.calls[0][0]).toContain("/api/sessions/session-123/config-options");
    // Rendered through the TiptapInput slot, not as a separate bar with native selects.
    expect(screen.getByTestId("tiptap-toolbar-mock").contains(picker())).toBe(true);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByTestId("session-config-bar")).toBeNull();
    expect(screen.queryByTestId("session-config-label")).toBeNull();
    expect(mockTiptapProps.current?.hideLegacyModelPicker).toBe(true);

    openPicker();
    expect(screen.getByRole("group", { name: "DeepSeek" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Local 7357" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "claude-opus-5-5" }).getAttribute("aria-selected")).toBe("true");
    // A live session always has a model: no "Follow default" item.
    expect(screen.queryByRole("option", { name: "Follow default" })).toBeNull();
  });

  it("renders no picker when configOptions has neither model nor reasoning_effort", async () => {
    mockDesktopAwareFetch.mockResolvedValue(jsonResponse({ sessionId: "session-123", configOptions: [{ id: "mode", currentValue: "build" }] }));
    renderSessionPanel();

    await waitFor(() => expect(mockDesktopAwareFetch).toHaveBeenCalled());
    await waitFor(() => expect(mockTiptapProps.current?.hideLegacyModelPicker).toBe(false));
    expect(screen.queryByTestId("session-config-picker")).toBeNull();
    expect(mockTiptapProps.current?.beforeProviderSlot).toBeUndefined();
  });

  it("posts the raw model value and trusts the returned effort even when it was reset", async () => {
    mockDesktopAwareFetch
      .mockResolvedValueOnce(jsonResponse({ sessionId: "session-123", configOptions: configOptions(OPUS, "high") }))
      .mockResolvedValueOnce(jsonResponse({ sessionId: "session-123", configOptions: configOptions(DEEPSEEK, "") }));
    renderSessionPanel();

    await waitFor(() => expect(pickerLabel()).toContain("claude-opus-5-5"));
    openPicker();
    fireEvent.click(screen.getByRole("option", { name: "deepseek-v4-pro" }));

    await waitFor(() => expect(mockDesktopAwareFetch).toHaveBeenCalledTimes(2));
    const [, init] = mockDesktopAwareFetch.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ configId: "model", value: DEEPSEEK });

    await waitFor(() => expect(pickerLabel()).toBe("deepseek-v4-pro · Default"));
    expect(screen.getByRole("radio", { name: "Default" }).getAttribute("aria-checked")).toBe("true");
  });

  it("disables the picker while a POST is in flight", async () => {
    let resolvePost: (response: Response) => void = () => {};
    mockDesktopAwareFetch
      .mockResolvedValueOnce(jsonResponse({ sessionId: "session-123", configOptions: configOptions(OPUS, "high") }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePost = resolve; }));
    renderSessionPanel();

    await waitFor(() => expect(pickerLabel()).toContain("claude-opus-5-5"));
    openPicker();
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));

    await waitFor(() => expect(picker().disabled).toBe(true));
    expect((screen.getByRole("radio", { name: "High" }) as HTMLButtonElement).disabled).toBe(true);

    resolvePost(jsonResponse({ sessionId: "session-123", configOptions: configOptions(OPUS, "low") }));
    await waitFor(() => expect(picker().disabled).toBe(false));
    expect(pickerLabel()).toBe("claude-opus-5-5 · Low");
  });

  it("labels a reset effort as Default even when the agent lists no \"\" entry (real DSH shape)", async () => {
    const withoutDefault = (model: string, effort: string) => configOptions(model, effort).map((option) =>
      option.id === "reasoning_effort"
        ? { ...option, options: [{ value: "low" }, { value: "medium" }, { value: "high" }, { value: "xhigh" }, { value: "max" }] }
        : option);
    mockDesktopAwareFetch
      .mockResolvedValueOnce(jsonResponse({ sessionId: "session-123", configOptions: withoutDefault(OPUS, "high") }))
      .mockResolvedValueOnce(jsonResponse({ sessionId: "session-123", configOptions: withoutDefault(DEEPSEEK, "") }));
    renderSessionPanel();

    await waitFor(() => expect(pickerLabel()).toBe("claude-opus-5-5 · high"));
    openPicker();
    // The agent does not accept "": no Default segment while a concrete effort is set.
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    fireEvent.click(screen.getByRole("option", { name: "deepseek-v4-pro" }));

    await waitFor(() => expect(pickerLabel()).toBe("deepseek-v4-pro · Default"));
    const defaultSegment = screen.getByRole("radio", { name: "Default" }) as HTMLButtonElement;
    expect(defaultSegment.getAttribute("aria-checked")).toBe("true");
    expect(defaultSegment.disabled).toBe(true);
  });

  it("posts reasoning_effort changes with configId reasoning_effort", async () => {
    mockDesktopAwareFetch
      .mockResolvedValueOnce(jsonResponse({ sessionId: "session-123", configOptions: configOptions(OPUS, "high") }))
      .mockResolvedValueOnce(jsonResponse({ sessionId: "session-123", configOptions: configOptions(OPUS, "low") }));
    renderSessionPanel();

    await waitFor(() => expect(pickerLabel()).toContain("High"));
    openPicker();
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));

    await waitFor(() => expect(mockDesktopAwareFetch).toHaveBeenCalledTimes(2));
    const [, init] = mockDesktopAwareFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ configId: "reasoning_effort", value: "low" });
    await waitFor(() => expect(pickerLabel()).toBe("claude-opus-5-5 · Low"));
  });

  it("goes read-only on 404 with the stored model, unknown effort and a resume hint, without a toast", async () => {
    mockChatMessagesState.sessions = [{ sessionId: "session-123", model: "claude-opus-5-5" }];
    mockDesktopAwareFetch.mockResolvedValue(jsonResponse({ error: "会话进程不在，需先恢复会话", code: "SESSION_PROCESS_NOT_FOUND" }, 404));
    renderSessionPanel();

    await waitFor(() => expect(picker().getAttribute("data-readonly")).toBe("true"));
    expect(picker().getAttribute("title")).toBe("Send a message to resume the session, then you can switch");
    expect(pickerLabel()).toBe("claude-opus-5-5 · Unknown");
    openPicker();
    expect(screen.queryByTestId("session-config-picker-panel")).toBeNull();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("turns read-only when POST returns 404", async () => {
    mockDesktopAwareFetch
      .mockResolvedValueOnce(jsonResponse({ sessionId: "session-123", configOptions: configOptions(OPUS, "high") }))
      .mockResolvedValueOnce(jsonResponse({ error: "gone" }, 404));
    renderSessionPanel();

    await waitFor(() => expect(pickerLabel()).toContain("claude-opus-5-5"));
    openPicker();
    fireEvent.click(screen.getByRole("option", { name: "deepseek-v4-pro" }));

    await waitFor(() => expect(picker().getAttribute("data-readonly")).toBe("true"));
    expect(picker().getAttribute("title")).toBe("Send a message to resume the session, then you can switch");
    expect(screen.queryByTestId("session-config-picker-panel")).toBeNull();
    openPicker();
    expect(screen.queryByTestId("session-config-picker-panel")).toBeNull();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("applies config_option_update payloads to the picker", async () => {
    mockDesktopAwareFetch.mockResolvedValue(jsonResponse({ sessionId: "session-123", configOptions: configOptions(OPUS, "high") }));
    const view = renderSessionPanel();
    await waitFor(() => expect(pickerLabel()).toContain("claude-opus-5-5"));

    mockChatMessagesState.sessionConfigOptionsById = { "session-123": configOptions(DEEPSEEK, "low") };
    view.rerender(
      <ChatPanel
        acp={makeSessionAcp()}
        activeSessionId="session-123"
        onEnsureSession={vi.fn(async () => "session-123")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(pickerLabel()).toBe("deepseek-v4-pro · Low"));
  });
});

