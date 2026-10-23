import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeamRunPageClient } from "../team-run-page-client";

const { mockFetch, mockPush, notesState, modalProps } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockPush: vi.fn(),
  notesState: { notes: [] as unknown[] },
  modalProps: [] as Array<{ selectedSessionForModal: string }>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, refresh: vi.fn() }) }));

vi.mock("@/i18n", async () => {
  const { default: zh } = await vi.importActual<typeof import("@/i18n/locales/zh")>("@/i18n/locales/zh");
  return { useTranslation: () => ({ t: zh, locale: "zh", setLocale: () => {} }) };
});

vi.mock("../use-real-team-run-params", () => ({
  useRealTeamRunParams: () => ({ workspaceId: "default", sessionId: "session-1", isResolved: true }),
}));

const acpStub = {
  connected: true,
  loading: false,
  sessionId: "session-1",
  updates: [],
  providers: [],
  selectedProvider: "codex",
  connect: async () => {},
  prompt: async () => {},
  promptSession: async () => {},
  setProvider: () => {},
  selectSession: () => {},
  listProviderModels: async () => [],
  respondToUserInputForSession: async () => {},
};
vi.mock("@/client/hooks/use-acp", () => ({ useAcp: () => acpStub }));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({ workspaces: [{ id: "default", title: "Default Workspace" }], loading: false, createWorkspace: vi.fn() }),
  useCodebases: () => ({ codebases: [] }),
}));
vi.mock("@/client/hooks/use-notes", () => ({ useNotes: () => notesState }));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => <div /> }));
vi.mock("@/client/components/tiptap-input", () => ({
  TiptapInput: (props: { disabled?: boolean; placeholder?: string }) => (
    <textarea data-testid="tiptap-input" disabled={props.disabled} placeholder={props.placeholder} />
  ),
}));
vi.mock("@/client/components/message-bubble", () => ({
  MessageBubble: ({ message }: { message: { content: string } }) => <div data-testid="message-bubble">{message.content}</div>,
  AskUserQuestionBubble: () => <div data-testid="ask-bubble" />,
}));
vi.mock("../team-run-session-modal", () => ({
  TeamRunSessionModal: (props: { selectedSessionForModal: string }) => {
    modalProps.push(props);
    return <div data-testid="member-session-modal">{props.selectedSessionForModal}</div>;
  },
}));
vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch: mockFetch }));

type Json = Record<string, unknown>;
const ok = (body: Json) => ({ ok: true, status: 200, json: async () => body }) as Response;

const SESSION = {
  sessionId: "session-1", name: "Team - Original run", workspaceId: "default", cwd: "/repo/routa", branch: "issue/x",
  provider: "dsh", role: "ROUTA", acpStatus: "ready", createdAt: "2026-10-20T00:00:00.000Z",
};
const CHILD = {
  sessionId: "child-qa", name: "QA lane", workspaceId: "default", cwd: "/repo/routa", role: "GATE",
  specialistId: "team-qa", parentSessionId: "session-1", createdAt: "2026-10-20T01:00:00.000Z",
};

interface Routes { session?: () => Response | Promise<Response> }
let sessionOverride: Json = {};

function install(routes: Routes = {}) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== "GET") return ok({});
    if (url === "/api/specialists") return ok({ specialists: [{ id: "team-agent-lead", name: "组长" }, { id: "team-qa", name: "QA" }] });
    if (url === "/api/sessions/session-1") return routes.session ? routes.session() : ok({ session: { ...SESSION, ...sessionOverride } });
    if (url === "/api/sessions?workspaceId=default") return ok({ sessions: [SESSION, CHILD] });
    if (url === "/api/sessions?workspaceId=default&surface=team") {
      return ok({ sessions: [SESSION, { ...SESSION, sessionId: "session-2", name: "Team - Follow-up" }] });
    }
    if (url === "/api/agents?workspaceId=default") return ok({ agents: [] });
    if (url === "/api/sessions/session-1/transcript") {
      return ok({
        history: [
          { sessionId: "session-1", update: { sessionUpdate: "user_message", content: { type: "text", text: "Fix login" } } },
          { sessionId: "session-1", update: { sessionUpdate: "tool_call_update", title: "delegate_task", status: "completed", rawInput: { specialist: "team-qa" } } },
        ],
        messages: [],
      });
    }
    if (url === "/api/sessions/child-qa/transcript") {
      return ok({ history: [{ sessionId: "child-qa", update: { sessionUpdate: "task_completion", taskStatus: "COMPLETED", completionSummary: "All good" } }], messages: [] });
    }
    return ok({});
  });
}

const callsTo = (url: string) => mockFetch.mock.calls.filter(([input]) => String(input) === url).length;
const selectedTab = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

async function renderLoaded() {
  render(<TeamRunPageClient />);
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
}

beforeEach(() => {
  vi.clearAllMocks();
  modalProps.length = 0;
  sessionOverride = {};
  notesState.notes = [];
  install();
});

describe("AC9 team session header", () => {
  it("shows eyebrow, id, missing model, role, branch and Chinese status", async () => {
    await renderLoaded();
    const header = screen.getByTestId("team-run-page-header");
    expect(within(header).getByText("团队会话")).toBeTruthy();
    expect(within(header).getByText("Original run")).toBeTruthy();
    expect(within(header).getByTitle("session-1").textContent).toBe("session-");
    expect(within(header).getByTestId("team-run-model").textContent).toBe("模型未记录");
    expect(within(header).getByText("ROUTA")).toBeTruthy();
    expect(within(header).getByText("issue/x")).toBeTruthy();
    expect(within(header).getByTestId("team-run-status").textContent).toBe("就绪");
  });

  it("shows the model when recorded and still switches runs", async () => {
    sessionOverride = { model: "claude-opus-5-5" };
    await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("team-run-model").textContent).toBe("claude-opus-5-5"));
    fireEvent.click(screen.getByTestId("team-run-switcher"));
    const options = screen.getAllByTestId("team-run-switch-option");
    expect(options).toHaveLength(2);
    fireEvent.click(options[1]);
    expect(mockPush).toHaveBeenCalledWith("/workspace/default/team/session-2");
  });
});

describe("AC10 three tabs and right column", () => {
  it("defaults to 对话, arrow keys move to 事件, events are Chinese and open the member modal", async () => {
    await renderLoaded();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["对话", "事件", "证据"]);
    expect(selectedTab()).toBe("对话");
    expect(screen.queryByText(/lg:grid-cols-\[248px/)).toBeNull();
    expect(document.querySelector('[class*="lg:grid-cols-[248px_minmax"]')).toBeNull();

    const conversationTab = screen.getAllByRole("tab")[0];
    conversationTab.focus();
    fireEvent.keyDown(conversationTab, { key: "ArrowRight" });
    expect(selectedTab()).toBe("事件");

    await waitFor(() => expect(screen.getAllByTestId("team-run-event").length).toBeGreaterThan(0));
    const titles = screen.getAllByTestId("team-run-event-title").map((node) => node.textContent ?? "");
    expect(titles).toContain("设定目标");
    expect(titles.some((title) => title.startsWith("派活给"))).toBe(true);
    expect(titles.join(" ")).not.toMatch(/Task assigned to|Objective set|Opened session for/);

    fireEvent.click(screen.getAllByTestId("team-run-event-open")[0]);
    await waitFor(() => expect(screen.getByTestId("member-session-modal")).toBeTruthy());
  });

  it("right column shows context, members and related links", async () => {
    await renderLoaded();
    const context = screen.getByTestId("team-run-context");
    expect(within(context).getByText("会话上下文")).toBeTruthy();
    expect(within(context).getByText("dsh")).toBeTruthy();
    expect(within(context).getByText("/repo/routa")).toBeTruthy();
    expect(within(context).getAllByText("未记录").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("团队成员")).toBeTruthy();
    expect(screen.getByTestId("team-run-link-traces").getAttribute("href")).toBe("/traces?sessionId=session-1&workspaceId=default");
    expect(screen.getByTestId("team-run-link-replay").getAttribute("href")).toBe("/debug/acp-replay?sessionId=session-1");
  });

  it("clicking a plan task in 证据 returns to 对话", async () => {
    notesState.notes = [{
      id: "task-1", title: "Verify login", content: "", workspaceId: "default", sessionId: "session-1",
      metadata: { type: "task", taskStatus: "IN_PROGRESS", childSessionId: "child-qa" },
      createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
    }];
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(selectedTab()).toBe("证据");
    const node = await screen.findByTestId("team-task-node");
    expect(within(node).getByText("进行中")).toBeTruthy();
    fireEvent.click(node);
    expect(selectedTab()).toBe("对话");
  });

  it("clicking a team member returns to 对话", async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(selectedTab()).toBe("事件");
    await waitFor(() => expect(screen.getAllByTestId("team-member-item").length).toBeGreaterThan(0));
    const enabled = screen.getAllByTestId("team-member-item").find((item) => !(item as HTMLButtonElement).disabled)!;
    fireEvent.click(enabled);
    expect(selectedTab()).toBe("对话");
  });
});

describe("AC11 load and error states", () => {
  it("shows a skeleton and a disabled input before metadata arrives", async () => {
    install({ session: () => new Promise<Response>(() => {}) });
    render(<TeamRunPageClient />);
    expect(screen.getByTestId("ui-skeleton")).toBeTruthy();
    expect((screen.getByTestId("tiptap-input") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("a 500 on the current session shows ErrorState and reload reads it again", async () => {
    install({ session: () => ({ ok: false, status: 500, json: async () => ({}) }) as Response });
    render(<TeamRunPageClient />);
    const error = await screen.findByTestId("ui-error-state");
    expect(error.textContent).toContain("团队会话读取失败");
    const before = callsTo("/api/sessions/session-1");
    fireEvent.click(within(error).getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(callsTo("/api/sessions/session-1")).toBe(before + 1));
  });

  it("a network error on reread keeps the shown run name", async () => {
    let count = 0;
    install({ session: () => (count++ === 0 ? ok({ session: SESSION }) : Promise.reject(new Error("offline"))) });
    await renderLoaded();
    fireEvent.click(screen.getByTestId("team-run-refresh"));
    await screen.findByTestId("ui-error-state");
    expect(within(screen.getByTestId("team-run-page-header")).getByText("Original run")).toBeTruthy();
    expect(screen.getByTestId("team-run-model").textContent).toBe("模型未记录");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("other endpoints failing does not show the page error", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sessions/session-1") return ok({ session: SESSION });
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });
    render(<TeamRunPageClient />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
    expect(screen.queryByTestId("ui-error-state")).toBeNull();
  });
});

describe("C7 opening the team session page only reads", () => {
  it("mount issues GET requests to known endpoints only", async () => {
    await renderLoaded();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const calls = mockFetch.mock.calls.map(([input, init]) => ({ url: String(input), method: (init as RequestInit | undefined)?.method ?? "GET" }));
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    const allowed = /^\/api\/(agents\?workspaceId=|sessions(\?workspaceId=|\/[^/]+(\/transcript)?$)|specialists$)/;
    for (const call of calls) expect(call.url).toMatch(allowed);
    expect(calls.some((call) => call.url.startsWith("/api/kanban"))).toBe(false);
  });
});

describe("AC16 keyboard on the team session page", () => {
  it("header actions, tabs, related links and the input accept focus", async () => {
    await renderLoaded();
    const targets = [
      screen.getByTestId("team-run-back"),
      screen.getByTestId("team-run-switcher"),
      screen.getByTestId("team-run-refresh"),
      screen.getByTestId("team-run-open-session"),
      screen.getAllByRole("tab")[0],
      screen.getByTestId("team-run-link-traces"),
      screen.getByTestId("team-run-link-replay"),
    ];
    for (const element of targets) {
      element.focus();
      expect(document.activeElement).toBe(element);
      expect(element.getAttribute("tabindex")).not.toBe("-1");
    }
    fireEvent.click(screen.getAllByRole("tab")[1]);
    await waitFor(() => expect(screen.getAllByTestId("team-run-event-open").length).toBeGreaterThan(0));
    const action = screen.getAllByTestId("team-run-event-open")[0];
    action.focus();
    expect(document.activeElement).toBe(action);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(selectedTab()).toBe("对话");
  });
});
