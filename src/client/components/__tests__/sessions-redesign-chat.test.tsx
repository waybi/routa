import { render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AcpSessionNotification } from "@/client/acp-client";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";

import { ChatPanel } from "../chat-panel";

/**
 * Retention item 26 (working dots) through the real useChatMessages hook:
 * a turn that has only produced thought chunks — no answer text yet — still
 * shows the working indicator, and turn_complete clears it.
 */

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("../../utils/diagnostics", () => ({ desktopAwareFetch: mockFetch }));
vi.mock("../toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

vi.mock("../tiptap-input", () => ({
  TiptapInput: (props: { beforeProviderSlot?: React.ReactNode }) => (
    <div data-testid="tiptap-toolbar-mock">{props.beforeProviderSlot}</div>
  ),
}));

function makeAcp(updates: AcpSessionNotification[]): UseAcpState & UseAcpActions {
  return {
    connected: true,
    sessionId: "session-think",
    updates,
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
  } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;
}

function renderPanel(updates: AcpSessionNotification[]) {
  return render(
    <ChatPanel
      acp={makeAcp(updates)}
      activeSessionId="session-think"
      onEnsureSession={vi.fn(async () => "session-think")}
      onSelectSession={vi.fn(async () => {})}
      repoSelection={null}
      onRepoChange={vi.fn()}
    />,
  );
}

const thought = (text: string): AcpSessionNotification => ({
  sessionId: "session-think",
  update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text } },
});

describe("ChatPanel working dots while thinking", () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response("{}", { status: 404 }));
  });

  it("AC10: keeps the working dots while only thought updates have arrived, then clears on turn_complete", async () => {
    const view = renderPanel([thought("Let me look at the lane rules first…")]);

    const indicator = await screen.findByTestId("chat-working-indicator");
    expect(indicator.getAttribute("role")).toBe("status");
    // Still thinking: a second thought chunk, still no answer text.
    view.rerender(
      <ChatPanel
        acp={makeAcp([thought("Let me look at the lane rules first…"), thought(" checking the Done column")])}
        activeSessionId="session-think"
        onEnsureSession={vi.fn(async () => "session-think")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("chat-working-indicator")).toBeTruthy();

    view.rerender(
      <ChatPanel
        acp={makeAcp([
          thought("Let me look at the lane rules first…"),
          thought(" checking the Done column"),
          { sessionId: "session-think", update: { sessionUpdate: "turn_complete" } },
        ])}
        activeSessionId="session-think"
        onEnsureSession={vi.fn(async () => "session-think")}
        onSelectSession={vi.fn(async () => {})}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId("chat-working-indicator")).toBeNull());
  });

  it("AC10: the dots use the accent token and stop animating under reduced motion", async () => {
    renderPanel([thought("thinking")]);
    const indicator = await screen.findByTestId("chat-working-indicator");
    const dots = indicator.querySelectorAll("span[aria-hidden='true'] > span");
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot.className).toContain("animate-bounce");
      expect(dot.className).toContain("motion-reduce:animate-none");
    }
  });
});
