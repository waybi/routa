import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import { assertDirectlyVisible } from "@/client/components/__tests__/direct-visibility";

import type { SessionInfo } from "../../types";
import { formatRelativeTime } from "../../ui-components";
import { SessionsPageClient } from "../sessions-page-client";
import {
  SessionsRecentButton,
  SessionsSummaryPills,
  countActiveSessions,
  pickLatestSession,
  sessionDisplayLabel,
} from "../sessions-page-summary";

/**
 * Card 11 (Routa redesign gap 11): the sessions page's "active N" and
 * "latest recovery point" pills (R15, R16) and the "recent session" button
 * that opens the newest session (R17), restored from e4e5c162
 * sessions-page-client.tsx L84, L150-160, L177-186.
 */

const { mockPush, mockFetch } = vi.hoisted(() => ({ mockPush: vi.fn(), mockFetch: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "default" }),
  useRouter: () => ({ push: mockPush }),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => <div /> }));
vi.mock("@/client/components/home-input", () => ({ HomeInput: () => <div data-testid="home-input-editor" /> }));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({ workspaces: [{ id: "default", title: "Default Workspace" }], loading: false, createWorkspace: vi.fn(async () => null) }),
}));
vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch: mockFetch }));
vi.mock("@/client/components/confirm-dialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/client/components/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const NOW = new Date("2026-10-23T12:00:00.000Z").getTime();
const MIN = 60_000;
const LIST_URL = "/api/sessions?workspaceId=default&limit=100";

function session(id: string, minutesAgo: number, extra: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: id,
    name: `Session ${id}`,
    provider: "dsh",
    role: "CRAFTER",
    workspaceId: "default",
    cwd: "/",
    createdAt: new Date(NOW - minutesAgo * MIN).toISOString(),
    ...extra,
  } as SessionInfo;
}

let listSessions: SessionInfo[] | "error";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  listSessions = [];
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === LIST_URL) {
      if (listSessions === "error") return { ok: false, status: 500, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => ({ sessions: listSessions }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.removeItem(LOCALE_STORAGE_KEY);
});

function renderPage() {
  return render(<I18nProvider><SessionsPageClient /></I18nProvider>);
}

async function pills(): Promise<HTMLElement> {
  return await screen.findByTestId("sessions-summary-pills");
}

describe("sessions page pills and recent button (R15-R17 / AC7, C7)", () => {
  it("(a) counts connecting + ready as active and shows the newest createdAt as the recovery point", async () => {
    listSessions = [
      session("err", 3, { acpStatus: "error" }),
      session("ready", 42, { acpStatus: "ready" }),
      session("conn", 8, { acpStatus: "connecting" }),
    ];
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId("session-row")).toHaveLength(3));
    const block = await pills();
    expect(within(block).getByTestId("sessions-active-count").textContent).toContain(en.workspace.active);
    expect(within(block).getByTestId("sessions-active-count-value").textContent).toBe("2");
    expect(within(block).getByTestId("sessions-latest-recovery").textContent).toContain(en.workspace.latestRecoveryPoint);
    expect(within(block).getByTestId("sessions-latest-recovery-value").textContent).toBe(formatRelativeTime(listSessions[0].createdAt));
    expect(within(block).getByTestId("sessions-latest-recovery-value").textContent).toBe("3m ago");
    for (const id of ["sessions-active-count", "sessions-latest-recovery", "sessions-recent-button"]) {
      assertDirectlyVisible(screen.getByTestId(id), id);
    }
  });

  it("shows the pills in Chinese with the zh copy", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    listSessions = [session("a", 8, { acpStatus: "ready" })];
    renderPage();
    await waitFor(() => expect(screen.getByTestId("sessions-active-count-value").textContent).toBe("1"));
    expect(screen.getByTestId("sessions-active-count").textContent).toContain(zh.workspace.active);
    expect(screen.getByTestId("sessions-latest-recovery").textContent).toContain(zh.workspace.latestRecoveryPoint);
    expect(screen.getByTestId("sessions-latest-recovery-value").textContent).toBe("8 分钟前");
  });

  it.each([
    ["with a name", { name: "Fix login redirect" }, "Fix login redirect"],
    ["without a name, with provider and role", { name: undefined, provider: "codex", role: "GATE" }, "codex · gate"],
    ["with none of them", { name: undefined, provider: undefined, role: undefined }, en.homeRedesign.sessionFallback.replace("{id}", "newest-s")],
  ] as const)("(b) the recent-session button label %s, and it opens the newest session", async (_case, extra, label) => {
    listSessions = [
      session("older-session", 30),
      session("newest-session-id", 2, extra as Partial<SessionInfo>),
      session("oldest-session", 90),
    ];
    renderPage();
    const button = await screen.findByTestId("sessions-recent-button");
    expect(button.textContent).toBe(label);
    const composer = screen.getByTestId("sessions-composer");
    expect(composer.contains(button)).toBe(true);
    fireEvent.click(button);
    expect(mockPush).toHaveBeenCalledWith("/workspace/default/sessions/newest-session-id");
  });

  it("(c) with no sessions shows 0 and no recent session, without the recent button", async () => {
    listSessions = [];
    renderPage();
    await waitFor(() => expect(screen.queryByText(en.sessionsRedesign.loadingSessions)).toBeNull());
    expect(screen.getByTestId("sessions-active-count-value").textContent).toBe("0");
    expect(screen.getByTestId("sessions-latest-recovery-value").textContent).toBe(en.workspace.noRecentSession);
    expect(screen.queryByTestId("sessions-recent-button")).toBeNull();
  });

  it("(d) a failed first read still shows the pills with 0 and no recent session", async () => {
    listSessions = "error";
    renderPage();
    await screen.findByTestId("ui-error-state");
    assertDirectlyVisible(screen.getByTestId("sessions-summary-pills"), "pills on the error path");
    expect(screen.getByTestId("sessions-active-count-value").textContent).toBe("0");
    expect(screen.getByTestId("sessions-latest-recovery-value").textContent).toBe(en.workspace.noRecentSession);
    expect(screen.queryByTestId("sessions-recent-button")).toBeNull();
  });

  it("never requests /api/kanban/boards and never PATCHes while rendering", async () => {
    listSessions = [session("a", 5, { acpStatus: "ready" })];
    renderPage();
    await screen.findByTestId("sessions-recent-button");
    const requests = mockFetch.mock.calls.map(([url, init]) => ({ url: String(url), method: ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase() }));
    expect(requests.filter((request) => request.url.includes("/api/kanban/boards"))).toEqual([]);
    expect(requests.filter((request) => request.method === "PATCH")).toEqual([]);
  });
});

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20261023;
const STATUSES = ["connecting", "ready", "error", undefined] as const;
// F3 plant check: ROUTA_CARD11_PLANT=only-ready makes the judge wrong on purpose.
const PLANT = process.env.ROUTA_CARD11_PLANT === "only-ready";

/** Judge written from the requirement, independent of the implementation. */
function judge(sessions: SessionInfo[], fallback: string) {
  const live = PLANT ? new Set(["ready"]) : new Set(["connecting", "ready"]);
  const active = sessions.reduce((sum, item) => sum + (item.acpStatus && live.has(item.acpStatus) ? 1 : 0), 0);
  if (sessions.length === 0) return { active, latestId: null as string | null, label: null as string | null };
  const newest = sessions.reduce((best, item) => (Date.parse(item.createdAt) > Date.parse(best.createdAt) ? item : best));
  let label: string;
  if (newest.name) label = newest.name;
  else if (newest.provider && newest.role) label = `${newest.provider} · ${newest.role.toLowerCase()}`;
  else if (newest.provider) label = newest.provider;
  else label = fallback.replace("{id}", newest.sessionId.slice(0, 8));
  return { active, latestId: newest.sessionId, label };
}

function randomSessions(rand: () => number, caseIndex: number): SessionInfo[] {
  const count = Math.floor(rand() * 21);
  const offsets = new Set<number>();
  while (offsets.size < count) offsets.add(Math.floor(rand() * 100_000));
  return [...offsets].map((offset, index) => ({
    sessionId: `s${caseIndex}-${index}-${Math.floor(rand() * 1e6)}`,
    name: rand() < 0.4 ? `name-${index}` : undefined,
    provider: rand() < 0.6 ? ["dsh", "codex", "claude"][Math.floor(rand() * 3)] : undefined,
    role: rand() < 0.6 ? ["ROUTA", "CRAFTER", "GATE"][Math.floor(rand() * 3)] : undefined,
    acpStatus: STATUSES[Math.floor(rand() * STATUSES.length)],
    workspaceId: "default",
    cwd: "/",
    createdAt: new Date(NOW - offset * MIN).toISOString(),
  }) as SessionInfo);
}

describe("random cross-check against the requirement (F3b)", () => {
  it(`10,000 random session lists (seed ${SEED}) match the judge`, () => {
    const rand = mulberry32(SEED);
    const fallback = en.homeRedesign.sessionFallback;
    for (let index = 0; index < 10_000; index += 1) {
      const sessions = randomSessions(rand, index);
      const expected = judge(sessions, fallback);
      const latest = pickLatestSession(sessions);
      const actual = {
        active: countActiveSessions(sessions),
        latestId: latest?.sessionId ?? null,
        label: latest ? sessionDisplayLabel(latest, fallback) : null,
      };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`case ${index} (seed ${SEED}) differs: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}; input ${JSON.stringify(sessions)}`);
      }
    }
  });

  it(`200 rendered random lists (seed ${SEED + 1}) show the judged pills and button`, () => {
    const rand = mulberry32(SEED + 1);
    const fallback = en.homeRedesign.sessionFallback;
    for (let index = 0; index < 200; index += 1) {
      const sessions = randomSessions(rand, index);
      const expected = judge(sessions, fallback);
      const onOpen = vi.fn();
      const view = render(
        <I18nProvider>
          <SessionsSummaryPills sessions={sessions} />
          <SessionsRecentButton sessions={sessions} onOpen={onOpen} />
        </I18nProvider>,
      );
      expect(screen.getByTestId("sessions-active-count-value").textContent, `case ${index}`).toBe(String(expected.active));
      const button = screen.queryByTestId("sessions-recent-button");
      if (expected.latestId === null) {
        expect(button, `case ${index}`).toBeNull();
        expect(screen.getByTestId("sessions-latest-recovery-value").textContent).toBe(en.workspace.noRecentSession);
      } else {
        expect(button?.textContent, `case ${index}`).toBe(expected.label);
        fireEvent.click(button!);
        expect(onOpen).toHaveBeenCalledWith(expected.latestId);
      }
      view.unmount();
    }
  });
});
