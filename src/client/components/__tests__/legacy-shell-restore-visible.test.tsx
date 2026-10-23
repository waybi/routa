import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import en from "@/i18n/locales/en";

import { assertDirectlyVisible, hidingReason } from "./direct-visibility";

/**
 * Card 11 (Routa redesign gap 11), AC9: one row per restored legacy feature
 * (R1-R8, R14-R18). Each row renders its page with every condition met and
 * asserts the element exists and is directly visible: not in a closed
 * <details>, no hidden / aria-hidden ancestor, no hidden / invisible /
 * opacity-0 / sr-only / group-hover: / responsive-hidden class, and no
 * hover or "more" click needed (nothing is clicked before the check).
 * Boss's rule of 2026-10-23: features of the old UI are neither removed nor
 * hidden by the redesign.
 */

const NOW = Date.UTC(2026, 9, 23, 12);
const nav = vi.hoisted(() => ({ pathname: "/", params: new URLSearchParams() }));
const state = vi.hoisted(() => ({ accessible: true }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key: string) => nav.params.get(key) }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => nav.pathname,
  useParams: () => ({ workspaceId: "alpha" }),
}));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: "alpha", title: "Alpha", status: "active", metadata: {}, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }],
    loading: false,
    createWorkspace: vi.fn(async () => null),
  }),
}));
vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({ connected: false, loading: false, connect: vi.fn(async () => {}), providers: [] }),
}));
vi.mock("@/client/components/settings-panel", () => ({
  SettingsPanel: () => null,
  loadDefaultProviders: () => ({}),
  loadDockerOpencodeAuthJson: () => "",
  loadProviderConnections: () => ({}),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("@/client/components/repo-picker", () => ({ RepoPicker: () => null }));
vi.mock("@/client/components/home/onboarding-card", () => ({ OnboardingCard: () => <div data-testid="onboarding-card" /> }));
vi.mock("@/client/components/home-input", () => ({ HomeInput: () => <div data-testid="home-input-editor" /> }));
vi.mock("@/client/components/schedule-panel", () => ({ SchedulePanel: () => <div data-testid="schedule-panel" /> }));
vi.mock("@/client/components/confirm-dialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/client/components/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/client/components/home/relative-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/components/home/relative-time")>();
  return { ...actual, useMinuteClock: () => NOW };
});

import HomePage from "@/app/page";
import { SessionsPageClient } from "@/app/workspace/[workspaceId]/sessions/sessions-page-client";
import SchedulesSettingsPage from "@/app/settings/schedules/page";
import { __resetKanbanOverviewCacheForTests } from "@/app/workspace/[workspaceId]/kanban/use-kanban-overview-data";

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close() {}
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SESSIONS = [
  { sessionId: "s-ready-0001", name: "Ready one", workspaceId: "alpha", cwd: "/", acpStatus: "ready", createdAt: new Date(NOW - 8 * 60_000).toISOString() },
  { sessionId: "s-conn-0002", name: "Connecting one", workspaceId: "alpha", cwd: "/", acpStatus: "connecting", createdAt: new Date(NOW - 30 * 60_000).toISOString() },
];

function respond(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname === "/api/tasks") return json({ tasks: [] });
  if (parsed.pathname === "/api/kanban/boards") return json({ boards: [] });
  if (parsed.pathname === "/api/sessions") return json({ sessions: SESSIONS });
  if (parsed.pathname === "/api/providers") return json({ providers: [{ id: "dsh", name: "DSH", status: "available" }] });
  if (/^\/api\/workspaces\/[^/]+\/codebases$/.test(parsed.pathname)) return json({ codebases: [{ id: "c1", repoPath: "/repo" }] });
  if (parsed.pathname === "/api/clone/branches") return state.accessible ? json({ current: "main" }) : json({ error: "invalid" }, 400);
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  __resetKanbanOverviewCacheForTests();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.accessible = true;
  nav.params = new URLSearchParams();
  window.localStorage.clear();
  window.localStorage.setItem("routa.onboarding.completed", "true");
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(respond(String(url)))));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Page = "home" | "home-inaccessible" | "sessions" | "schedules";

function renderPage(page: Page) {
  if (page === "home-inaccessible") state.accessible = false;
  nav.pathname = page === "sessions" ? "/workspace/alpha/sessions" : page === "schedules" ? "/settings/schedules" : "/";
  const body = page === "sessions" ? <SessionsPageClient /> : page === "schedules" ? <SchedulesSettingsPage /> : <HomePage />;
  render(<I18nProvider>{body}</I18nProvider>);
}

async function byTestId(testId: string, check?: (element: HTMLElement) => void): Promise<HTMLElement[]> {
  const element = await screen.findByTestId(testId);
  if (check) await waitFor(() => check(element));
  return [element];
}

function navLink(label: string, href: string): HTMLElement {
  const link = within(screen.getByTestId("settings-center-nav")).getByRole("link", { name: label });
  expect(link.getAttribute("href")).toBe(href);
  return link;
}

const tone = (value: string) => (element: HTMLElement) => expect(element.getAttribute("data-tone")).toBe(value);

/** R-number | feature | old location (e4e5c162 file:lines) | how the new UI is located | page | condition | locate */
const TABLE: ReadonlyArray<[string, string, string, string, Page, string, () => Promise<HTMLElement[]>]> = [
  ["R1", "Team mode entry card", "src/app/page.tsx:437-458", "testId home-mode-card-team (link to /team)", "home", "has a workspace",
    async () => byTestId("home-mode-card-team", (el) => expect(el.getAttribute("href")).toBe("/workspace/alpha/team"))],
  ["R2", "Execution-mode hero and mode descriptions", "src/app/page.tsx:366-371,391-460", "testId home-mode-cards / home-mode-title + text t.home.modeTeamTechnical", "home", "has a workspace",
    async () => [...await byTestId("home-mode-title"), screen.getByText(en.home.modeSessionTechnical), screen.getByText(en.home.modeTeamDescription)]],
  ["R3", "Readiness block always shown", "src/app/page.tsx:463-524", "testId home-readiness (role heading t.home.readinessTitle)", "home", "model and codebase both ready",
    async () => byTestId("home-readiness", (el) => expect(within(el).getByRole("heading").textContent).toBe(en.home.readinessTitle))],
  ["R4", "Workspace-ready badge", "src/app/page.tsx:492-497", "testId home-readiness-workspace", "home", "has a workspace",
    async () => byTestId("home-readiness-workspace", tone("success"))],
  ["R5", "Connect-model button when already connected", "src/app/page.tsx:468-479", "testId home-readiness-model (button, tone success)", "home", "model configured",
    async () => byTestId("home-readiness-model", (el) => { expect(el.tagName).toBe("BUTTON"); tone("success")(el); })],
  ["R6", "Select-codebase button when one exists", "src/app/page.tsx:480-491", "testId home-readiness-codebase (button, tone success)", "home", "accessible codebase registered",
    async () => byTestId("home-readiness-codebase", (el) => { expect(el.tagName).toBe("BUTTON"); tone("success")(el); })],
  ["R7", "Inaccessible codebase path warns", "src/app/page.tsx:188-201,275", "testId home-readiness-codebase tone attention", "home-inaccessible", "codebase path not accessible",
    async () => byTestId("home-readiness-codebase", tone("attention"))],
  ["R8", "Recent session relative time", "src/app/page.tsx:567-569", "testId home-continue-session-time", "home", "latest session 8 minutes old",
    async () => byTestId("home-continue-session-time", (el) => expect(el.textContent).toBe("8 min ago"))],
  ["R14", "Settings nav direct links: providers / registry / roles / models", "src/client/components/settings-center-nav.tsx:21-26", "role link name t.settings.* in settings-center-nav", "schedules", "on /settings/schedules",
    async () => {
      await screen.findByTestId("settings-center-nav");
      return [
        navLink(en.settings.providers, "/settings?tab=providers"),
        navLink(en.settings.registry, "/settings?tab=registry"),
        navLink(en.settings.roleDefaults, "/settings?tab=roles"),
        navLink(en.settings.models, "/settings?tab=models"),
      ];
    }],
  ["R15", "Sessions page active N pill", "src/app/workspace/[workspaceId]/sessions/sessions-page-client.tsx:84,150-154", "testId sessions-active-count", "sessions", "1 ready + 1 connecting",
    async () => byTestId("sessions-active-count", (el) => expect(el.textContent).toBe(`${en.workspace.active}2`))],
  ["R16", "Sessions page latest recovery point pill", "src/app/workspace/[workspaceId]/sessions/sessions-page-client.tsx:155-160", "testId sessions-latest-recovery", "sessions", "latest session 8 minutes old",
    async () => byTestId("sessions-latest-recovery", (el) => expect(el.textContent).toBe(`${en.workspace.latestRecoveryPoint}8m ago`))],
  ["R17", "Recent session button above the composer", "src/app/workspace/[workspaceId]/sessions/sessions-page-client.tsx:177-186", "testId sessions-recent-button", "sessions", "has sessions",
    async () => byTestId("sessions-recent-button", (el) => expect(el.textContent).toBe("Ready one"))],
  ["R18", "Schedules header trigger and runtime pills", "src/app/settings/schedules/page.tsx:56-59", "testId schedules-trigger-pill / schedules-runtime-pill", "schedules", "on /settings/schedules",
    async () => [...await byTestId("schedules-trigger-pill"), ...await byTestId("schedules-runtime-pill")]],
];

describe("restored legacy features are directly visible (AC9)", () => {
  it("covers all 13 restored items", () => {
    expect(TABLE.map(([id]) => id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R14", "R15", "R16", "R17", "R18"]);
  });

  it.each(TABLE)("%s %s (old %s; new %s) on %s when %s", async (_id, _name, _old, _locator, page, _condition, locate) => {
    renderPage(page);
    const elements = await locate();
    expect(elements.length).toBeGreaterThan(0);
    for (const element of elements) assertDirectlyVisible(element, `${_id} ${_name}`);
  });
});

describe("assertDirectlyVisible self-check (F4)", () => {
  function mount(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.getElementById("target")!;
  }

  it.each([
    ["closed details", '<details><summary>More</summary><p id="target">x</p></details>'],
    ["hidden attribute", '<div hidden><p id="target">x</p></div>'],
    ["aria-hidden", '<div aria-hidden="true"><p id="target">x</p></div>'],
    ["sr-only", '<p id="target" class="text-xs sr-only">x</p>'],
    ["opacity-0", '<div class="opacity-0"><p id="target">x</p></div>'],
    ["group-hover reveal", '<div class="group"><p id="target" class="group-hover:opacity-100">x</p></div>'],
    ["responsive hidden", '<div class="flex max-[800px]:hidden"><p id="target">x</p></div>'],
  ])("fails for %s", (_name, html) => {
    const target = mount(html);
    expect(hidingReason(target)).not.toBeNull();
    expect(() => assertDirectlyVisible(target)).toThrow(/not directly visible/);
  });

  it.each([
    ["open details", '<details open><summary>More</summary><p id="target">x</p></details>'],
    ["plain element with look-alike classes", '<div class="max-w-full overflow-hidden"><p id="target" class="truncate hover:bg-hover">x</p></div>'],
  ])("passes for %s", (_name, html) => {
    const target = mount(html);
    expect(hidingReason(target)).toBeNull();
    expect(() => assertDirectlyVisible(target)).not.toThrow();
  });
});
