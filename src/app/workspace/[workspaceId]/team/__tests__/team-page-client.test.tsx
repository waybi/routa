import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeamPageClient } from "../team-page-client";

const { mockPush, mockDesktopAwareFetch } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockDesktopAwareFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "default" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/i18n", async () => {
  const { default: realEn } = await vi.importActual<typeof import("@/i18n/locales/en")>("@/i18n/locales/en");
  return {
  useTranslation: () => ({
    t: {
      sessionsRedesign: realEn.sessionsRedesign,
      uiKit: realEn.uiKit,
      common: {
        workspace: "Workspace",
        refresh: "Refresh",
      },
      team: {
        loadingWorkspace: "Loading workspace",
        launchTeamLead: "Launch Team Lead",
        reusesInput: "Reuse the same input flow",
        runs: "Runs",
        active: "Active",
        members: "Members",
        teamBench: "Team Bench",
        specialists: "specialists",
        teamRuns: "Team Runs",
        topLevelOnly: "Top-level only",
        noTeamRunsYet: "No team runs yet",
        unnamedRun: "Unnamed Team run",
        launchAbove: "Launch one above",
      },
      home: {
        modeTeamTitle: "Team",
        modeTeamDescription: "Team mode",
        modeTeamPlaceholder: "Describe the work",
      },
    },
  }),
  };
});

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/components/home-input", () => ({
  HomeInput: () => <div data-testid="home-input" />,
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [
      {
        id: "default",
        title: "Default Workspace",
      },
    ],
    loading: false,
    createWorkspace: vi.fn(async () => null),
  }),
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: mockDesktopAwareFetch,
}));

vi.mock("@/client/utils/specialist-categories", () => ({
  filterSpecialistsByCategory: (specialists: Array<unknown>) => specialists,
}));

vi.mock("../ui-components", () => ({
  formatRelativeTime: () => "just now",
}));

describe("TeamPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDesktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sessions?workspaceId=default&surface=team") {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              {
                sessionId: "team-run-1",
                name: "Team - Investigate regression",
                workspaceId: "default",
                acpStatus: "ready",
                createdAt: "2026-04-18T00:00:00.000Z",
              },
            ],
          }),
        } as Response;
      }

      if (url === "/api/specialists") {
        return {
          ok: true,
          json: async () => ({ specialists: [] }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  it("loads and renders team runs from the backend team surface", async () => {
    render(<TeamPageClient />);

    await waitFor(() => {
      expect(mockDesktopAwareFetch).toHaveBeenCalledWith(
        "/api/sessions?workspaceId=default&surface=team",
        expect.objectContaining({ cache: "no-store" }),
      );
    });

    expect(await screen.findByText("Team - Investigate regression")).toBeTruthy();
  });

  it("renders the unnamed team-run fallback from i18n", async () => {
    mockDesktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sessions?workspaceId=default&surface=team") {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              {
                sessionId: "team-run-1",
                workspaceId: "default",
                acpStatus: "ready",
                createdAt: "2026-04-18T00:00:00.000Z",
              },
            ],
          }),
        } as Response;
      }

      if (url === "/api/specialists") {
        return {
          ok: true,
          json: async () => ({ specialists: [] }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<TeamPageClient />);

    expect(await screen.findByText("Unnamed Team run")).toBeTruthy();
  });

  it("AC5: searching team runs leaves only the matching runs", async () => {
    mockDesktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sessions?workspaceId=default&surface=team") {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              { sessionId: "run-aaa-1", name: "Team - Investigate regression", workspaceId: "default", acpStatus: "ready", createdAt: "2026-04-18T00:00:00.000Z" },
              { sessionId: "run-bbb-2", name: "Team - Ship onboarding", workspaceId: "default", acpStatus: "ready", createdAt: "2026-04-17T00:00:00.000Z" },
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ specialists: [] }) } as Response;
    });

    render(<TeamPageClient />);
    await waitFor(() => expect(screen.getAllByTestId("team-run-row")).toHaveLength(2));

    fireEvent.change(screen.getByTestId("team-runs-search"), { target: { value: "onboarding" } });
    expect(screen.getAllByTestId("team-run-row")).toHaveLength(1);
    expect(screen.getByText("Team - Ship onboarding")).toBeTruthy();

    fireEvent.change(screen.getByTestId("team-runs-search"), { target: { value: "run-aaa" } });
    expect(screen.getAllByTestId("team-run-row")).toHaveLength(1);
    expect(screen.getByText("Team - Investigate regression")).toBeTruthy();
  });

  it("AC5: the configure button links to the specialists settings page", async () => {
    render(<TeamPageClient />);
    const link = await screen.findByTestId("team-configure-specialists");
    expect(link.getAttribute("href")).toBe("/settings/specialists");
  });

  it("AC2: a failed team-run read shows the error state and Reload reads again", async () => {
    mockDesktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("surface=team")) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => ({ specialists: [] }) } as Response;
    });

    render(<TeamPageClient />);
    const error = await screen.findByTestId("ui-error-state");
    const calls = () => mockDesktopAwareFetch.mock.calls.filter(([url]) => String(url).includes("surface=team")).length;
    const before = calls();
    fireEvent.click(within(error).getByRole("button"));
    await waitFor(() => expect(calls()).toBe(before + 1));
  });
});
