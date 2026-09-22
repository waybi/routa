/**
 * A message sent to a session whose agent process is gone used to surface the
 * raw server string ("Session ownership lease expired on instance next-14092
 * at 2026-...") and, after Resume, the user had to retype what they said.
 * These lock the replacement behavior: plain-language banner, and the failed
 * message re-sent to the new session automatically.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { ChatPanel, isAgentGoneError } from "../chat-panel";
import { ToastProvider } from "../toast";

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
        resentAfterResume: "Agent restarted; your message has been re-sent.",
      },
      common: { tasks: "Tasks", dismiss: "Dismiss", copyToClipboard: "Copy", save: "Save", cancel: "Cancel" },
      messageBubble: {},
    },
  }),
}));

vi.mock("../tiptap-input", () => ({
  TiptapInput: ({ onSend }: { onSend: (text: string, context: Record<string, unknown>) => Promise<void> }) => (
    <button type="button" onClick={() => void onSend("what is the status?", {})}>
      Send mock prompt
    </button>
  ),
}));

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

const LEASE_ERROR =
  "Session ownership lease expired on instance next-14092 at 2026-09-21T07:19:11.447Z, and embedded ACP processes cannot be resumed on a different instance.";

function makeAcp(overrides: Partial<UseAcpState & UseAcpActions> = {}) {
  return {
    connected: true,
    sessionId: null,
    updates: [],
    providers: [],
    selectedProvider: "dsh",
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
    ...overrides,
  } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("isAgentGoneError", () => {
  it("recognises the three server phrasings for a dead agent", () => {
    expect(isAgentGoneError(LEASE_ERROR)).toBe(true);
    expect(isAgentGoneError("ACP agent (dsh) process is not running")).toBe(true);
    expect(isAgentGoneError("No Claude Code process for session: abc")).toBe(true);
    expect(isAgentGoneError("No ACP agent process for session: abc")).toBe(true);
  });

  it("leaves unrelated errors alone", () => {
    expect(isAgentGoneError("Prompt failed")).toBe(false);
    expect(isAgentGoneError("Rate limit exceeded")).toBe(false);
    expect(isAgentGoneError(null)).toBe(false);
    expect(isAgentGoneError(undefined)).toBe(false);
  });
});

describe("ChatPanel when the agent is gone", () => {
  it("replaces the raw lease error with plain language and keeps the raw text as a tooltip", () => {
    render(
      <ChatPanel
        acp={makeAcp({ error: LEASE_ERROR })}
        activeSessionId="session-dead"
        onEnsureSession={async () => "session-dead"}
        onSelectSession={async () => {}}
        onResumeActiveSession={async () => {}}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    const banner = screen.getByTestId("chat-error-banner");
    expect(banner.textContent).toContain("This agent is no longer running.");
    expect(banner.textContent).toContain("Click Resume to start it again.");
    // The internal instance id / lease timestamp must not be the headline.
    expect(banner.textContent).not.toContain("next-14092");
    expect(banner.getAttribute("title")).toContain("next-14092");
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("passes unrelated errors through untouched", () => {
    render(
      <ChatPanel
        acp={makeAcp({ error: "Rate limit exceeded" })}
        activeSessionId="session-1"
        onEnsureSession={async () => "session-1"}
        onSelectSession={async () => {}}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("chat-error-banner").textContent).toContain("Rate limit exceeded");
    expect(screen.queryByText("This agent is no longer running.")).toBeNull();
  });

  it("re-sends the failed message to the new session after Resume", async () => {
    // Drive the same sequence the real hook produces: the send sets acp.error,
    // Resume swaps activeSessionId, the error clears.
    const promptSession = vi.fn(async () => {});
    let currentError: string | null = null;
    let activeSessionId = "session-dead";
    const onResumeActiveSession = vi.fn(async () => {
      activeSessionId = "session-new";
      currentError = null;
    });

    const view = () => (
      <ToastProvider>
        <ChatPanel
          acp={makeAcp({ error: currentError, promptSession })}
          activeSessionId={activeSessionId}
          onEnsureSession={async () => activeSessionId}
          onSelectSession={async () => {}}
          onResumeActiveSession={onResumeActiveSession}
          repoSelection={null}
          onRepoChange={vi.fn()}
        />
      </ToastProvider>
    );
    const { rerender } = render(view());

    // 1. User sends into the dead session.
    fireEvent.click(screen.getByRole("button", { name: "Send mock prompt" }));
    await waitFor(() => expect(promptSession).toHaveBeenCalledWith("session-dead", "what is the status?", undefined));

    // 2. Server answers with the lease error; the hook surfaces it via acp.error.
    currentError = LEASE_ERROR;
    rerender(view());
    expect(screen.getByText("This agent is no longer running.")).toBeTruthy();

    // 3. User clicks Resume; parent swaps the session and clears the error.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    });
    await waitFor(() => expect(onResumeActiveSession).toHaveBeenCalledTimes(1));
    // The parent is told the panel will re-send, so it skips its restore prefill.
    expect(onResumeActiveSession).toHaveBeenCalledWith({ willAutoResend: true });
    rerender(view());

    // 4. The held message goes to the new session, once, without the user retyping it.
    await waitFor(() => {
      expect(promptSession).toHaveBeenCalledWith("session-new", "what is the status?", undefined);
    });
    expect(promptSession).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Agent restarted; your message has been re-sent.")).toBeTruthy();
  });

  it("does not re-send when Resume itself fails", async () => {
    const promptSession = vi.fn(async () => {});
    let currentError: string | null = null;
    const onResumeActiveSession = vi.fn(async () => {
      currentError = "Failed to restart Claude Code process: spawn ENOENT";
      throw new Error(currentError);
    });

    const view = () => (
      <ToastProvider>
        <ChatPanel
          acp={makeAcp({ error: currentError, promptSession })}
          activeSessionId="session-dead"
          onEnsureSession={async () => "session-dead"}
          onSelectSession={async () => {}}
          onResumeActiveSession={onResumeActiveSession}
          repoSelection={null}
          onRepoChange={vi.fn()}
        />
      </ToastProvider>
    );
    const { rerender } = render(view());

    fireEvent.click(screen.getByRole("button", { name: "Send mock prompt" }));
    await waitFor(() => expect(promptSession).toHaveBeenCalledTimes(1));
    currentError = LEASE_ERROR;
    rerender(view());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
      await Promise.resolve();
    });
    rerender(view());

    // Still only the original attempt; nothing was fired into a broken resume.
    expect(promptSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("chat-error-banner").textContent).toContain("spawn ENOENT");
  });
});
