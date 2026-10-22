import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));
const acp = vi.hoisted(() => ({
  connected: true,
  loading: false,
  providers: [{ id: "codex", name: "Codex", status: "available" }],
  selectedProvider: "codex",
  connect: vi.fn(),
  setProvider: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-1", codebaseId: "cb-1" }),
  useRouter: () => ({ back: nav.back, push: nav.push }),
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: ReactNode }) => <div data-testid="desktop-shell-root">{children}</div>,
}));

vi.mock("@/client/components/acp-provider-dropdown", () => ({
  AcpProviderDropdown: ({ ariaLabel }: { ariaLabel?: string }) => <div data-testid="acp-provider-dropdown">{ariaLabel}</div>,
}));

vi.mock("@/client/hooks/use-acp", () => ({ useAcp: () => acp }));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

import { RepoSlidePageClient } from "../reposlide-page-client";

describe("RepoSlidePageClient", () => {
  beforeEach(() => {
    nav.back.mockReset();
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        codebase: { id: "cb-1", label: "routa", repoPath: "/repo/routa", sourceType: "local" },
        summary: { totalFiles: 1, totalDirectories: 1, topLevelFolders: [], sourceType: "local" },
        context: { rootFiles: [], entryPoints: [], keyFiles: [], focusDirectories: [] },
        launch: { skillName: "slide-skill", skillAvailable: true, prompt: "go" },
      }),
    } as Response);
  });

  it("puts Back, the provider dropdown and Launch into the settings-style page header", async () => {
    render(<RepoSlidePageClient />);

    const shell = screen.getByTestId("desktop-shell-root");
    const header = within(shell).getByTestId("settings-page-header");
    expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe("Repo slides");
    const actions = within(header).getByTestId("settings-page-header-actions");
    expect(within(actions).getByTestId("acp-provider-dropdown").textContent).toBe("Select RepoSlide provider");

    const launch = within(actions).getByRole("button", { name: "Launch RepoSlide" }) as HTMLButtonElement;
    await waitFor(() => expect(launch.disabled).toBe(false));

    fireEvent.click(within(actions).getByRole("button", { name: "← Back" }));
    expect(nav.back).toHaveBeenCalledTimes(1);
  });
});
