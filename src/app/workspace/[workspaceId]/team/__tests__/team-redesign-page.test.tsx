import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeamPageClient } from "../team-page-client";
import { buildTeamRunName } from "../team-run-name";

const { mockPush, mockFetch, homeInputProps } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockFetch: vi.fn(),
  homeInputProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "default" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/i18n", async () => {
  const { default: zh } = await vi.importActual<typeof import("@/i18n/locales/zh")>("@/i18n/locales/zh");
  return { useTranslation: () => ({ t: zh, locale: "zh", setLocale: () => {} }) };
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
  { id: "agent-crafter", name: "crafter-1", role: "CRAFTER", status: "ACTIVE", createdAt: "2026-10-22T00:00:00.000Z" },
];

const SPECIALISTS = [
  { id: "team-qa", name: "QA Specialist", description: "Tests things" },
  { id: "team-agent-lead", name: "Agent Lead", description: "Leads" },
  { id: "team-researcher", name: "Researcher", description: "Researches" },
  { id: "kanban-dev", name: "Kanban Dev" },
];

interface Routes { runs?: () => Response; all?: () => Response; agents?: () => Response; specialists?: () => Response }

function install(routes: Routes = {}) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== "GET") return ok({});
    if (url === RUNS_URL) return routes.runs ? routes.runs() : ok({ sessions: RUNS });
    if (url === ALL_URL) return routes.all ? routes.all() : ok({ sessions: [] });
    if (url === AGENTS_URL) return routes.agents ? routes.agents() : ok({ agents: AGENTS });
    if (url === SPECIALISTS_URL) return routes.specialists ? routes.specialists() : ok({ specialists: SPECIALISTS });
    return ok({});
  });
}

const callsTo = (url: string) => mockFetch.mock.calls.filter(([input]) => String(input) === url).length;
const rowIds = () => screen.getAllByTestId("team-run-row").map((row) => within(row).getByTitle(/^run-/).getAttribute("title"));

async function renderLoaded() {
  render(<TeamPageClient />);
  await waitFor(() => expect(screen.getAllByTestId("team-run-row")).toHaveLength(3));
  await waitFor(() => expect(screen.getAllByTestId("team-coordinator-card")).toHaveLength(2));
}

beforeEach(() => {
  vi.clearAllMocks();
  homeInputProps.length = 0;
  install();
});

describe("AC1 team page structure", () => {
  it("renders header, search, coordinators, roster, run section and table in order", async () => {
    await renderLoaded();
    const order = [
      screen.getByTestId("team-page-header"),
      screen.getByTestId("team-runs-search"),
      screen.getByTestId("team-coordinators"),
      screen.getByTestId("team-roster"),
      screen.getByText("团队运行记录"),
      screen.getByTestId("team-run-records"),
    ];
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByText("施工记录")).toBeTruthy();
    expect(screen.getByTestId("team-configure-specialists").getAttribute("href")).toBe("/settings/specialists");
    expect(screen.getByTestId("team-launch-toggle").textContent).toContain("发起团队运行");
    const headers = within(screen.getByTestId("team-run-records")).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(headers).toEqual(["会话", "代码仓与分支", "岗位", "成员会话", "状态", "开始时间", "操作"]);
  });
});

describe("AC2 coordinator cards", () => {
  it("shows only ROUTA agents newest first with fields and links the one that has a session", async () => {
    await renderLoaded();
    const cards = screen.getAllByTestId("team-coordinator-card");
    expect(within(cards[0]).getByText("routa-coordinator-new")).toBeTruthy();
    expect(within(cards[1]).getByText("routa-coordinator-old")).toBeTruthy();
    expect(within(cards[0]).getByText("协调者")).toBeTruthy();
    expect(within(cards[0]).getByTestId("team-coordinator-status").textContent).toBe("运行中");
    expect(within(cards[1]).getByTestId("team-coordinator-status").textContent).toBe("等待中");
    expect(within(cards[0]).getByText("Lead Alpha")).toBeTruthy();
    expect(within(cards[0]).getByTestId("team-coordinator-session-id").textContent).toContain("run-aaa-");
    expect(within(cards[0]).getByTestId("team-coordinator-session-id").getAttribute("title")).toBe("run-aaa-1");

    const linkedButton = within(cards[0]).getByTestId("team-coordinator-open") as HTMLButtonElement;
    fireEvent.click(linkedButton);
    expect(mockPush).toHaveBeenCalledWith("/workspace/default/team/run-aaa-1");

    const unlinked = within(cards[1]).getByTestId("team-coordinator-open") as HTMLButtonElement;
    expect(unlinked.disabled).toBe(true);
    expect(within(cards[1]).getByText("未关联会话")).toBeTruthy();
  });

  it("links through the full session list when the run is not a team run", async () => {
    install({
      runs: () => ok({ sessions: [] }),
      all: () => ok({ sessions: [{ sessionId: "plain-ses-9", workspaceId: "default", cwd: "", createdAt: "2026-10-22T00:00:00.000Z", routaAgentId: "agent-old" }] }),
    });
    render(<TeamPageClient />);
    await waitFor(() => expect(screen.getAllByTestId("team-coordinator-card")).toHaveLength(2));
    const card = screen.getAllByTestId("team-coordinator-card")[1];
    await waitFor(() => expect(within(card).getByTestId("team-coordinator-session-id").getAttribute("title")).toBe("plain-ses-9"));
    fireEvent.click(within(card).getByTestId("team-coordinator-open"));
    expect(mockPush).toHaveBeenCalledWith("/workspace/default/team/plain-ses-9");
  });
});

describe("AC3 run record columns", () => {
  it("renders each column value in Chinese and marks missing data", async () => {
    await renderLoaded();
    const rows = screen.getAllByTestId("team-run-row");
    const byId = (id: string) => rows.find((row) => within(row).queryByTitle(id))!;

    const middle = byId("run-bbb-2");
    expect(middle.querySelector('[data-col="repo"]')?.textContent).toContain("routa");
    expect(middle.querySelector('[data-col="repo"]')?.textContent).toContain("main");
    expect(middle.querySelector('[data-col="role"]')?.textContent).toContain("ROUTA");
    expect(middle.querySelector('[data-col="role"]')?.textContent).toContain("协调者");
    expect(middle.querySelector('[data-col="members"]')?.textContent).toBe("2");
    expect(middle.querySelector('[data-col="status"]')?.textContent).toBe("出错");

    const newest = byId("run-aaa-1");
    expect(newest.querySelector('[data-col="repo"]')?.textContent).toBe("未记录");
    expect(newest.querySelector('[data-col="status"]')?.textContent).toBe("已完成");
    expect(within(newest).getByTitle("run-aaa-1").textContent).toBe("run-aaa-");

    const oldest = byId("run-ccc-3");
    expect(oldest.querySelector('[data-col="members"]')?.textContent).toBe("未记录");
    expect(oldest.querySelector('[data-col="status"]')?.textContent).toBe("未记录");
    expect(oldest.querySelector('[data-col="role"]')?.textContent).toBe("未记录");

    const table = screen.getByTestId("team-run-records").textContent ?? "";
    expect(table).not.toMatch(/\berror\b/);
    expect(table).not.toMatch(/\bready\b/);
  });
});

describe("AC4 run record sorting", () => {
  it("sorts newest first by default and toggles with aria-sort", async () => {
    await renderLoaded();
    expect(rowIds()).toEqual(["run-aaa-1", "run-bbb-2", "run-ccc-3"]);
    const th = screen.getByTestId("team-run-sort").closest("th")!;
    expect(th.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByTestId("team-run-sort"));
    expect(rowIds()).toEqual(["run-ccc-3", "run-bbb-2", "run-aaa-1"]);
    expect(th.getAttribute("aria-sort")).toBe("ascending");
  });
});

describe("AC5 row navigation and search", () => {
  it("open record goes to the team session page and the name links there", async () => {
    await renderLoaded();
    const row = screen.getAllByTestId("team-run-row").find((r) => within(r).queryByTitle("run-aaa-1"))!;
    fireEvent.click(within(row).getByTestId("team-run-open"));
    expect(mockPush).toHaveBeenCalledWith("/workspace/default/team/run-aaa-1");
    expect(mockPush.mock.calls.flat().join(" ")).not.toContain("/sessions/");
    expect(within(row).getByTestId("team-run-name-link").getAttribute("href")).toBe("/workspace/default/team/run-aaa-1");
  });

  it("search filters only table rows; coordinator cards stay", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId("team-runs-search"), { target: { value: "run-c" } });
    expect(screen.getAllByTestId("team-run-row")).toHaveLength(1);
    expect(screen.getAllByTestId("team-coordinator-card")).toHaveLength(2);
    fireEvent.change(screen.getByTestId("team-runs-search"), { target: { value: "nothing-matches" } });
    expect(screen.queryAllByTestId("team-run-row")).toHaveLength(0);
    expect(screen.getByText("没有匹配的会话")).toBeTruthy();
    expect(screen.getAllByTestId("team-coordinator-card")).toHaveLength(2);
  });
});

describe("AC6 launch team run", () => {
  it("keeps the exact HomeInput props and builds team-session URLs", async () => {
    await renderLoaded();
    // Team page v2: the launch box is always rendered; the header button only focuses it.
    const panel = screen.getByTestId("team-launch-panel");
    const toggle = screen.getByTestId("team-launch-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("home-input-textarea")));

    const props = homeInputProps.at(-1)!;
    expect(props.workspaceId).toBe("default");
    expect(props.variant).toBe("default");
    expect(props.footerMetaMode).toBe("repo-only");
    expect(props.initialLaunchModeId).toBe("team");
    const mode = (props.launchModes as Array<Record<string, unknown>>)[0];
    expect(mode.id).toBe("team");
    expect(mode.defaultAgentRole).toBe("ROUTA");
    expect(mode.allowRoleSwitch).toBe(false);
    expect(mode.allowCustomSpecialist).toBe(false);
    expect(mode.lockedSpecialistId).toBe("team-agent-lead");
    expect(mode.requireRepoSelection).toBe(true);
    expect(mode.dispatchMode).toBe("pending-prompt");
    expect((mode.buildSessionUrl as (w: string, s: string) => string)("ws", "sid")).toBe("/workspace/ws/team/sid");
    expect((mode.buildSessionUrl as (w: string | null, s: string) => string)(null, "sid")).toBe("/workspace/default/team/sid");
  });

  it("onSessionCreated inserts the run on top, PATCHes the name and reloads", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("team-launch-toggle"));
    const before = callsTo(RUNS_URL);
    const props = homeInputProps.at(-1)!;
    act(() => {
      (props.onSessionCreated as (sid: string, prompt: string) => void)("new-sid", "Fix login");
    });
    expect(screen.getAllByTestId("team-run-row")[0].textContent).toContain("Team - Fix login");
    const patch = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(patch).toHaveLength(1);
    expect(String(patch[0][0])).toBe("/api/sessions/new-sid");
    expect(JSON.parse(String((patch[0][1] as RequestInit).body)).name).toBe("Team - Fix login");
    await waitFor(() => expect(callsTo(RUNS_URL)).toBe(before + 1));
  });

  it("opens the panel by default when there are no team runs", async () => {
    install({ runs: () => ok({ sessions: [] }) });
    render(<TeamPageClient />);
    await waitFor(() => expect(screen.getByTestId("team-launch-panel")).toBeTruthy());
    expect(screen.getByTestId("team-launch-toggle").getAttribute("aria-expanded")).toBeNull();
  });

  it("buildTeamRunName keeps its data-marker format", () => {
    expect(buildTeamRunName("Fix login")).toBe("Team - Fix login");
    const long = "x".repeat(80);
    expect(buildTeamRunName(long)).toBe(`Team - ${"x".repeat(53)}...`);
    expect(buildTeamRunName("   ")).toBe("Team run");
  });
});

describe("AC7 team roster", () => {
  it("counts team specialists and lists them in display order", async () => {
    await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("team-roster-summary").textContent).toBe("团队岗位（3 个）"));
    const roster = screen.getByTestId("team-roster") as HTMLElement;
    expect(roster.closest("details")).toBeNull();
    expect(roster.querySelector("details")).toBeNull();
    expect(within(roster).getAllByTestId("team-roster-item")).toHaveLength(3);
    const names = within(roster).getAllByTestId("team-roster-item").map((item) => item.firstChild?.textContent);
    expect(names).toEqual(["Agent Lead", "Researcher", "QA Specialist"]);
  });

  it("a failed reread keeps the list and offers reload", async () => {
    let count = 0;
    install({ specialists: () => (count++ === 0 ? ok({ specialists: SPECIALISTS }) : fail()) });
    render(<TeamPageClient />);
    await waitFor(() => expect(screen.getAllByTestId("team-roster-item")).toHaveLength(3));
    fireEvent.click(screen.getByText("刷新"));
    const errorBox = await screen.findByTestId("team-roster-error");
    expect(errorBox.textContent).toContain("岗位读取失败");
    expect(screen.getAllByTestId("team-roster-item")).toHaveLength(3);
    const before = callsTo(SPECIALISTS_URL);
    fireEvent.click(within(errorBox).getByText("重新读取"));
    await waitFor(() => expect(callsTo(SPECIALISTS_URL)).toBe(before + 1));
  });
});

describe("AC8 independent empty, loading and error states", () => {
  it("no ROUTA agent shows the coordinator empty state", async () => {
    install({ agents: () => ok({ agents: [AGENTS[2]] }) });
    render(<TeamPageClient />);
    await waitFor(() => expect(screen.getByText("还没有协调者")).toBeTruthy());
    expect(screen.getByText("发起一次团队运行后，它的协调者会出现在这里")).toBeTruthy();
  });

  it("agents 503 shows ErrorState for coordinators while the table still renders", async () => {
    install({ agents: () => fail() });
    render(<TeamPageClient />);
    const section = await screen.findByTestId("team-coordinators");
    await waitFor(() => expect(within(section).getByTestId("ui-error-state")).toBeTruthy());
    await waitFor(() => expect(screen.getAllByTestId("team-run-row")).toHaveLength(3));
    const before = callsTo(AGENTS_URL);
    fireEvent.click(within(within(section).getByTestId("ui-error-state")).getByRole("button"));
    await waitFor(() => expect(callsTo(AGENTS_URL)).toBe(before + 1));
  });

  it("a failed reread keeps the coordinator cards and says the data is stale", async () => {
    let count = 0;
    install({ agents: () => (count++ === 0 ? ok({ agents: AGENTS }) : fail()) });
    await renderLoaded();
    fireEvent.click(screen.getByText("刷新"));
    const section = screen.getByTestId("team-coordinators");
    await waitFor(() => expect(within(section).getByTestId("ui-error-state")).toBeTruthy());
    expect(within(section).getByText("显示的是上次读取的结果")).toBeTruthy();
    expect(screen.getAllByTestId("team-coordinator-card")).toHaveLength(2);
  });

  it("first load shows skeletons, not empty states", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<TeamPageClient />);
    expect(screen.getAllByTestId("ui-skeleton").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("还没有协调者")).toBeNull();
  });
});

describe("C7 opening the page only reads", () => {
  it("mount issues GET requests to known endpoints only", async () => {
    await renderLoaded();
    await waitFor(() => expect(callsTo(SPECIALISTS_URL)).toBeGreaterThan(0));
    const calls = mockFetch.mock.calls.map(([input, init]) => ({ url: String(input), method: (init as RequestInit | undefined)?.method ?? "GET" }));
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.every((call) => [RUNS_URL, ALL_URL, AGENTS_URL, SPECIALISTS_URL].includes(call.url))).toBe(true);
    expect(calls.some((call) => call.url.startsWith("/api/kanban"))).toBe(false);
  });
});

describe("AC16 keyboard reachability", () => {
  it("interactive elements accept focus and the disabled coordinator button is out of the tab order", async () => {
    await renderLoaded();
    const enabledOpen = screen.getAllByTestId("team-coordinator-open").filter((b) => !(b as HTMLButtonElement).disabled);
    const targets: HTMLElement[] = [
      screen.getByTestId("team-configure-specialists"),
      screen.getByTestId("team-launch-toggle"),
      screen.getByTestId("team-runs-search"),
      ...enabledOpen,
      screen.getByTestId("team-roster-manage-link"),
      screen.getByTestId("team-run-sort"),
      ...screen.getAllByTestId("team-run-name-link"),
      ...screen.getAllByTestId("team-run-open"),
    ];
    for (const element of targets) {
      element.focus();
      expect(document.activeElement).toBe(element);
      expect(element.getAttribute("tabindex")).not.toBe("-1");
    }
    const disabled = screen.getAllByTestId("team-coordinator-open").find((b) => (b as HTMLButtonElement).disabled) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    disabled.focus();
    expect(document.activeElement).not.toBe(disabled);
  });

  it("Enter on the launch button opens the panel", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const toggle = screen.getByTestId("team-launch-toggle");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("team-launch-panel")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId("home-input-textarea"));
  });
});
