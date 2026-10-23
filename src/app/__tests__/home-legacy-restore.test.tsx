import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import { assertDirectlyVisible } from "@/client/components/__tests__/direct-visibility";
import { HOUR, NOW, iso } from "../workspace/[workspaceId]/overview/__tests__/inbox-fixtures";

/**
 * Card 11 (Routa redesign gap 11): home page features of e4e5c162 restored
 * and directly visible — execution-mode block (R1, R2), always-on readiness
 * block with model / codebase / workspace badges (R3-R6), accessible
 * codebase check (R7) and the recent session's relative time (R8).
 */

const navState = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
const workspaceState = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; title: string; status: "active"; metadata: Record<string, string>; createdAt: string; updatedAt: string }>,
  codebases: [] as Array<{ id: string; repoPath: string }>,
}));
const acpState = vi.hoisted(() => ({ connect: vi.fn(async () => {}) }));
const clock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    now: 0,
    listeners,
    set(value: number) {
      this.now = value;
      for (const listener of listeners) listener();
    },
  };
});

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
  DesktopAppShell: ({ children }: { children: ReactNode }) => <div data-testid="desktop-shell">{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: ({ onChange }: { onChange: (selection: { path: string; name: string; branch: string }) => void }) => (
    <button type="button" data-testid="repo-picker" onClick={() => onChange({ path: "/repo2", name: "repo2", branch: "" })} />
  ),
}));
vi.mock("@/client/components/home/onboarding-card", () => ({
  OnboardingCard: ({ hasWorkspace }: { hasWorkspace: boolean }) => <div data-testid={hasWorkspace ? "onboarding-inline" : "onboarding-full"} />,
}));
vi.mock("@/client/components/home/relative-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/components/home/relative-time")>();
  return {
    ...actual,
    useMinuteClock: () => useSyncExternalStore(
      (listener) => {
        clock.listeners.add(listener);
        return () => clock.listeners.delete(listener);
      },
      () => clock.now,
    ),
  };
});

import HomePage from "../page";
import { __resetKanbanOverviewCacheForTests } from "../workspace/[workspaceId]/kanban/use-kanban-overview-data";

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
  constructor(readonly url: string) {}
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

let providers: Array<{ id: string; name: string; status: string }>;
let accessible: Set<string>;
let holdClone: Promise<Response> | null;
let sessionCreatedAt: string;
const calls: Array<{ url: string; method: string }> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function respond(url: string, init?: RequestInit): Promise<Response> | Response {
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname === "/api/tasks") return json({ tasks: [] });
  if (parsed.pathname === "/api/kanban/boards") return json({ boards: [] });
  if (parsed.pathname === "/api/sessions") {
    return json({ sessions: [{ sessionId: "sess-1234567890", name: "Fix login", workspaceId: "alpha", createdAt: sessionCreatedAt }] });
  }
  if (parsed.pathname === "/api/providers") return json({ providers });
  if (/^\/api\/workspaces\/[^/]+\/codebases$/.test(parsed.pathname)) {
    if ((init?.method ?? "GET").toUpperCase() === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { repoPath: string };
      workspaceState.codebases = [...workspaceState.codebases, { id: `c${workspaceState.codebases.length + 1}`, repoPath: body.repoPath }];
      return json({ ok: true }, 201);
    }
    return json({ codebases: workspaceState.codebases });
  }
  if (parsed.pathname === "/api/clone/branches") {
    if (holdClone) return holdClone;
    return accessible.has(parsed.searchParams.get("repoPath") ?? "") ? json({ current: "main" }) : json({ error: "Missing or invalid repoPath" }, 400);
  }
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  __resetKanbanOverviewCacheForTests();
  workspaceState.workspaces = [ws("alpha", "Alpha")];
  workspaceState.codebases = [{ id: "c1", repoPath: "/repo" }];
  providers = [{ id: "dsh", name: "DSH", status: "available" }];
  accessible = new Set(["/repo"]);
  holdClone = null;
  sessionCreatedAt = iso(NOW - HOUR);
  calls.length = 0;
  clock.now = NOW;
  navState.params = new URLSearchParams();
  acpState.connect.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem("routa.onboarding.completed", "true");
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
    return Promise.resolve(respond(String(url), init));
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderHome() {
  return render(<I18nProvider><HomePage /></I18nProvider>);
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function readinessBlock(): Promise<HTMLElement> {
  return await screen.findByTestId("home-readiness");
}

function tone(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute("data-tone");
}

const cloneCalls = () => calls.filter((call) => call.url.includes("/api/clone/"));

describe("execution-mode block (R1, R2 / AC2, C2)", () => {
  it.each([
    ["en", en],
    ["zh", zh],
  ] as const)("renders the hero text and the session / kanban / team cards in %s without any click", async (locale, dict) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    renderHome();
    const block = await screen.findByTestId("home-mode-cards");
    expect(within(block).getByTestId("home-mode-title").textContent).toBe(dict.home.whatToAdvance);
    expect(within(block).getByTestId("home-mode-hint").textContent).toBe(dict.home.homePrimaryHint);
    const expected = [
      ["sessions", dict.home.sessionsSurfaceTitle, dict.home.modeSessionDescription, dict.home.modeSessionTechnical, "/workspace/alpha/sessions"],
      ["kanban", dict.home.kanbanSurfaceTitle, dict.home.modeKanbanDescription, dict.home.modeKanbanTechnical, "/workspace/alpha/kanban"],
      ["team", dict.home.teamSurfaceTitle, dict.home.modeTeamDescription, dict.home.modeTeamTechnical, "/workspace/alpha/team"],
    ] as const;
    const cards = within(block).getAllByRole("link");
    expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual(expected.map(([key]) => `home-mode-card-${key}`));
    for (const [key, title, description, technical, href] of expected) {
      const card = within(block).getByTestId(`home-mode-card-${key}`);
      expect(card.getAttribute("href")).toBe(href);
      const text = card.textContent ?? "";
      for (const piece of [dict.home.surfaceLabel, title, description, dict.home.modeTechnicalLabel, technical]) {
        expect(text).toContain(piece);
      }
      assertDirectlyVisible(card, `mode card ${key}`);
    }
    expect(within(block).getByTestId("home-mode-card-team").getAttribute("href")?.endsWith("/team")).toBe(true);

    const header = screen.getByTestId("home-page").querySelector("header")!;
    const grid = screen.getByTestId("home-workspace-grid");
    expect(header.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).getByTestId("home-mode-card-sessions").parentElement?.className).toContain("grid-cols-1");
  });

  it("does not render the mode cards on the full-page onboarding without workspaces", async () => {
    workspaceState.workspaces = [];
    renderHome();
    expect(await screen.findByTestId("onboarding-full")).toBeTruthy();
    expect(screen.queryByTestId("home-mode-cards")).toBeNull();
  });
});

describe("readiness block (R3-R6 / AC3, C3)", () => {
  const matrix = [true, false].flatMap((model) => [true, false].flatMap((codebase) => [true, false].map((onboarding) => ({ model, codebase, onboarding }))));

  it.each(matrix)("model=$model codebase=$codebase onboarding=$onboarding: three badges, clickable in both states", async ({ model, codebase, onboarding }) => {
    if (!model) providers = [];
    if (!codebase) accessible = new Set();
    if (onboarding) window.localStorage.removeItem("routa.onboarding.completed");
    renderHome();
    const block = await readinessBlock();
    await waitFor(() => expect(tone("home-readiness-codebase")).toBe(codebase ? "success" : "attention"));
    expect(within(block).getByRole("heading").textContent).toBe(en.home.readinessTitle);
    expect(tone("home-readiness-model")).toBe(model ? "success" : "attention");
    expect(tone("home-readiness-workspace")).toBe("success");
    expect(screen.getByTestId("home-readiness-model").textContent).toBe(en.home.readinessModel);
    expect(screen.getByTestId("home-readiness-codebase").textContent).toBe(en.home.readinessCodebase);
    expect(screen.getByTestId("home-readiness-workspace").textContent).toBe(en.home.readinessWorkspace);
    expect(Boolean(screen.queryByTestId("onboarding-inline"))).toBe(onboarding);
    for (const id of ["home-readiness-model", "home-readiness-codebase", "home-readiness-workspace"]) {
      assertDirectlyVisible(screen.getByTestId(id), id);
    }

    expect(screen.getByTestId("home-readiness-model").tagName).toBe("BUTTON");
    fireEvent.click(screen.getByTestId("home-readiness-model"));
    expect(screen.getByTestId("settings-panel").getAttribute("data-tab")).toBe("providers");
    expect(screen.getByTestId("home-readiness-codebase").tagName).toBe("BUTTON");
    fireEvent.click(screen.getByTestId("home-readiness-codebase"));
    expect(screen.getByTestId("home-repo-picker")).toBeTruthy();
    // Missing items keep the redesign's explanation and buttons (F2).
    expect(Boolean(screen.queryByTestId("home-readiness-configure"))).toBe(!model);
    expect(Boolean(screen.queryByTestId("home-readiness-add-codebase"))).toBe(!codebase);
  });
});

describe("accessible codebase check (R7 / AC4, C4)", () => {
  it("(a) a registered but inaccessible codebase is attention, not success", async () => {
    accessible = new Set();
    renderHome();
    await readinessBlock();
    await waitFor(() => expect(cloneCalls()).toHaveLength(1));
    expect(tone("home-readiness-codebase")).toBe("attention");
    expect(tone("home-readiness-codebase")).not.toBe("success");
  });

  it("(b) an accessible codebase is success, checked with one read-only GET through desktopAwareFetch (web: relative /api)", async () => {
    renderHome();
    await readinessBlock();
    await waitFor(() => expect(tone("home-readiness-codebase")).toBe("success"));
    expect(cloneCalls()).toEqual([{ url: "/api/clone/branches?repoPath=%2Frepo", method: "GET" }]);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    const paths = new Set(calls.map((call) => new URL(call.url, "http://localhost").pathname));
    // The page read these before card 11; the check adds only /api/clone/branches.
    expect([...paths].sort()).toEqual(["/api/clone/branches", "/api/kanban/boards", "/api/providers", "/api/sessions", "/api/tasks", "/api/workspaces/alpha/codebases"]);
  });

  it("(c) while the check is pending the readiness block waits instead of flashing attention", async () => {
    holdClone = new Promise<Response>(() => {});
    renderHome();
    await screen.findByTestId("home-mode-cards");
    await waitFor(() => expect(cloneCalls()).toHaveLength(1));
    await flush();
    expect(screen.queryByTestId("home-readiness")).toBeNull();
  });

  it("(d) adding a second codebase re-checks and judges by the new result", async () => {
    accessible = new Set(["/repo2"]);
    renderHome();
    await readinessBlock();
    await waitFor(() => expect(tone("home-readiness-codebase")).toBe("attention"));
    fireEvent.click(screen.getByTestId("home-readiness-codebase"));
    fireEvent.click(screen.getByTestId("repo-picker"));
    await waitFor(() => expect(cloneCalls().some((call) => call.url.includes("repoPath=%2Frepo2"))).toBe(true));
    await waitFor(() => expect(tone("home-readiness-codebase")).toBe("success"));
  });

  it("(e) unmounting before the check returns drops the result without errors", async () => {
    let release: (response: Response) => void = () => {};
    holdClone = new Promise<Response>((resolve) => { release = resolve; });
    const errors = vi.spyOn(console, "error");
    const view = renderHome();
    await waitFor(() => expect(cloneCalls()).toHaveLength(1));
    view.unmount();
    release(json({ current: "main" }));
    await flush();
    expect(errors).not.toHaveBeenCalled();
  });

  it("desktop runtime: the check goes to the configured backend base URL", async () => {
    (window as unknown as { __TAURI__?: object }).__TAURI__ = {};
    window.localStorage.setItem("routa.backendBaseUrl", "http://127.0.0.1:3210");
    try {
      renderHome();
      await readinessBlock();
      await waitFor(() => expect(tone("home-readiness-codebase")).toBe("success"));
      expect(cloneCalls().map((call) => call.url)).toEqual(["http://127.0.0.1:3210/api/clone/branches?repoPath=%2Frepo"]);
    } finally {
      delete (window as unknown as { __TAURI__?: object }).__TAURI__;
    }
  });

  it("C11: 20 codebases are checked once each; minute-clock refreshes do not re-check", async () => {
    workspaceState.codebases = Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, repoPath: `/repo-${index}` }));
    accessible = new Set(["/repo-7"]);
    renderHome();
    await readinessBlock();
    await waitFor(() => expect(tone("home-readiness-codebase")).toBe("success"));
    expect(cloneCalls()).toHaveLength(20);
    act(() => clock.set(NOW + 60_000));
    await flush();
    act(() => clock.set(NOW + 120_000));
    await flush();
    expect(cloneCalls()).toHaveLength(20);
  });
});

describe("recent session time (R8 / AC5, C5)", () => {
  it.each([
    ["en", en, "8 min ago"],
    ["zh", zh, zh.homeRedesign.minutesAgo.replace("{count}", "8")],
  ] as const)("shows the relative time of the newest session in %s", async (locale, dict, expected) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    sessionCreatedAt = iso(NOW - 8 * 60_000);
    renderHome();
    const time = await screen.findByTestId("home-continue-session-time");
    expect(time.textContent).toBe(expected);
    expect(dict.homeRedesign.minutesAgo).toContain("{count}");
    assertDirectlyVisible(time, "continue-session time");
  });

  it("does not show the time before hydration (minute clock 0)", async () => {
    clock.now = 0;
    renderHome();
    await screen.findByTestId("home-continue-session");
    expect(screen.queryByTestId("home-continue-session-time")).toBeNull();
  });
});

describe("every path keeps the eight home items (F4)", () => {
  const paths = [true, false].flatMap((onboarding) => [true, false].map((ready) => ({ onboarding, ready })));

  it.each(paths)("onboarding=$onboarding allReady=$ready", async ({ onboarding, ready }) => {
    if (onboarding) window.localStorage.removeItem("routa.onboarding.completed");
    if (!ready) {
      providers = [];
      accessible = new Set();
    }
    renderHome();
    await readinessBlock();
    await screen.findByTestId("home-continue-session-time");
    await waitFor(() => expect(tone("home-readiness-codebase")).toBe(ready ? "success" : "attention"));
    for (const id of [
      "home-mode-card-team",
      "home-mode-cards",
      "home-readiness",
      "home-readiness-workspace",
      "home-readiness-model",
      "home-readiness-codebase",
      "home-continue-session-time",
    ]) {
      assertDirectlyVisible(screen.getByTestId(id), id);
    }
    // Card-4 additions stay (F2).
    expect(screen.getByTestId("home-workspace-grid")).toBeTruthy();
    expect(screen.getByTestId("home-latest-result")).toBeTruthy();
    expect(screen.getByTestId("home-create")).toBeTruthy();
  });
});
