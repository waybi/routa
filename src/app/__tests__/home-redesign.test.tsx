import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../workspace/[workspaceId]/types";
import {
  DAY,
  HOUR,
  NOW,
  card,
  doneCard,
  iso,
  makeBoard,
  report,
  run,
  unmergedCard,
} from "../workspace/[workspaceId]/overview/__tests__/inbox-fixtures";

/**
 * Redesigned home page (card 4/6): workspace cards, needs-you banner,
 * latest result, preserved behaviors (restore, ?workspace=, ?mode=,
 * onboarding, readiness) and the read-only contract.
 */

const navState = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
const workspaceState = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; title: string; status: "active"; metadata: Record<string, string>; createdAt: string; updatedAt: string }>,
  codebases: [] as Array<{ id: string; repoPath: string }>,
}));
const acpState = vi.hoisted(() => ({ connect: vi.fn(async () => {}) }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key: string) => navState.params.get(key) }),
  useRouter: () => ({ replace: navState.replace, push: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({ workspaces: workspaceState.workspaces, loading: false, createWorkspace: vi.fn(async () => null) }),
}));
vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({ connected: false, loading: false, connect: acpState.connect, providers: [] }),
}));
vi.mock("@/client/components/settings-panel", () => ({
  SettingsPanel: ({ open, initialTab }: { open: boolean; initialTab?: string }) => (open ? <div data-testid="settings-panel" data-tab={initialTab} /> : null),
  loadDefaultProviders: () => ({}),
  loadDockerOpencodeAuthJson: () => "",
  loadProviderConnections: () => ({}),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children, workspaceId }: { children: ReactNode; workspaceId?: string | null }) => (
    <div data-testid="desktop-shell" data-workspace-id={workspaceId ?? ""}>{children}</div>
  ),
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("@/client/components/repo-picker", () => ({ RepoPicker: () => <div data-testid="repo-picker" /> }));
vi.mock("@/client/components/home/onboarding-card", () => ({
  OnboardingCard: ({ hasWorkspace }: { hasWorkspace: boolean }) => <div data-testid={hasWorkspace ? "onboarding-inline" : "onboarding-full"} />,
}));
vi.mock("@/client/components/home/relative-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/components/home/relative-time")>();
  return { ...actual, useMinuteClock: () => NOW };
});

import HomePage from "../page";
import {
  dismissAttentionItem,
  readAttentionDismissals,
  resetAttentionDismissalsForTests,
} from "../workspace/[workspaceId]/kanban/use-kanban-attention-dismissals";
import { buildWorkspaceRow } from "../workspace/[workspaceId]/kanban/kanban-overview-rules";
import { __resetKanbanOverviewCacheForTests } from "../workspace/[workspaceId]/kanban/use-kanban-overview-data";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
}

const localStorageMock = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
})();
Object.defineProperty(window, "localStorage", { configurable: true, value: localStorageMock });

function ws(id: string, title: string) {
  return { id, title, status: "active" as const, metadata: {}, createdAt: iso(0), updatedAt: iso(0) };
}

let DATA: Record<string, { tasks: TaskInfo[]; boards: KanbanBoardInfo[] }>;
let failTasksFor: string | null;
let holdTasks: boolean;
let providers: Array<{ id: string; name: string; status: string }>;
const calls: Array<{ url: string; method: string }> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function respond(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  const id = parsed.searchParams.get("workspaceId") ?? "";
  if (parsed.pathname === "/api/tasks") {
    if (failTasksFor === id) return new Response("boom", { status: 500 });
    return json({ tasks: DATA[id]?.tasks ?? [] });
  }
  if (parsed.pathname === "/api/kanban/boards") return json({ boards: DATA[id]?.boards ?? [] });
  if (parsed.pathname === "/api/sessions") {
    return json({ sessions: id === "alpha" ? [{ sessionId: "sess-1234567890", name: "Fix login", workspaceId: "alpha", createdAt: iso(NOW - HOUR) }] : [] });
  }
  if (parsed.pathname === "/api/providers") return json({ providers });
  if (/^\/api\/workspaces\/[^/]+\/codebases$/.test(parsed.pathname)) return json({ codebases: workspaceState.codebases });
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  __resetKanbanOverviewCacheForTests();
  workspaceState.workspaces = [ws("alpha", "Alpha"), ws("beta", "Beta")];
  workspaceState.codebases = [{ id: "c1", repoPath: "/repo" }];
  DATA = {
    alpha: {
      tasks: [
        card("a-dev", { title: "Alpha in progress", columnId: "dev", status: "IN_PROGRESS", laneSessions: [run("dev", NOW - 3 * HOUR, "running", { lastActivityAt: iso(NOW - 2 * HOUR) })] }),
        doneCard("a-fail", "failed", { title: "Alpha failed delivery" }, NOW - 5 * HOUR),
        doneCard("a-ok", "completed", { title: "Alpha shipped", completionReport: { ...report, excerpt: "Shipped the login fix", createdAt: iso(NOW - 4 * HOUR) } }, NOW - 4 * HOUR),
      ],
      boards: [makeBoard("b1", true)],
    },
    beta: {
      tasks: [
        unmergedCard("b-un", 2, { title: "Beta waiting push", boardId: "b2", completionReport: { ...report, createdAt: iso(NOW - 8 * HOUR) } }),
        doneCard("b-touched", "completed", { title: "Beta touched by page load", boardId: "b2", updatedAt: iso(NOW - 60_000), completionSummary: "old summary" }, NOW - 6 * DAY),
      ],
      boards: [makeBoard("b2", true)],
    },
  };
  failTasksFor = null;
  holdTasks = false;
  providers = [{ id: "dsh", name: "DSH", status: "available" }];
  calls.length = 0;
  navState.params = new URLSearchParams();
  navState.replace.mockClear();
  acpState.connect.mockClear();
  MockEventSource.instances = [];
  window.localStorage.clear();
  window.localStorage.setItem("routa.onboarding.completed", "true");
  resetAttentionDismissalsForTests();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
    if (holdTasks && String(url).includes("/api/tasks")) return new Promise<Response>(() => {});
    return Promise.resolve(respond(String(url)));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function cardOf(id: string): HTMLElement {
  return screen.getAllByTestId("home-workspace-card").find((element) => element.getAttribute("data-workspace-id") === id)!;
}

async function renderReady() {
  render(<HomePage />);
  await waitFor(() => expect(within(cardOf("beta")).queryByTestId("home-workspace-needs-you-value")).toBeTruthy());
  await waitFor(() => expect(within(cardOf("alpha")).queryByTestId("home-workspace-needs-you-value")).toBeTruthy());
}

describe("layout (AC1)", () => {
  it("renders one card per workspace with open and needs-you links", async () => {
    await renderReady();
    expect(screen.getAllByTestId("home-workspace-card")).toHaveLength(2);
    expect(within(cardOf("beta")).getByTestId("home-workspace-open").getAttribute("href")).toBe("/workspace/beta/kanban");
    expect(within(cardOf("beta")).getByTestId("home-workspace-needs-you").getAttribute("href")).toBe("/workspace/beta/overview");
    expect(screen.getByTestId("home-enter-board").getAttribute("href")).toBe("/workspace/alpha/kanban");
  });

  it("shows the banner with total and top item, linking to overview?view=all", async () => {
    await renderReady();
    const banner = screen.getByTestId("home-attention-banner");
    expect(banner.textContent).toContain("2 items need you");
    expect(banner.textContent).toContain("Alpha failed delivery");
    expect(within(banner).getByRole("link").getAttribute("href")).toBe("/workspace/alpha/overview?view=all");
  });

  it("hides the banner when nothing needs you", async () => {
    DATA.alpha.tasks = [DATA.alpha.tasks[0]];
    DATA.beta.tasks = [];
    await renderReady();
    expect(screen.queryByTestId("home-attention-banner")).toBeNull();
  });

  it("links the latest result to the completion tab", async () => {
    await renderReady();
    const result = screen.getByTestId("home-latest-result");
    expect(result.textContent).toContain("Alpha shipped");
    expect(result.textContent).toContain("Shipped the login fix");
    const href = within(result).getByTestId("home-read-report").getAttribute("href") ?? "";
    expect(href).toBe("/workspace/alpha/kanban?boardId=b1&taskId=a-ok&detailTab=completion");
  });

  it("shows an empty latest result when no report exists", async () => {
    DATA.alpha.tasks = [DATA.alpha.tasks[0]];
    DATA.beta.tasks = [];
    await renderReady();
    expect(within(screen.getByTestId("home-latest-result")).getByTestId("ui-empty-state")).toBeTruthy();
  });

  it("offers new card, new session and continue-recent-session links", async () => {
    await renderReady();
    expect(screen.getByTestId("home-new-card").getAttribute("href")).toBe("/workspace/alpha/kanban");
    expect(screen.getByTestId("home-new-session").getAttribute("href")).toBe("/workspace/alpha/sessions");
    await waitFor(() => expect(screen.getByTestId("home-continue-session").getAttribute("href")).toBe("/workspace/alpha/sessions/sess-1234567890"));
  });
});

describe("counts (AC2)", () => {
  it("counts in progress by column and shows the full title of the newest activity", async () => {
    await renderReady();
    const alpha = cardOf("alpha");
    expect(within(alpha).getByTestId("home-workspace-in-progress-value").textContent).toBe("1");
    const activity = within(alpha).getByTestId("home-workspace-activity").textContent ?? "";
    expect(activity).toContain("2 h ago");
    expect(activity).toContain("Alpha in progress");
  });

  it("needs-you count equals buildWorkspaceRow(...).attention.length minus local hides", async () => {
    dismissAttentionItem("b2", "b-un|unmerged|2");
    await renderReady();
    for (const id of ["alpha", "beta"]) {
      const row = buildWorkspaceRow(ws(id, id), DATA[id].tasks, DATA[id].boards, NOW, "", readAttentionDismissals);
      expect(within(cardOf(id)).getByTestId("home-workspace-needs-you-value").textContent).toBe(String(row.attention.length));
    }
    expect(within(cardOf("beta")).getByTestId("home-workspace-needs-you-value").textContent).toBe("0");
  });

  it("ignores a fresh updatedAt when choosing the latest activity", async () => {
    await renderReady();
    const activity = within(cardOf("beta")).getByTestId("home-workspace-activity").textContent ?? "";
    expect(activity).toContain("Beta waiting push");
    expect(activity).not.toContain("Beta touched by page load");
  });

  it("shows no-activity text for an empty workspace", async () => {
    DATA.beta.tasks = [];
    await renderReady();
    expect(within(cardOf("beta")).getByTestId("home-workspace-activity").textContent).toContain("No activity yet");
  });
});

describe("preserved behaviors (AC3)", () => {
  it("?workspace=<id> wins over the restored workspace", async () => {
    window.localStorage.setItem("routa.desktop.last-workspace-id", "alpha");
    navState.params = new URLSearchParams("workspace=beta");
    await renderReady();
    expect(screen.getByTestId("home-enter-board").getAttribute("href")).toBe("/workspace/beta/kanban");
  });

  it("restores the last workspace from localStorage and passes it to the shell after mount", async () => {
    window.localStorage.setItem("routa.desktop.last-workspace-id", "beta");
    await renderReady();
    expect(screen.getByTestId("home-enter-board").getAttribute("href")).toBe("/workspace/beta/kanban");
    expect(screen.getByTestId("desktop-shell").getAttribute("data-workspace-id")).toBe("beta");
  });

  it.each([
    ["session", "/workspace/alpha/sessions"],
    ["team", "/workspace/alpha/team"],
    ["planning", "/workspace/alpha/kanban"],
  ])("?mode=%s redirects to %s", async (mode, target) => {
    navState.params = new URLSearchParams(`mode=${mode}`);
    render(<HomePage />);
    await waitFor(() => expect(navState.replace).toHaveBeenCalledWith(target));
  });

  it("shows the full-page onboarding without workspaces", async () => {
    workspaceState.workspaces = [];
    render(<HomePage />);
    expect(await screen.findByTestId("onboarding-full")).toBeTruthy();
    expect(screen.queryByTestId("home-page")).toBeNull();
  });

  it("shows the inline onboarding until it is dismissed", async () => {
    window.localStorage.removeItem("routa.onboarding.completed");
    await renderReady();
    expect(screen.getByTestId("onboarding-inline")).toBeTruthy();
  });

  it("shows a readiness notice that opens the executor settings when no model is ready", async () => {
    providers = [];
    workspaceState.codebases = [];
    await renderReady();
    const notice = await screen.findByTestId("home-readiness");
    fireEvent.click(within(notice).getByTestId("home-readiness-configure"));
    expect(screen.getByTestId("settings-panel").getAttribute("data-tab")).toBe("providers");
    expect(acpState.connect).toHaveBeenCalledTimes(1);
    fireEvent.click(within(notice).getByTestId("home-readiness-add-codebase"));
    expect(screen.getByTestId("repo-picker")).toBeTruthy();
  });

  it("hides the readiness notice when model and codebase are ready", async () => {
    await renderReady();
    await waitFor(() => expect(calls.some((call) => call.url.includes("/api/providers"))).toBe(true));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/codebases"))).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("home-readiness")).toBeNull();
  });
});

describe("loading and error (AC8)", () => {
  it("does not flash the missing-codebase notice before codebases are read", async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => (
      String(url).includes("/codebases") ? new Promise<Response>(() => {}) : realFetch(url, init)
    )));
    await renderReady();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("home-readiness")).toBeNull();
  });


  it("shows skeletons, not 0, while loading", async () => {
    holdTasks = true;
    render(<HomePage />);
    await waitFor(() => expect(screen.getAllByTestId("home-workspace-card")).toHaveLength(2));
    expect(screen.queryByTestId("home-workspace-in-progress-value")).toBeNull();
    expect(screen.queryByTestId("home-workspace-needs-you-value")).toBeNull();
    expect(screen.queryByTestId("home-attention-banner")).toBeNull();
  });

  it("shows which workspace failed and read-again refetches it", async () => {
    failTasksFor = "beta";
    render(<HomePage />);
    const error = await within(await waitFor(() => cardOf("beta"))).findByTestId("ui-error-state");
    expect(error.textContent).toContain("Beta");
    const before = calls.filter((call) => call.url.includes("/api/tasks?workspaceId=beta")).length;
    failTasksFor = null;
    fireEvent.click(within(error).getByRole("button"));
    await waitFor(() => expect(within(cardOf("beta")).queryByTestId("ui-error-state")).toBeNull());
    expect(calls.filter((call) => call.url.includes("/api/tasks?workspaceId=beta")).length).toBe(before + 1);
  });
});

describe("read-only (AC7)", () => {
  it("opening the home page issues only GET requests and never connects ACP", async () => {
    await renderReady();
    await waitFor(() => expect(calls.some((call) => call.url.includes("/api/sessions"))).toBe(true));
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(calls.some((call) => call.url.includes("revive") || call.url.includes("/api/acp") || call.url.includes("/api/clone"))).toBe(false);
    const allowed = new Set(["/api/tasks", "/api/kanban/boards", "/api/sessions", "/api/providers", "/api/workspaces/alpha/codebases"]);
    expect(calls.map((call) => new URL(call.url, "http://localhost").pathname).filter((path) => !allowed.has(path))).toEqual([]);
    expect(acpState.connect).not.toHaveBeenCalled();
    expect(MockEventSource.instances.every((source) => source.url.includes("/api/kanban/events"))).toBe(true);
  });
});
