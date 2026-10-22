import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en";

/**
 * Review fixes for redesign card 6/6:
 * - /settings/fluency renders the shared 21px settings page header (AC5);
 * - /canvas/:id with a missing ID shows an in-shell error, the shell stays (AC1/AC8).
 */

const { canvasViewerMock } = vi.hoisted(() => ({ canvasViewerMock: vi.fn() }));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="desktop-shell-root">{children}</div>
  ),
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker" />,
}));

vi.mock("@/client/components/fitness-analysis-panel", () => ({
  FitnessAnalysisPanel: () => <div data-testid="fitness-analysis-panel" />,
}));

vi.mock("@/client/components/settings-center-nav", () => ({
  SettingsCenterNav: () => <nav data-testid="settings-center-nav" />,
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: "ws-1", title: "Workspace One" }],
    loading: false,
    createWorkspace: vi.fn(),
  }),
  useCodebases: () => ({ codebases: [] }),
}));

vi.mock("@/client/components/canvas-viewer", () => ({
  CanvasViewer: (props: { canvasId: string }) => canvasViewerMock(props),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/settings/fluency",
}));

import { CanvasViewerClient } from "@/app/canvas/[id]/canvas-viewer-client";
import { FluencySettingsPageClient } from "@/app/settings/fluency/fluency-settings-page-client";

describe("redesign review fixes", () => {
  it("renders exactly one settings page header on /settings/fluency", () => {
    render(<FluencySettingsPageClient />);

    const headers = screen.getAllByTestId("settings-page-header");
    expect(headers).toHaveLength(1);
    const heading = within(headers[0]).getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(en.settingsRedesign.pages.fluency.title);
    expect(heading.className).toContain("text-[21px]");
    expect(screen.getByTestId("fluency-console-root").className).not.toContain("bg-desktop-bg-primary");
  });

  it("keeps the shell and shows an in-app error when the canvas cannot be loaded", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    canvasViewerMock.mockImplementation(() => {
      throw new Error("Canvas artifact not found");
    });

    render(<CanvasViewerClient canvasId="missing-canvas" />);

    expect(screen.getByTestId("desktop-shell-root")).toBeTruthy();
    expect(screen.getByTestId("settings-page-header")).toBeTruthy();
    const error = screen.getByTestId("canvas-load-error");
    expect(within(error).getByRole("alert").textContent).toContain(en.pagesRedesign.canvasPage.loadFailedTitle);
    expect(error.textContent).toContain("Canvas artifact not found");
    consoleError.mockRestore();
  });

  it("still renders the canvas when it loads", () => {
    canvasViewerMock.mockImplementation(({ canvasId }: { canvasId: string }) => (
      <div data-testid="canvas-viewer">{canvasId}</div>
    ));

    render(<CanvasViewerClient canvasId="canvas-ok" />);

    expect(screen.getByTestId("canvas-viewer").textContent).toBe("canvas-ok");
    expect(screen.queryByTestId("canvas-load-error")).toBeNull();
  });
});
