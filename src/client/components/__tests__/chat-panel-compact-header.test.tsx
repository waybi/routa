/**
 * Card 8a2d2555 AC9: ChatPanel's optional compact session header. Without
 * the new props the header and the two-line "session finished" banner stay
 * exactly as before; with `compactSessionHeader` the session info is one
 * line, the finished note folds into it (full text in the title) and the
 * parent can render chips into the same line. Real failures keep the red
 * banner with Resume either way.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { ChatPanel } from "../chat-panel";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      chat: {
        typeMessage: "Type a message...",
        typeCreateSession: "Type to create session...",
        connectFirst: "Connect first",
        working: "Working...",
        viewToggle: { chat: "Chat", trace: "Trace" },
      },
      sessions: {
        placeholder: "Send a message to start.",
        repoPath: "Repo path",
        sessionInfo: "Session info",
        resume: "Resume",
        resuming: "Resuming...",
        resumeHint: "Resume hint",
        agentGone: "This agent is no longer running.",
        agentGoneHint: "Your message was not sent. Click Resume to start it again.",
        agentFinished: "This session has finished.",
        agentFinishedHint: "Its work is done.",
        resentAfterResume: "Agent restarted; your message has been re-sent.",
      },
      common: { tasks: "Tasks", dismiss: "Dismiss", copyToClipboard: "Copy", save: "Save", cancel: "Cancel" },
      messageBubble: {},
    },
  }),
}));

vi.mock("../tiptap-input", () => ({ TiptapInput: () => <div data-testid="tiptap-mock" /> }));

vi.mock("../chat-panel/hooks", () => ({
  useChatMessages: () => ({
    visibleMessages: [],
    sessions: [],
    sessionModeById: {},
    isSessionRunning: false,
    checklistItems: [],
    fileChangesState: { files: new Map(), totalAdded: 0, totalRemoved: 0 },
    usageInfo: null,
    setMessagesBySession: vi.fn(),
    setIsSessionRunning: vi.fn(),
    fetchSessions: vi.fn(),
    resetStreamingRefs: vi.fn(),
  }),
}));

const GONE = "ACP agent (dsh) process is not running";

function makeAcp(error: string | null) {
  return {
    connected: true,
    sessionId: null,
    updates: [],
    providers: [],
    selectedProvider: "dsh",
    loading: false,
    error,
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

function renderPanel(error: string | null, extra: { compactSessionHeader?: boolean; sessionInfoLeadingRef?: (node: HTMLSpanElement | null) => void; sessionFinished?: boolean } = {}) {
  return render(
    <ChatPanel
      acp={makeAcp(error)}
      activeSessionId="session-0123456789abcdef"
      onEnsureSession={async () => "session-0123456789abcdef"}
      onSelectSession={async () => {}}
      onResumeActiveSession={async () => {}}
      repoSelection={null}
      onRepoChange={vi.fn()}
      sessionFinished={extra.sessionFinished ?? true}
      compactSessionHeader={extra.compactSessionHeader}
      sessionInfoLeadingRef={extra.sessionInfoLeadingRef}
    />,
  );
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("ChatPanel without the compact props (other callers)", () => {
  it("keeps the old session info row and the two-line finished banner", () => {
    renderPanel(GONE);
    expect(screen.queryByTestId("chat-session-info-row")).toBeNull();
    expect(screen.queryByTestId("chat-ended-inline")).toBeNull();
    const banner = screen.getByTestId("chat-ended-banner");
    expect(banner.textContent).toContain("This session has finished.");
    expect(banner.textContent).toContain("Its work is done.");
    const info = screen.getByText(/Session info/);
    expect(info.textContent).toContain("session-0123456789abcdef");
    expect(screen.getByRole("link", { name: "Debug" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chat" })).toBeTruthy();
  });
});

describe("ChatPanel with compactSessionHeader (card detail)", () => {
  it("puts session id, Debug, Chat / Trace and the finished note on one line", () => {
    let slot: HTMLSpanElement | null = null;
    renderPanel(GONE, { compactSessionHeader: true, sessionInfoLeadingRef: (node) => { slot = node; } });
    const row = screen.getByTestId("chat-session-info-row");
    expect(row.className).toContain("whitespace-nowrap");
    expect(row.className).not.toContain("flex-wrap");
    const id = within(row).getByText(/session-0123456789abcdef/);
    expect(id.className).toContain("truncate");
    expect(id.getAttribute("title")).toBe("session-0123456789abcdef");
    expect(within(row).getByRole("link", { name: "Debug" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Chat" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Trace" })).toBeTruthy();
    const note = within(row).getByTestId("chat-ended-inline");
    expect(note.className).toContain("truncate");
    expect(note.getAttribute("title")).toBe("This session has finished. Its work is done.");
    expect(screen.queryByTestId("chat-ended-banner")).toBeNull();
    expect(slot).toBe(within(row).getByTestId("chat-session-info-leading"));
  });

  it("still shows the red banner with Resume for a real send failure", () => {
    renderPanel(GONE, { compactSessionHeader: true, sessionFinished: false });
    expect(screen.getByTestId("chat-error-banner").textContent).toContain("This agent is no longer running.");
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByTestId("chat-ended-inline")).toBeNull();
  });

  it("shows no finished note while the session runs", () => {
    renderPanel(null, { compactSessionHeader: true, sessionFinished: false });
    expect(screen.getByTestId("chat-session-info-row")).toBeTruthy();
    expect(screen.queryByTestId("chat-ended-inline")).toBeNull();
    expect(screen.queryByTestId("chat-ended-banner")).toBeNull();
    expect(screen.queryByTestId("chat-error-banner")).toBeNull();
  });
});
