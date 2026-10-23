import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeamPageClient } from "../team-page-client";
import { readTeamSpecialistNames, SPECIALISTS_ROOT } from "./team-yaml-names";

/** Team page v2 shows the zh-CN yaml name for bundled specialists, else the API name. */
const ZH_NAMES = readTeamSpecialistNames(join(SPECIALISTS_ROOT, "locales/zh-CN/team"));
const shownName = (id: string, apiName: string) => ZH_NAMES[id] ?? apiName;
const nameOf = (item: HTMLElement) => within(item).getByTestId("team-roster-name").textContent;

/**
 * Legacy team-page features that must stay directly visible after the redesign
 * (baseline e4e5c162): always-visible roster, the three run/active/member
 * stats and the per-specialist role badge.
 */

const { mockPush, mockFetch, homeInputProps, i18nState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockFetch: vi.fn(),
  homeInputProps: [] as Array<Record<string, unknown>>,
  i18nState: { locale: "zh" as "zh" | "en" },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "default" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/i18n", async () => {
  const { default: zh } = await vi.importActual<typeof import("@/i18n/locales/zh")>("@/i18n/locales/zh");
  const { default: en } = await vi.importActual<typeof import("@/i18n/locales/en")>("@/i18n/locales/en");
  return {
    useTranslation: () => ({ t: i18nState.locale === "en" ? en : zh, locale: i18nState.locale, setLocale: () => {} }),
  };
});

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));
vi.mock("@/client/components/home-input", () => ({
  HomeInput: (props: Record<string, unknown>) => {
    homeInputProps.push(props);
    return <div data-testid="home-input"><textarea data-testid="home-input-textarea" /></div>;
  },
}));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: "default", title: "Default Workspace" }],
    loading: false,
    createWorkspace: vi.fn(async () => null),
  }),
}));
vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch: mockFetch }));

type Json = Record<string, unknown>;
const ok = (body: Json) => ({ ok: true, status: 200, json: async () => body }) as Response;
const fail = (status = 503) => ({ ok: false, status, json: async () => ({}) }) as Response;

const RUNS_URL = "/api/sessions?workspaceId=default&surface=team";
const ALL_URL = "/api/sessions?workspaceId=default";
const AGENTS_URL = "/api/agents?workspaceId=default";
const SPECIALISTS_URL = "/api/specialists";

const RUNS = [
  { sessionId: "run-bbb-2", name: "Team - Middle run", workspaceId: "default", cwd: "/repo/routa", branch: "main", role: "ROUTA", specialistId: "team-agent-lead", acpStatus: "error", createdAt: "2026-10-20T00:00:00.000Z", descendants: 2 },
  { sessionId: "run-aaa-1", name: "Team - Newest run", workspaceId: "default", cwd: "", role: "ROUTA", acpStatus: "ready", terminalState: "completed", createdAt: "2026-10-22T00:00:00.000Z", descendants: 0, routaAgentId: "agent-new" },
  { sessionId: "run-ccc-3", name: "Team - Oldest run", workspaceId: "default", cwd: "", workspaceIdExtra: 1, createdAt: "2026-10-18T00:00:00.000Z" },
];

const AGENTS = [
  { id: "agent-old", name: "routa-coordinator-old", role: "ROUTA", status: "PENDING", createdAt: "2026-10-01T00:00:00.000Z" },
  { id: "agent-new", name: "routa-coordinator-new", role: "ROUTA", status: "ACTIVE", createdAt: "2026-10-22T00:00:00.000Z", metadata: { displayLabel: "Lead Alpha" } },
];

const SPECIALISTS = [
  { id: "team-qa", name: "QA Specialist", description: "Tests things" },
  { id: "team-agent-lead", name: "Agent Lead", description: "Leads" },
  { id: "team-researcher", name: "Researcher", description: "Researches" },
  { id: "kanban-dev", name: "Kanban Dev" },
];

interface Routes { runs?: () => Response | Promise<Response>; agents?: () => Response; specialists?: () => Response | Promise<Response> }

function install(routes: Routes = {}) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== "GET") return ok({});
    if (url === RUNS_URL) return routes.runs ? routes.runs() : ok({ sessions: RUNS });
    if (url === ALL_URL) return ok({ sessions: [] });
    if (url === AGENTS_URL) return routes.agents ? routes.agents() : ok({ agents: AGENTS });
    if (url === SPECIALISTS_URL) return routes.specialists ? routes.specialists() : ok({ specialists: SPECIALISTS });
    return ok({});
  });
}

const callsTo = (url: string) => mockFetch.mock.calls.filter(([input]) => String(input) === url).length;

/** Reads the number in one stat item; the expected values below are hand-computed from the legacy rules. */
function statNumber(testId: string): number {
  const item = screen.queryByTestId(testId);
  expect(item, `${testId} should be rendered`).not.toBeNull();
  const value = item?.querySelector("[data-stat-value]")?.textContent ?? "";
  expect(value).toMatch(/^\d+$/);
  return Number(value);
}
const stats = () => [statNumber("team-stat-runs"), statNumber("team-stat-active"), statNumber("team-stat-members")];
const roleOf = (item: HTMLElement) => {
  const roles = within(item).queryAllByTestId("team-roster-role");
  expect(roles).toHaveLength(1);
  return roles[0].textContent;
};

async function renderLoaded(runCount = 3) {
  render(<TeamPageClient />);
  if (runCount > 0) await waitFor(() => expect(screen.getAllByTestId("team-run-row")).toHaveLength(runCount));
  await waitFor(() => expect(callsTo(SPECIALISTS_URL)).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  homeInputProps.length = 0;
  i18nState.locale = "zh";
  install();
});

describe("AC1 roster is always visible", () => {
  it("has no details element and lists every team specialist without any click", async () => {
    await renderLoaded();
    const roster = screen.getByTestId("team-roster");
    await waitFor(() => expect(within(roster).getAllByTestId("team-roster-item")).toHaveLength(3));
    expect(roster.querySelector("details")).toBeNull();
    expect(roster.closest("details")).toBeNull();
    for (const item of within(roster).getAllByTestId("team-roster-item")) {
      expect(item.closest("details")).toBeNull();
    }
    const summary = screen.getByTestId("team-roster-summary");
    expect(summary.textContent).toBe("团队岗位（3 个）");
    expect(summary.tagName).not.toBe("SUMMARY");
    expect(screen.getByTestId("team-roster-manage-link").getAttribute("href")).toBe("/settings/specialists");
    expect(screen.getByRole("region", { name: "团队岗位（3 个）" })).toBe(roster);
  });

  it("a failed reread keeps the list visible with role badges and the reload button", async () => {
    let count = 0;
    install({ specialists: () => (count++ === 0 ? ok({ specialists: SPECIALISTS }) : fail()) });
    await renderLoaded();
    await waitFor(() => expect(screen.getAllByTestId("team-roster-item")).toHaveLength(3));
    fireEvent.click(screen.getByText("刷新"));
    const errorBox = await screen.findByTestId("team-roster-error");
    expect(within(errorBox).getByText("重新读取")).toBeTruthy();
    const roster = screen.getByTestId("team-roster");
    expect(roster.querySelector("details")).toBeNull();
    const items = within(roster).getAllByTestId("team-roster-item");
    expect(items.map(roleOf)).toEqual(["负责人", "专家", "专家"]);
  });
});

describe("AC2 run / active / member stats", () => {
  const FIVE_RUNS = [
    { sessionId: "s-1", name: "Team - a", workspaceId: "default", cwd: "", acpStatus: "connecting", createdAt: "2026-10-01T00:00:00.000Z" },
    { sessionId: "s-2", name: "Team - b", workspaceId: "default", cwd: "", acpStatus: "ready", createdAt: "2026-10-02T00:00:00.000Z" },
    { sessionId: "s-3", name: "Team - c", workspaceId: "default", cwd: "", acpStatus: "ready", terminalState: "completed", createdAt: "2026-10-03T00:00:00.000Z" },
    { sessionId: "s-4", name: "Team - d", workspaceId: "default", cwd: "", acpStatus: "error", createdAt: "2026-10-04T00:00:00.000Z" },
    { sessionId: "s-5", name: "Team - e", workspaceId: "default", cwd: "", createdAt: "2026-10-05T00:00:00.000Z" },
  ];

  it.each([
    { label: "a) fixture runs and specialists", runs: RUNS, specialists: SPECIALISTS, expected: [3, 1, 2] },
    { label: "b) no runs and no specialists", runs: [], specialists: [], expected: [0, 0, 0] },
    { label: "c) five acpStatus values, lead only", runs: FIVE_RUNS, specialists: [{ id: "team-agent-lead", name: "Agent Lead" }], expected: [5, 3, 0] },
  ])("$label", async ({ runs, specialists, expected }) => {
    install({ runs: () => ok({ sessions: runs }), specialists: () => ok({ specialists }) });
    await renderLoaded(runs.length);
    const teamCount = specialists.filter((s) => s.id.startsWith("team-")).length;
    await waitFor(() => expect(screen.getByTestId("team-roster-summary").textContent).toBe(`团队岗位（${teamCount} 个）`));
    if (runs.length === 0) await waitFor(() => expect(screen.getByTestId("team-launch-panel")).toBeTruthy());
    expect(stats()).toEqual(expected);
  });

  it("sits between the header and the coordinator cards with the existing labels", async () => {
    await renderLoaded();
    await waitFor(() => expect(stats()).toEqual([3, 1, 2]));
    const header = screen.getByTestId("team-page-header");
    const block = screen.getByTestId("team-stats");
    const coordinators = screen.getByTestId("team-coordinators");
    expect(header.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(coordinators) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("team-stat-runs").textContent).toContain("次运行");
    expect(screen.getByTestId("team-stat-active").textContent).toContain("活跃");
    expect(screen.getByTestId("team-stat-members").textContent).toContain("名成员");
  });

  it("search filtering does not change the stats", async () => {
    await renderLoaded();
    await waitFor(() => expect(stats()).toEqual([3, 1, 2]));
    fireEvent.change(screen.getByTestId("team-runs-search"), { target: { value: "Middle" } });
    await waitFor(() => expect(screen.getAllByTestId("team-run-row")).toHaveLength(1));
    expect(stats()).toEqual([3, 1, 2]);
    fireEvent.change(screen.getByTestId("team-runs-search"), { target: { value: "" } });
    await waitFor(() => expect(screen.getAllByTestId("team-run-row")).toHaveLength(3));
    expect(stats()).toEqual([3, 1, 2]);
  });

  it("an optimistic new run raises the run count and leaves members unchanged", async () => {
    await renderLoaded();
    await waitFor(() => expect(stats()).toEqual([3, 1, 2]));
    fireEvent.click(screen.getByTestId("team-launch-toggle"));
    const props = homeInputProps.at(-1)!;
    act(() => {
      (props.onSessionCreated as (sid: string, prompt: string) => void)("new-sid", "Fix login");
    });
    expect(statNumber("team-stat-runs")).toBe(4);
    expect(statNumber("team-stat-members")).toBe(2);
  });

  it("is in the DOM with zeros while the first load is pending", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<TeamPageClient />);
    expect(screen.queryByTestId("team-stats")).not.toBeNull();
    expect(stats()).toEqual([0, 0, 0]);
  });
});

describe("AC3 role badges", () => {
  const ROLE_SPECIALISTS = [
    { id: "team-agent-lead", name: "Agent Lead", role: "Coordinator" },
    { id: "team-researcher", name: "Researcher", role: "研究员" },
    { id: "team-qa", name: "QA" },
    { id: "team-frontend-dev", name: "Frontend", role: "" },
    { id: "team-backend-dev", name: "Backend", role: "   " },
  ];

  it("lead shows the lead label, others their role, blank roles the default label", async () => {
    install({ specialists: () => ok({ specialists: ROLE_SPECIALISTS }) });
    await renderLoaded();
    await waitFor(() => expect(screen.getAllByTestId("team-roster-item")).toHaveLength(5));
    const byName = Object.fromEntries(
      screen.getAllByTestId("team-roster-item").map((item) => [nameOf(item), roleOf(item)]),
    );
    expect(byName).toEqual(Object.fromEntries(ROLE_SPECIALISTS.map((s, i) => [shownName(s.id, s.name), ["负责人", "研究员", "专家", "专家", "专家"][i]])));
  });

  it("dictionaries carry the two labels and the component has no hardcoded literals", async () => {
    const { default: en } = await vi.importActual<typeof import("@/i18n/locales/en")>("@/i18n/locales/en");
    const { default: zh } = await vi.importActual<typeof import("@/i18n/locales/zh")>("@/i18n/locales/zh");
    expect(en.teamRedesign.roster.leadRole).toBe("Lead");
    expect(en.teamRedesign.roster.defaultRole).toBe("Specialist");
    expect(zh.teamRedesign.roster.leadRole).toBe("负责人");
    expect(zh.teamRedesign.roster.defaultRole).toBe("专家");
    const source = readFileSync(resolve(__dirname, "../team-roster.tsx"), "utf8");
    expect(source).not.toMatch(/["'`]Lead["'`]/);
    expect(source).not.toMatch(/["'`]Specialist["'`]/);
  });
});

describe("F4 English copy reaches the same elements", () => {
  it("stats use the en run/active/member labels and badges use Lead / Specialist", async () => {
    i18nState.locale = "en";
    install({ specialists: () => ok({ specialists: [{ id: "team-agent-lead", name: "Agent Lead" }, { id: "team-qa", name: "QA" }] }) });
    await renderLoaded();
    await waitFor(() => expect(screen.getAllByTestId("team-roster-item")).toHaveLength(2));
    expect(stats()).toEqual([3, 1, 1]);
    expect(screen.getByTestId("team-stat-runs").textContent).toBe("3runs");
    expect(screen.getByTestId("team-stat-active").textContent).toBe("1active");
    expect(screen.getByTestId("team-stat-members").textContent).toBe("1members");
    expect(screen.getAllByTestId("team-roster-item").map(roleOf)).toEqual(["Lead", "Specialist"]);
  });
});

describe("F2 opening the page and searching only reads", () => {
  it("issues the same GET requests as before the change", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId("team-runs-search"), { target: { value: "Middle" } });
    await waitFor(() => expect(screen.getAllByTestId("team-run-row")).toHaveLength(1));
    const log = mockFetch.mock.calls.map(([input, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(input)}`);
    if (process.env.TEAM_REQ_LOG_OUT) writeFileSync(process.env.TEAM_REQ_LOG_OUT, `${[...log].sort().join("\n")}\n`);
    expect([...log].sort()).toEqual([`GET ${AGENTS_URL}`, `GET ${SPECIALISTS_URL}`, `GET ${ALL_URL}`, `GET ${RUNS_URL}`].sort());
  });
});

// ---- F3 random cross-check against an independent judge written from the requirement ----

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F3_SEED = 20261023;
const PLANT_BUG = process.env.TEAM_F3_PLANT_BUG === "1";

interface RandSpecialist { id: string; name: string; role?: string }

function randomSpecialists(rand: () => number, count: number): RandSpecialist[] {
  const list: RandSpecialist[] = [];
  const withLead = rand() < 0.5;
  for (let i = 0; i < count; i += 1) {
    const prefix = ["team-", "kanban-", "harness-", "custom-"][Math.floor(rand() * 4)];
    const id = withLead && i === 0 ? "team-agent-lead" : `${prefix}m${i}`;
    const roll = rand();
    const specialist: RandSpecialist = { id, name: `Name-${i}` };
    if (roll < 0.25) specialist.role = "";
    else if (roll < 0.35) specialist.role = "  ";
    else if (roll < 0.7) specialist.role = `Role-${Math.floor(rand() * 1000)}`;
    list.push(specialist);
  }
  return list;
}

/** Judge: only team-* ids; lead → 负责人; non-blank role → role; else 专家. */
function judgeRoster(list: RandSpecialist[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of list) {
    if (!s.id.startsWith("team-")) continue;
    out[shownName(s.id, s.name)] = s.id === "team-agent-lead" ? "负责人" : (s.role && (PLANT_BUG || s.role.trim() !== "") ? s.role : "专家");
  }
  return out;
}

/** Judge: [all runs, connecting|ready runs, max(team specialists − 1, 0)]. */
function judgeStats(runs: Array<{ acpStatus?: string }>, list: RandSpecialist[]): number[] {
  const team = list.filter((s) => s.id.startsWith("team-")).length;
  const members = PLANT_BUG ? team : Math.max(team - 1, 0);
  return [runs.length, runs.filter((r) => r.acpStatus === "connecting" || r.acpStatus === "ready").length, members];
}

describe(`F3 random cross-check (seed ${F3_SEED})`, () => {
  it("100 mounts × 100 random specialists: roster names and role badges match the judge", async () => {
    const rand = mulberry32(F3_SEED);
    let checked = 0;
    for (let round = 0; round < 100; round += 1) {
      const list = randomSpecialists(rand, 100);
      const expected = judgeRoster(list);
      install({ runs: () => ok({ sessions: [] }), specialists: () => ok({ specialists: list }) });
      render(<TeamPageClient />);
      const want = Object.keys(expected).length;
      await waitFor(() => expect(screen.getByTestId("team-roster-summary").textContent).toBe(`团队岗位（${want} 个）`));
      const actual = Object.fromEntries(
        screen.queryAllByTestId("team-roster-item").map((item) => [nameOf(item), roleOf(item)]),
      );
      expect({ round, actual }).toEqual({ round, actual: expected });
      checked += list.length;
      cleanup();
    }
    expect(checked).toBe(10_000);
  }, 120_000);

  it("100 random run lists (0–200 runs): stats match the judge", async () => {
    const rand = mulberry32(F3_SEED + 1);
    const statuses = ["connecting", "ready", "error", "disconnected", undefined];
    const terminals = ["completed", "failed", undefined];
    for (let round = 0; round < 100; round += 1) {
      const n = Math.floor(rand() * 201);
      const runs = Array.from({ length: n }, (_, i) => {
        const acpStatus = statuses[Math.floor(rand() * statuses.length)];
        const terminalState = terminals[Math.floor(rand() * terminals.length)];
        return {
          sessionId: `r${round}-${i}`,
          name: `Team - r${i}`,
          workspaceId: "default",
          cwd: "",
          createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
          ...(acpStatus ? { acpStatus } : {}),
          ...(terminalState ? { terminalState } : {}),
        };
      });
      const list = randomSpecialists(rand, Math.floor(rand() * 12));
      install({ runs: () => ok({ sessions: runs }), specialists: () => ok({ specialists: list }) });
      render(<TeamPageClient />);
      const team = list.filter((s) => s.id.startsWith("team-")).length;
      await waitFor(() => expect(screen.getByTestId("team-roster-summary").textContent).toBe(`团队岗位（${team} 个）`));
      if (n > 0) await waitFor(() => expect(screen.getAllByTestId("team-run-row")).toHaveLength(n));
      else await waitFor(() => expect(screen.getByTestId("team-launch-panel")).toBeTruthy());
      expect({ round, stats: stats() }).toEqual({ round, stats: judgeStats(runs, list) });
      cleanup();
    }
  }, 120_000);
});
