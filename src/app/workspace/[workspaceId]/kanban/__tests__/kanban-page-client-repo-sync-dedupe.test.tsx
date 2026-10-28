import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch, stable, tab } = vi.hoisted(() => ({
  stable: {
    acp: { connected: true, loading: false, providers: [], connect: () => {} },
    workspaces: { workspaces: [], loading: false, createWorkspace: () => {} },
    codebases: [] as unknown[],
    router: { push: () => {} },
    params: { workspaceId: "ws-a" },
    translation: { locale: "en", t: { workspace: { defaultWorkspace: "Default" }, feedback: {} } },
    lifecycle: () => {},
    fetchCodebases: async () => {},
  },
  desktopAwareFetch: vi.fn(),
  tab: { statuses: [] as string[] },
}));

vi.mock("next/navigation", () => ({
  useParams: () => stable.params,
  useRouter: () => stable.router,
}));
vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch }));
vi.mock("@/client/hooks/use-kanban-events", () => ({ useKanbanEvents: () => {} }));
vi.mock("@/client/hooks/use-acp", () => ({ useAcp: () => stable.acp }));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => stable.workspaces,
  useCodebases: () => ({ codebases: stable.codebases, fetchCodebases: stable.fetchCodebases }),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
// The status bar reads this prop; record every status the page hands to it.
vi.mock("../kanban-tab", () => ({
  KanbanTab: (props: { repoSync?: { status: string } }) => {
    tab.statuses.push(props.repoSync?.status ?? "none");
    return null;
  },
}));
vi.mock("../use-task-lifecycle-notifications", () => ({ useTaskLifecycleNotifications: () => stable.lifecycle }));
vi.mock("../kanban-task-change-signal", () => ({ publishKanbanTaskChanges: vi.fn() }));
vi.mock("@/i18n", () => ({ useTranslation: () => stable.translation }));

import { KanbanPageClient } from "../kanban-page-client";
import { resetRepoSyncDedupe } from "../kanban-repo-sync-dedupe";

type PatchBodyShape = { repoPath: string; pull?: boolean };

function patchPulls(): PatchBodyShape[] {
  return desktopAwareFetch.mock.calls
    .filter(([url, init]) => String(url) === "/api/clone/branches" && (init as RequestInit | undefined)?.method === "PATCH")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as PatchBodyShape)
    .filter((body) => body.pull === true);
}

function useCodebases(workspaceId: string, repoPaths: string[]) {
  stable.params.workspaceId = workspaceId;
  stable.codebases = repoPaths.map((repoPath, i) => ({
    id: `${workspaceId}-cb-${i}`, repoPath, branch: "main", label: repoPath.split("/").pop(),
  }));
}

function mockServer(patchResponse: () => { ok: boolean; status?: number; body: unknown }) {
  desktopAwareFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/clone/branches") && init?.method === "PATCH") {
      const r = patchResponse();
      return { ok: r.ok, status: r.status ?? 200, json: async () => r.body };
    }
    if (String(url).startsWith("/api/clone/branches")) {
      return { ok: true, status: 200, json: async () => ({ current: "main" }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

describe("KanbanPageClient repo sync dedupe (C7)", () => {
  beforeEach(() => {
    resetRepoSyncDedupe();
    desktopAwareFetch.mockReset();
    tab.statuses = [];
  });
  afterEach(() => vi.clearAllMocks());

  it("pulls each repo once per tab across A -> B -> A, never showing 'syncing' on repeats", async () => {
    mockServer(() => ({ ok: true, body: { branch: "main", pullSkipped: true, pullSkipReason: "cooldown" } }));

    useCodebases("ws-a", ["/r/a1", "/r/a2"]);
    const first = render(<KanbanPageClient />);
    await waitFor(() => expect(tab.statuses).toContain("done"));
    expect(patchPulls().map((b) => b.repoPath).sort()).toEqual(["/r/a1", "/r/a2"]);
    first.unmount();

    useCodebases("ws-b", ["/r/b1"]);
    tab.statuses = [];
    const second = render(<KanbanPageClient />);
    await waitFor(() => expect(tab.statuses).toContain("done"));
    expect(patchPulls().map((b) => b.repoPath).sort()).toEqual(["/r/a1", "/r/a2", "/r/b1"]);
    second.unmount();

    useCodebases("ws-a", ["/r/a1", "/r/a2"]);
    tab.statuses = [];
    desktopAwareFetch.mockClear();
    render(<KanbanPageClient />);
    await waitFor(() => expect(tab.statuses.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(patchPulls()).toEqual([]);
    expect(desktopAwareFetch.mock.calls.some(([url]) => String(url).startsWith("/api/clone/branches"))).toBe(false);
    expect(new Set(tab.statuses)).toEqual(new Set(["idle"]));
  });

  it("an old-shape response (no pullSkipped) counts as success", async () => {
    mockServer(() => ({ ok: true, body: { branch: "main", success: true } }));
    useCodebases("ws-a", ["/r/old"]);
    render(<KanbanPageClient />);
    await waitFor(() => expect(tab.statuses).toContain("done"));
    expect(tab.statuses).not.toContain("error");
  });

  it("a failed pull shows the error state and is retried on the next board open", async () => {
    mockServer(() => ({ ok: false, status: 500, body: { error: "boom" } }));
    useCodebases("ws-a", ["/r/bad"]);
    const first = render(<KanbanPageClient />);
    await waitFor(() => expect(tab.statuses).toContain("error"));
    first.unmount();

    tab.statuses = [];
    render(<KanbanPageClient />);
    await waitFor(() => expect(tab.statuses).toContain("error"));
    expect(patchPulls()).toHaveLength(2);
  });
});
