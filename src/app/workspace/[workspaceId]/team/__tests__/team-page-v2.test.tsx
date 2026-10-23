import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeamPageClient } from "../team-page-client";
import {
  countActiveSessionsBySpecialist,
  groupSpecialistsByRole,
  recentRunsForSpecialist,
  runFilterBucket,
} from "../team-page-model";
import { readTeamSpecialistNames, readTeamSpecialists, SPECIALISTS_ROOT } from "./team-yaml-names";

/**
 * Team page v2 (redesign card 14): always-visible launch box, team formation
 * (map + list), member drawer with "# mention", run records with status
 * filters. Expected values are hand-computed from the card, never by calling
 * the code under test.
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

interface InsertRequest { text: string; nonce: number; mode: "replace" | "append" }

/** Mirrors TiptapInput's insertTextRequest rule (replace / append, once per nonce) over every render so far. */
function composerText(): string {
  let text = "";
  const seen = new Set<number>();
  for (const props of homeInputProps) {
    const request = props.insertTextRequest as InsertRequest | null | undefined;
    if (!request || seen.has(request.nonce)) continue;
    seen.add(request.nonce);
    if (request.mode === "replace") text = request.text;
    else text += (text && !/\s$/.test(text) ? " " : "") + request.text;
  }
  return text;
}

vi.mock("@/client/components/home-input", () => ({
  HomeInput: (props: Record<string, unknown>) => {
    homeInputProps.push(props);
    return (
      <div data-testid="home-input">
        <div data-testid="home-input-editor" contentEditable suppressContentEditableWarning tabIndex={0}>{composerText()}</div>
      </div>
    );
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
const fail = (status = 500) => ({ ok: false, status, json: async () => ({}) }) as Response;

const RUNS_URL = "/api/sessions?workspaceId=default&surface=team";
const ALL_URL = "/api/sessions?workspaceId=default";
const AGENTS_URL = "/api/agents?workspaceId=default";
const SPECIALISTS_URL = "/api/specialists";

const ZH = readTeamSpecialistNames(join(SPECIALISTS_ROOT, "locales/zh-CN/team"));
const EN = readTeamSpecialistNames(join(SPECIALISTS_ROOT, "team"));
const TEAM9 = readTeamSpecialists();
const UNKNOWN = { id: "team-tech-writer", name: "Tech Writer", role: "WRITER", description: "Writes the docs" };
const SPECIALISTS = [...TEAM9, UNKNOWN, { id: "kanban-dev", name: "Kanban Dev", role: "CRAFTER" }];

const day = (d: number, h = 0) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
interface TestSession {
  sessionId: string; name: string; workspaceId: string; cwd: string; createdAt: string;
  terminalState?: string; acpStatus?: string; specialistId?: string; parentSessionId?: string;
  [key: string]: unknown;
}
const run = (sessionId: string, name: string, createdAt: string, extra: Json = {}): TestSession => ({ sessionId, name, workspaceId: "default", cwd: "", createdAt, ...extra });

/** C5: eight runs. Hand count: active {r4,r5}=2, ended {r1,r7}=2, error {r2,r3,r6}=3; header active (acp connecting/ready) {r4,r5,r7}=3. */
const RUNS8 = [
  run("r1-completed", "Team - Alpha completed", day(1), { terminalState: "completed", cwd: "/repo/routa", branch: "main", role: "ROUTA", specialistId: "team-agent-lead", routaAgentId: "agent-linked" }),
  run("r2-failed", "Team - Beta failed", day(2), { terminalState: "failed" }),
  run("r3-timedout", "Team - Gamma timed out", day(3), { terminalState: "timed_out" }),
  run("r4-ready", "Team - Delta ready", day(4), { acpStatus: "ready", descendants: 4 }),
  run("r5-connecting", "Team - Epsilon connecting", day(5), { acpStatus: "connecting" }),
  run("r6-error", "Team - Zeta error", day(6), { acpStatus: "error" }),
  run("r7-done-ready", "Team - Eta done but ready", day(7), { terminalState: "completed", acpStatus: "ready" }),
  run("r8-none", "Team - Theta unknown", day(8)),
];
const IDS8 = RUNS8.map((r) => r.sessionId);

/** Frontend dev: 3 sessions (connecting, ready, error) → 2 live; QA: 1 session, no status → idle. R1 children: frontend ×2, qa. */
const ALL_SESSIONS = [
  run("c-fe-1", "fe 1", day(1, 1), { specialistId: "team-frontend-dev", parentSessionId: "r1-completed", acpStatus: "connecting" }),
  run("c-fe-2", "fe 2", day(1, 2), { specialistId: "team-frontend-dev", parentSessionId: "r1-completed", acpStatus: "ready" }),
  run("c-fe-3", "fe 3", day(6, 1), { specialistId: "team-frontend-dev", parentSessionId: "r6-error", acpStatus: "error" }),
  run("c-qa-1", "qa 1", day(1, 3), { specialistId: "team-qa", parentSessionId: "r1-completed" }),
];

const AGENTS = [
  { id: "agent-linked", name: "routa-coordinator-linked", role: "ROUTA", status: "ACTIVE", createdAt: day(1), metadata: { displayLabel: "Lead Alpha" } },
  { id: "agent-unlinked", name: "routa-coordinator-free", role: "ROUTA", status: "PENDING", createdAt: day(2) },
];

interface Routes { runs?: () => Response | Promise<Response>; all?: () => Response; agents?: () => Response | Promise<Response>; specialists?: () => Response }

function install(routes: Routes = {}) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== "GET") return ok({});
    if (url === RUNS_URL) return routes.runs ? routes.runs() : ok({ sessions: RUNS8 });
    if (url === ALL_URL) return routes.all ? routes.all() : ok({ sessions: ALL_SESSIONS });
    if (url === AGENTS_URL) return routes.agents ? routes.agents() : ok({ agents: AGENTS });
    if (url === SPECIALISTS_URL) return routes.specialists ? routes.specialists() : ok({ specialists: SPECIALISTS });
    return ok({});
  });
}

const callsTo = (url: string) => mockFetch.mock.calls.filter(([input]) => String(input) === url).length;
const editor = () => screen.getByTestId("home-input-editor");
const rowIds = () => screen.queryAllByTestId("team-run-row").map((row) => within(row).getByTitle(/^r\d-/).getAttribute("title"));
const formation = () => screen.getByTestId("team-formation");
const items = () => within(formation()).getAllByTestId("team-roster-item");
const itemOf = (id: string) => items().find((item) => item.getAttribute("data-specialist-id") === id)!;
const nameOf = (item: HTMLElement) => within(item).getByTestId("team-roster-name").textContent;
const zh = async () => (await vi.importActual<typeof import("@/i18n/locales/zh")>("@/i18n/locales/zh")).default;
const en = async () => (await vi.importActual<typeof import("@/i18n/locales/en")>("@/i18n/locales/en")).default;

/** Static visibility: no hidden attribute, closed details or unconditional Tailwind hiding class on the element or an ancestor. */
function isVisible(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    if (node.tagName === "DETAILS" && !(node as HTMLDetailsElement).open) return false;
    const classes = (node.getAttribute("class") ?? "").split(/\s+/);
    if (classes.some((c) => c === "hidden" || c === "invisible" || c === "opacity-0" || c === "sr-only")) return false;
  }
  return true;
}

function press(key: string, target: EventTarget = document.activeElement ?? document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

async function renderLoaded(rows = 8) {
  const view = render(<TeamPageClient />);
  if (rows > 0) await waitFor(() => expect(screen.getAllByTestId("team-run-row")).toHaveLength(rows));
  await waitFor(() => expect(callsTo(SPECIALISTS_URL)).toBeGreaterThan(0));
  await waitFor(() => expect(screen.queryAllByTestId("team-roster-item").length).toBeGreaterThan(0));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  homeInputProps.length = 0;
  i18nState.locale = "zh";
  install();
  (document.activeElement as HTMLElement | null)?.blur?.();
});

// ---------------------------------------------------------------- C1 ----

describe("C1 launch box is always there, blocks are in order, N key", () => {
  it.each([
    { label: "0 runs", routes: { runs: () => ok({ sessions: [] }) } as Routes },
    { label: "8 mixed runs", routes: {} as Routes },
    { label: "all four list endpoints 500", routes: { runs: () => fail(), all: () => fail(), agents: () => fail(), specialists: () => fail() } as Routes },
  ])("$label: launch panel on first render without clicks, then header → launch → formation → filter", async ({ routes }) => {
    install(routes);
    render(<TeamPageClient />);
    expect(screen.queryByTestId("team-launch-panel")).not.toBeNull();
    await waitFor(() => expect(callsTo(SPECIALISTS_URL)).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId("ui-skeleton")).toBeNull());
    expect(screen.queryByTestId("team-launch-panel")).not.toBeNull();
    const order = ["team-page-header", "team-launch-panel", "team-formation", "team-runs-filter"].map((id) => screen.getByTestId(id));
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("N on body focuses the launch editor; in the editor, search, with modifiers, while composing or with the drawer open it does nothing", async () => {
    await renderLoaded();
    expect(document.activeElement).toBe(document.body);
    const fromBody = press("n", document.body);
    expect(fromBody.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(editor());

    editor().focus();
    const inEditor = press("n");
    expect(inEditor.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(editor());

    const search = screen.getByTestId("team-runs-search");
    search.focus();
    const inSearch = press("N");
    expect(inSearch.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(search);

    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      search.blur();
      expect(document.activeElement).toBe(document.body);
      const event = press("n", document.body, init);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(document.body);
    }

    fireEvent.click(within(itemOf("team-qa")).getByTestId("team-member-open"));
    const drawer = await screen.findByTestId("team-member-drawer");
    const focusedInDrawer = document.activeElement;
    expect(drawer.contains(focusedInDrawer)).toBe(true);
    const withDrawer = press("n");
    expect(withDrawer.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(focusedInDrawer);
  });

  it("/ on body focuses the run search; after unmount neither N nor / is handled", async () => {
    const view = await renderLoaded();
    const slash = press("/", document.body);
    expect(slash.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId("team-runs-search"));
    view.unmount();
    expect(press("n", document.body).defaultPrevented).toBe(false);
    expect(press("/", document.body).defaultPrevented).toBe(false);
  });

  it("the header launch button focuses the editor, and the removed collapse state is gone from the team sources", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("team-launch-toggle"));
    expect(document.activeElement).toBe(editor());
    expect(screen.getByTestId("team-launch-toggle").getAttribute("aria-expanded")).toBeNull();
    const dir = resolve(__dirname, "..");
    const removed = ["launchOpen", "Choice"].join("");
    for (const file of readdirSync(dir).filter((name) => /\.(ts|tsx)$/.test(name))) {
      expect(readFileSync(join(dir, file), "utf8")).not.toContain(removed);
    }
  });
});

// ---------------------------------------------------------------- C2 / AC2 ----

describe("C2 templates and HomeInput config", () => {
  it("each template chip fills the editor with its text and focuses it; HomeInput props are the legacy ones", async () => {
    await renderLoaded();
    const copy = (await zh()).teamRedesign.launch;
    const templates = [copy.template1, copy.template2, copy.template3, copy.template4];
    expect(templates.every((text) => text.length > 0)).toBe(true);
    for (let i = 0; i < 4; i += 1) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      fireEvent.click(screen.getByTestId(`team-launch-template-${i + 1}`));
      expect(editor().textContent).toBe(templates[i]);
      expect(document.activeElement).toBe(editor());
    }
    const props = homeInputProps.at(-1)!;
    expect(props.workspaceId).toBe("default");
    expect(props.variant).toBe("default");
    expect(props.footerMetaMode).toBe("repo-only");
    expect(props.initialLaunchModeId).toBe("team");
    const mode = (props.launchModes as Array<Record<string, unknown>>)[0];
    expect(mode).toMatchObject({
      id: "team",
      defaultAgentRole: "ROUTA",
      allowRoleSwitch: false,
      allowCustomSpecialist: false,
      lockedSpecialistId: "team-agent-lead",
      requireRepoSelection: true,
      dispatchMode: "pending-prompt",
    });
    expect((mode.buildSessionUrl as (w: string, s: string) => string)("ws", "sid")).toBe("/workspace/ws/team/sid");
    expect((props.insertTextRequest as InsertRequest).mode).toBe("replace");
  });
});

// ---------------------------------------------------------------- C3 ----

describe("C3 team formation and list view", () => {
  const groupIds = (key: string) => within(screen.getByTestId(`team-formation-group-${key}`))
    .getAllByTestId("team-roster-item").map((item) => item.getAttribute("data-specialist-id"));

  it("all 10 team specialists are visible without clicks, one role badge each, grouped by role", async () => {
    await renderLoaded();
    const all = items();
    expect(all).toHaveLength(10);
    for (const item of all) {
      expect(isVisible(item)).toBe(true);
      expect(within(item).queryAllByTestId("team-roster-role")).toHaveLength(1);
    }
    const roleOf = (id: string) => within(itemOf(id)).getByTestId("team-roster-role").textContent;
    expect(roleOf("team-agent-lead")).toBe("负责人");
    for (const specialist of [...TEAM9.filter((s) => s.id !== "team-agent-lead"), UNKNOWN]) {
      expect(roleOf(specialist.id)).toBe(specialist.role);
    }
    expect(within(screen.getByTestId("team-lead-card")).getAllByTestId("team-roster-item").map((i) => i.getAttribute("data-specialist-id"))).toEqual(["team-agent-lead"]);
    expect(groupIds("ROUTA")).toEqual(["team-researcher"]);
    expect(groupIds("CRAFTER")).toEqual(["team-frontend-dev", "team-backend-dev", "team-ux-designer"]);
    expect(groupIds("GATE")).toEqual(["team-qa", "team-code-reviewer"]);
    expect(groupIds("DEVELOPER")).toEqual(["team-operations", "team-general-engineer"]);
    expect(groupIds("OTHER")).toEqual(["team-tech-writer"]);
    expect(screen.queryByText("Kanban Dev")).toBeNull();
  });

  it("without an unknown role there is no Other column", async () => {
    install({ specialists: () => ok({ specialists: TEAM9 }) });
    await renderLoaded();
    expect(items()).toHaveLength(9);
    expect(screen.queryByTestId("team-formation-group-OTHER")).toBeNull();
  });

  it("member status counts connecting/ready sessions of that specialist", async () => {
    await renderLoaded();
    await waitFor(() => expect(within(itemOf("team-frontend-dev")).getByTestId("team-member-status").textContent).toBe("工作中 · 2 个运行"));
    expect(within(itemOf("team-qa")).getByTestId("team-member-status").textContent).toBe("空闲");
    const counts = countActiveSessionsBySpecialist(ALL_SESSIONS);
    expect([...counts.entries()]).toEqual([["team-frontend-dev", 2]]);
  });

  it("zh shows zh-CN yaml names, en shows the base yaml names; the API name stays visible", async () => {
    await renderLoaded();
    for (const s of TEAM9) expect(nameOf(itemOf(s.id))).toBe(ZH[s.id]);
    expect(itemOf("team-frontend-dev").textContent).toContain(EN["team-frontend-dev"]);
    expect(nameOf(itemOf("team-tech-writer"))).toBe("Tech Writer");
  });

  it("en dictionary shows the English names", async () => {
    i18nState.locale = "en";
    await renderLoaded();
    for (const s of TEAM9) expect(nameOf(itemOf(s.id))).toBe(EN[s.id]);
    expect(within(itemOf("team-agent-lead")).getByTestId("team-roster-role").textContent).toBe("Lead");
  });

  it("list view keeps every item with one role badge and swaps aria-pressed", async () => {
    await renderLoaded();
    const mapButton = screen.getByTestId("team-formation-view-map");
    const listButton = screen.getByTestId("team-formation-view-list");
    expect([mapButton.getAttribute("aria-pressed"), listButton.getAttribute("aria-pressed")]).toEqual(["true", "false"]);
    fireEvent.click(listButton);
    expect([mapButton.getAttribute("aria-pressed"), listButton.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
    expect(screen.getByTestId("team-roster-list")).toBeTruthy();
    expect(items()).toHaveLength(10);
    for (const item of items()) {
      expect(isVisible(item)).toBe(true);
      expect(within(item).queryAllByTestId("team-roster-role")).toHaveLength(1);
    }
    expect(nameOf(itemOf("team-ux-designer"))).toBe(ZH["team-ux-designer"]);
  });

  it("the lead card shows every coordinator row; linked opens the run, unlinked is disabled", async () => {
    await renderLoaded();
    const lead = screen.getByTestId("team-lead-card");
    const rows = within(lead).getAllByTestId("team-coordinator-card");
    expect(rows).toHaveLength(2);
    const [unlinked, linked] = rows;
    expect(within(linked).getByText("routa-coordinator-linked")).toBeTruthy();
    expect(within(linked).getByText("ROUTA")).toBeTruthy();
    expect(within(linked).getByTestId("team-coordinator-status").textContent).toBe("运行中");
    expect(within(linked).getByText("Lead Alpha")).toBeTruthy();
    const time = linked.querySelector("time")!;
    expect(time.getAttribute("title")).toBe(day(1));
    expect(time.textContent).not.toBe("");
    fireEvent.click(within(linked).getByTestId("team-coordinator-open"));
    expect(mockPush).toHaveBeenCalledWith("/workspace/default/team/r1-completed");
    expect(within(unlinked).getByTestId("team-coordinator-status").textContent).toBe("等待中");
    expect((within(unlinked).getByTestId("team-coordinator-open") as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    { label: "loading", agents: () => new Promise<Response>(() => {}), text: "正在读取协调者" },
    { label: "500", agents: () => fail(), text: "协调者读取失败" },
    { label: "empty", agents: () => ok({ agents: [] }), text: "还没有协调者" },
  ])("agents $label keeps the old copy while the formation and runs still render", async ({ agents, text }) => {
    install({ agents });
    await renderLoaded();
    await waitFor(() => expect(within(screen.getByTestId("team-coordinators")).getAllByText(text).length).toBeGreaterThan(0));
    expect(items()).toHaveLength(10);
    expect(rowIds()).toHaveLength(8);
  });

  it("groupSpecialistsByRole: lead apart, unknown role in OTHER, empty OTHER omitted", () => {
    const grouped = groupSpecialistsByRole([...TEAM9, UNKNOWN]);
    expect(grouped.lead?.id).toBe("team-agent-lead");
    expect(grouped.groups.map((g) => [g.key, g.members.length])).toEqual([["ROUTA", 1], ["CRAFTER", 3], ["GATE", 2], ["DEVELOPER", 2], ["OTHER", 1]]);
    expect(groupSpecialistsByRole(TEAM9).groups.map((g) => g.key)).toEqual(["ROUTA", "CRAFTER", "GATE", "DEVELOPER"]);
  });
});

// ---------------------------------------------------------------- C4 ----

/** Backend dev, 7 sessions. Newest first with target = parent ?? self, deduped, top 5: r1, be-3, r4, be-5, r6. */
const BACKEND_SESSIONS = [
  run("be-1", "be 1", day(10), { specialistId: "team-backend-dev", parentSessionId: "r1-completed" }),
  run("be-2", "be 2", day(9), { specialistId: "team-backend-dev", parentSessionId: "r1-completed" }),
  run("be-3", "be 3", day(8, 5), { specialistId: "team-backend-dev" }),
  run("be-4", "be 4", day(7, 5), { specialistId: "team-backend-dev", parentSessionId: "r4-ready" }),
  run("be-5", "be 5", day(6, 5), { specialistId: "team-backend-dev" }),
  run("be-6", "be 6", day(5, 5), { specialistId: "team-backend-dev", parentSessionId: "r6-error" }),
  run("be-7", "be 7", day(4, 5), { specialistId: "team-backend-dev" }),
];
const BACKEND_TARGETS = ["r1-completed", "be-3", "r4-ready", "be-5", "r6-error"];

describe("C4 member drawer and # mention", () => {
  async function openBackend() {
    install({ all: () => ok({ sessions: [...ALL_SESSIONS, ...BACKEND_SESSIONS] }) });
    await renderLoaded();
    const trigger = within(itemOf("team-backend-dev")).getByTestId("team-member-open");
    fireEvent.click(trigger);
    const drawer = await screen.findByTestId("team-member-drawer");
    return { trigger, drawer };
  }

  it("shows name, role, description, id, tier, status and the 5 recent runs", async () => {
    const { drawer } = await openBackend();
    const backend = TEAM9.find((s) => s.id === "team-backend-dev")!;
    expect(drawer.getAttribute("role")).toBe("dialog");
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(within(drawer).getByTestId("team-member-drawer-name").textContent).toBe(ZH["team-backend-dev"]);
    expect(within(drawer).getByTestId("team-member-drawer-role").textContent).toContain("CRAFTER");
    expect(within(drawer).getByTestId("team-member-drawer-description").textContent).toBe(backend.description);
    expect(within(drawer).getByTestId("team-member-drawer-id").textContent).toBe("team-backend-dev");
    expect(within(drawer).getByTestId("team-member-drawer-tier").textContent).toBe(backend.defaultModelTier);
    expect(within(drawer).getByTestId("team-member-drawer-status").textContent).toBe("空闲");
    const runs = within(drawer).getAllByTestId("team-member-drawer-run");
    expect(runs.map((r) => r.getAttribute("data-target-id"))).toEqual(BACKEND_TARGETS);
    expect(runs[0].textContent).toContain("Team - Alpha completed");
    fireEvent.click(runs[1]);
    expect(mockPush).toHaveBeenCalledWith("/workspace/default/team/be-3");
    expect(within(drawer).getByTestId("team-member-drawer-edit").getAttribute("href")).toBe("/settings/specialists");
    expect(recentRunsForSpecialist(BACKEND_SESSIONS, "team-backend-dev").map((r) => r.targetId)).toEqual(BACKEND_TARGETS);
  });

  it("a specialist without a model tier shows 'not recorded'", async () => {
    await renderLoaded();
    fireEvent.click(within(itemOf("team-tech-writer")).getByTestId("team-member-open"));
    const drawer = await screen.findByTestId("team-member-drawer");
    expect(within(drawer).getByTestId("team-member-drawer-tier").textContent).toBe("未记录");
    expect(within(drawer).getByText("还没有参与过运行")).toBeTruthy();
  });

  it.each([
    { how: "Esc", close: () => press("Escape") },
    { how: "scrim", close: () => fireEvent.click(screen.getByTestId("team-member-drawer-scrim")) },
    { how: "close button", close: () => fireEvent.click(screen.getByTestId("team-member-drawer-close")) },
  ])("$how closes the drawer and returns focus to the trigger card", async ({ close }) => {
    const { trigger } = await openBackend();
    act(() => { close(); });
    expect(screen.queryByTestId("team-member-drawer")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab ×12 stays inside the drawer", async () => {
    const user = userEvent.setup();
    const { drawer } = await openBackend();
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(drawer.contains(document.activeElement)).toBe(true);
  });

  it("# mention and dispatch closes the drawer, writes '#name ' into the launch box and focuses it", async () => {
    await openBackend();
    fireEvent.click(screen.getByTestId("team-member-drawer-mention"));
    expect(screen.queryByTestId("team-member-drawer")).toBeNull();
    expect(editor().textContent).toContain(`#${ZH["team-backend-dev"]} `);
    expect(document.activeElement).toBe(editor());
    expect((homeInputProps.at(-1)!.insertTextRequest as InsertRequest).mode).toBe("append");
  });

  it("the hover '# mention' on a card does the same without opening the drawer", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("team-launch-template-1"));
    const before = editor().textContent ?? "";
    fireEvent.click(within(itemOf("team-qa")).getByTestId("team-member-mention"));
    expect(screen.queryByTestId("team-member-drawer")).toBeNull();
    expect(editor().textContent).toBe(`${before} #${ZH["team-qa"]} `);
    expect(document.activeElement).toBe(editor());
  });
});

// ---------------------------------------------------------------- C5 ----

describe("C5 status filters and header stats", () => {
  const count = (key: string) => screen.getByTestId(`team-runs-filter-${key}`).querySelector("[data-filter-count]")?.textContent;
  const stat = (id: string) => screen.getByTestId(id).querySelector("[data-stat-value]")?.textContent;

  it("counts 8 / 2 / 2 / 3, each segment keeps only its rows, header active is 3", async () => {
    await renderLoaded();
    expect(["all", "active", "ended", "error"].map(count)).toEqual(["8", "2", "2", "3"]);
    const expected: Record<string, string[]> = {
      active: ["r4-ready", "r5-connecting"],
      ended: ["r1-completed", "r7-done-ready"],
      error: ["r2-failed", "r3-timedout", "r6-error"],
      all: IDS8,
    };
    for (const key of ["active", "ended", "error", "all"]) {
      fireEvent.click(screen.getByTestId(`team-runs-filter-${key}`));
      expect([...rowIds()].sort()).toEqual([...expected[key]].sort());
      expect(screen.getByTestId(`team-runs-filter-${key}`).getAttribute("aria-pressed")).toBe("true");
    }
    expect(stat("team-stat-runs")).toBe("8");
    expect(stat("team-stat-active")).toBe("3");
    expect(screen.getByTestId("team-stat-live-dot")).toBeTruthy();
  });

  it("runFilterBucket follows terminal state first", () => {
    expect(RUNS8.map((r) => runFilterBucket(r))).toEqual(["ended", "error", "error", "active", "active", "error", "ended", null]);
  });
});

// ---------------------------------------------------------------- C6 ----

describe("C6 run list interactions", () => {
  it("search by name substring and by session id prefix; / focuses the search", async () => {
    await renderLoaded();
    press("/", document.body);
    const search = screen.getByTestId("team-runs-search");
    expect(document.activeElement).toBe(search);
    // "eta" is in Beta, Zeta, Eta, Theta (not in Delta: "lta").
    fireEvent.change(search, { target: { value: "eta" } });
    expect(rowIds()).toEqual(["r8-none", "r7-done-ready", "r6-error", "r2-failed"]);
    fireEvent.change(search, { target: { value: "r6-err" } });
    expect(rowIds()).toEqual(["r6-error"]);
  });

  it("sorting toggles aria-sort and reverses rows", async () => {
    await renderLoaded();
    expect(rowIds()).toEqual([...IDS8].reverse());
    const th = screen.getByTestId("team-run-sort").closest("th")!;
    expect(th.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByTestId("team-run-sort"));
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    expect(rowIds()).toEqual(IDS8);
    fireEvent.click(screen.getByTestId("team-run-sort"));
    expect(th.getAttribute("aria-sort")).toBe("descending");
  });

  it("clicking a plain cell and Enter on the name both open the run", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const row = screen.getAllByTestId("team-run-row").find((r) => within(r).queryByTitle("r5-connecting"))!;
    fireEvent.click(row.querySelector('[data-col="status"]')!);
    expect(mockPush).toHaveBeenLastCalledWith("/workspace/default/team/r5-connecting");
    mockPush.mockClear();
    const link = within(screen.getAllByTestId("team-run-row").find((r) => within(r).queryByTitle("r2-failed"))!).getByTestId("team-run-name-link");
    link.focus();
    await user.keyboard("{Enter}");
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/workspace/default/team/r2-failed");
  });

  it("footer, member avatars and the seven column headers", async () => {
    await renderLoaded();
    expect(screen.getByTestId("team-runs-footer").textContent).toBe("共 8 次运行 · 显示 8 条");
    fireEvent.click(screen.getByTestId("team-runs-filter-error"));
    expect(screen.getByTestId("team-runs-footer").textContent).toBe(`共 8 次运行 · 显示 ${rowIds().length} 条`);
    expect(rowIds()).toHaveLength(3);
    fireEvent.click(screen.getByTestId("team-runs-filter-all"));
    const rowOf = (id: string) => screen.getAllByTestId("team-run-row").find((r) => within(r).queryByTitle(id))!;
    const r1 = rowOf("r1-completed").querySelector('[data-col="members"]') as HTMLElement;
    await waitFor(() => expect(within(r1).getByTestId("team-run-member-avatars").children).toHaveLength(2));
    expect(r1.textContent?.endsWith("2")).toBe(true);
    const r4 = rowOf("r4-ready").querySelector('[data-col="members"]') as HTMLElement;
    expect(within(r4).queryByTestId("team-run-member-avatars")).toBeNull();
    expect(r4.textContent).toBe("4");
    const headers = within(screen.getByTestId("team-run-records")).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(headers).toEqual(["会话", "代码仓与分支", "岗位", "成员会话", "状态", "开始时间", "操作"]);
    expect(within(rowOf("r1-completed")).getByTestId("team-run-narrow-repo").textContent).toBe("routa · main");
  });

  it("0 runs shows the three-step empty state and 'write the first task' focuses the editor", async () => {
    install({ runs: () => ok({ sessions: [] }) });
    await renderLoaded(0);
    const empty = await screen.findByTestId("team-runs-empty");
    expect(within(empty).getByText("还没有团队运行")).toBeTruthy();
    expect(within(empty).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(within(empty).getByTestId("team-runs-write-first"));
    expect(document.activeElement).toBe(editor());
  });

  it("no match shows 'clear filters', which resets the segment and the search", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("team-runs-filter-error"));
    fireEvent.change(screen.getByTestId("team-runs-search"), { target: { value: "zzz-nothing" } });
    expect(rowIds()).toEqual([]);
    expect(screen.getByText("没有匹配的会话")).toBeTruthy();
    fireEvent.click(screen.getByTestId("team-runs-clear-filters"));
    expect(screen.getByTestId("team-runs-filter-all").getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByTestId("team-runs-search") as HTMLInputElement).value).toBe("");
    expect(rowIds()).toHaveLength(8);
  });

  it("refresh reads the four lists once more; a failed reread keeps rows with the stale note", async () => {
    let runReads = 0;
    install({ runs: () => (runReads++ === 0 ? ok({ sessions: RUNS8 }) : fail()) });
    await renderLoaded();
    const before = [RUNS_URL, ALL_URL, AGENTS_URL, SPECIALISTS_URL].map(callsTo);
    fireEvent.click(screen.getByText("刷新"));
    await waitFor(() => expect([RUNS_URL, ALL_URL, AGENTS_URL, SPECIALISTS_URL].map(callsTo)).toEqual(before.map((n) => n + 1)));
    const section = screen.getByTestId("team-runs-section");
    const banner = await within(section).findByTestId("ui-error-state");
    expect(banner.textContent).toContain("显示的是上次读取的结果");
    expect(rowIds()).toHaveLength(8);
    fireEvent.click(within(banner).getByRole("button"));
    await waitFor(() => expect(callsTo(RUNS_URL)).toBe(before[0] + 2));
  });
});

// ---------------------------------------------------------------- C7 ----

describe("C7 looking around only reads; creating a run PATCHes the name once", () => {
  it("every interaction short of submitting issues exactly the four GETs", async () => {
    await renderLoaded();
    await waitFor(() => expect(within(itemOf("team-frontend-dev")).getByTestId("team-member-status").textContent).toContain("2"));
    fireEvent.click(screen.getByTestId("team-formation-view-list"));
    fireEvent.click(screen.getByTestId("team-formation-view-map"));
    fireEvent.click(within(itemOf("team-qa")).getByTestId("team-member-open"));
    fireEvent.click(await screen.findByTestId("team-member-drawer-close"));
    for (const key of ["active", "ended", "error", "all"]) fireEvent.click(screen.getByTestId(`team-runs-filter-${key}`));
    fireEvent.change(screen.getByTestId("team-runs-search"), { target: { value: "Alpha" } });
    (document.activeElement as HTMLElement | null)?.blur?.();
    press("n", document.body);
    (document.activeElement as HTMLElement | null)?.blur?.();
    press("/", document.body);
    fireEvent.click(screen.getByTestId("team-launch-template-2"));
    fireEvent.click(within(itemOf("team-qa")).getByTestId("team-member-mention"));
    const log = mockFetch.mock.calls.map(([input, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(input)}`);
    expect([...log].sort()).toEqual([`GET ${AGENTS_URL}`, `GET ${SPECIALISTS_URL}`, `GET ${ALL_URL}`, `GET ${RUNS_URL}`].sort());

    const props = homeInputProps.at(-1)!;
    act(() => { (props.onSessionCreated as (sid: string, prompt: string) => void)("new-run", "Fix login"); });
    const patches = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(String(patches[0][0])).toBe("/api/sessions/new-run");
    expect(JSON.parse(String((patches[0][1] as RequestInit).body)).name).toMatch(/^(Team run|Team - )/);
    expect(mockFetch.mock.calls.filter(([, init]) => !["GET", "PATCH", undefined].includes((init as RequestInit | undefined)?.method))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- F2 / F4 ----

describe("F2 old shapes stay", () => {
  it.each(["zh", "en"] as const)("%s: header, stats labels, top-level note and column headers come from the existing keys", async (locale) => {
    i18nState.locale = locale;
    const t = locale === "zh" ? await zh() : await en();
    await renderLoaded();
    const header = screen.getByTestId("team-page-header");
    expect(within(header).getByText(t.sessionsRedesign.teamTitle)).toBeTruthy();
    expect(within(header).getByText(t.sessionsRedesign.teamDescription)).toBeTruthy();
    expect(screen.getByTestId("team-stat-runs").textContent).toContain(t.team.runs);
    expect(screen.getByTestId("team-stat-active").textContent).toContain(t.team.active);
    expect(screen.getByTestId("team-stat-members").textContent).toContain(t.team.members);
    expect(screen.getByTestId("team-runs-top-level-only").textContent).toBe(t.team.topLevelOnly);
    expect(screen.getByTestId("team-configure-specialists").textContent).toContain(t.sessionsRedesign.configureSpecialists);
    expect(screen.getByTestId("team-launch-toggle").textContent).toContain(t.teamRedesign.page.launchRun);
    const r = t.teamRedesign.records;
    const headers = within(screen.getByTestId("team-run-records")).getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(headers).toEqual([r.colSession, r.colRepoBranch, r.colRole, r.colMembers, r.colStatus, r.colStartedAt, r.colActions]);
  });

  it("a user-overridden specialist name stays visible next to the dictionary name", async () => {
    install({ specialists: () => ok({ specialists: TEAM9.map((s) => (s.id === "team-frontend-dev" ? { ...s, name: "My Custom FE" } : s)) }) });
    await renderLoaded();
    expect(itemOf("team-frontend-dev").textContent).toContain("My Custom FE");
    fireEvent.click(within(itemOf("team-frontend-dev")).getByTestId("team-member-open"));
    expect((await screen.findByTestId("team-member-drawer")).textContent).toContain("My Custom FE");
  });
});

describe("F4 the new effect reaches every entry", () => {
  it("seven entries focus or fill the launch editor", async () => {
    await renderLoaded();
    const entries: Array<{ name: string; act: () => void; text?: string }> = [
      { name: "header button", act: () => fireEvent.click(screen.getByTestId("team-launch-toggle")) },
      { name: "N key", act: () => press("n", document.body) },
      { name: "card # mention", act: () => fireEvent.click(within(itemOf("team-ux-designer")).getByTestId("team-member-mention")), text: `#${ZH["team-ux-designer"]} ` },
      { name: "drawer # mention", act: () => {
        fireEvent.click(within(itemOf("team-operations")).getByTestId("team-member-open"));
        fireEvent.click(screen.getByTestId("team-member-drawer-mention"));
      }, text: `#${ZH["team-operations"]} ` },
      { name: "list view # mention", act: () => {
        fireEvent.click(screen.getByTestId("team-formation-view-list"));
        fireEvent.click(within(itemOf("team-researcher")).getByTestId("team-member-mention"));
        fireEvent.click(screen.getByTestId("team-formation-view-map"));
      }, text: `#${ZH["team-researcher"]} ` },
    ];
    for (const entry of entries) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      entry.act();
      expect({ entry: entry.name, focused: document.activeElement === editor() }).toEqual({ entry: entry.name, focused: true });
      if (entry.text) expect(editor().textContent?.endsWith(entry.text)).toBe(true);
    }
    // Template chips (4) are covered one by one in C2; the empty-state button in C6.
  });

  it("four entries open a run", async () => {
    install({ all: () => ok({ sessions: [...ALL_SESSIONS, ...BACKEND_SESSIONS] }) });
    await renderLoaded();
    const targets: string[] = [];
    const record = () => targets.push(String(mockPush.mock.calls.at(-1)?.[0]));
    fireEvent.click(screen.getAllByTestId("team-run-row")[0].querySelector('[data-col="started"]')!); record();
    fireEvent.click(screen.getAllByTestId("team-run-open")[1]); record();
    fireEvent.click(within(screen.getByTestId("team-lead-card")).getAllByTestId("team-coordinator-open").find((b) => !(b as HTMLButtonElement).disabled)!); record();
    fireEvent.click(within(itemOf("team-backend-dev")).getByTestId("team-member-open"));
    fireEvent.click(within(await screen.findByTestId("team-member-drawer")).getAllByTestId("team-member-drawer-run")[0]); record();
    expect(targets).toEqual([
      "/workspace/default/team/r8-none",
      "/workspace/default/team/r7-done-ready",
      "/workspace/default/team/r1-completed",
      "/workspace/default/team/r1-completed",
    ]);
  });

  it("en: filter names, footer and empty title come from the en dictionary", async () => {
    i18nState.locale = "en";
    const t = (await en()).teamRedesign.runs;
    await renderLoaded();
    expect(screen.getByTestId("team-runs-filter-all").textContent).toBe(`${t.filterAll}8`);
    expect(screen.getByTestId("team-runs-filter-error").textContent).toBe(`${t.filterError}3`);
    expect(screen.getByTestId("team-runs-footer").textContent).toBe("8 runs · showing 8");
  });
});
