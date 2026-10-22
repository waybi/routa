import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Retention item 15 (近期功能保留清单): reopening Routa returns to the last
 * workspace; if that workspace no longer exists, fall back to the first.
 * Uses the real WorkspaceSwitcher so both the write and the restore are
 * covered.
 */

import HomePage from "../page";

const LAST_WORKSPACE_KEY = "routa.desktop.last-workspace-id";

const workspaceState = vi.hoisted(() => ({
  workspaces: [
    { id: "alpha", title: "Alpha", status: "active" as const, metadata: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "beta", title: "Beta", status: "active" as const, metadata: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ],
}));

const desktopAwareFetchMock = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [], tasks: [], boards: [], providers: [] }) }) as Response),
);

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

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: workspaceState.workspaces,
    loading: false,
    createWorkspace: vi.fn(async () => null),
  }),
  useCodebases: () => ({ codebases: [], fetchCodebases: vi.fn(async () => {}) }),
}));

vi.mock("@/client/hooks/use-acp", () => ({
  useAcp: () => ({ connected: true, loading: false, connect: vi.fn(async () => {}), providers: [] }),
}));

vi.mock("@/client/components/settings-panel", () => ({
  SettingsPanel: () => null,
  loadDefaultProviders: () => ({}),
  loadDockerOpencodeAuthJson: () => "",
  loadProviderConnections: () => ({}),
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children, workspaceSwitcher }: { children: ReactNode; workspaceSwitcher?: ReactNode }) => (
    <div data-testid="desktop-shell">
      {workspaceSwitcher}
      {children}
    </div>
  ),
}));

vi.mock("@/client/components/repo-picker", () => ({ RepoPicker: () => null }));
vi.mock("@/client/components/home/onboarding-card", () => ({ OnboardingCard: () => null }));
vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch: desktopAwareFetchMock, getDesktopApiBaseUrl: () => "" }));
vi.stubGlobal("EventSource", class {
  onmessage = null;
  onerror = null;
  close() {}
} as unknown as typeof EventSource);
vi.mock("@/client/utils/custom-acp-providers", () => ({ loadCustomAcpProviders: () => [], loadHiddenProviders: () => [] }));

function switcherLabel() {
  return screen.getByTestId("desktop-workspace-switcher").querySelector("button")?.textContent ?? "";
}

describe("HomePage last-workspace restore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("routa.onboarding.completed", "true");
  });

  it("reopens the last workspace saved by the switcher", async () => {
    const first = render(<HomePage />);
    await waitFor(() => expect(switcherLabel()).toContain("Alpha"));

    fireEvent.click(screen.getByTestId("desktop-workspace-switcher").querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));

    await waitFor(() => expect(window.localStorage.getItem(LAST_WORKSPACE_KEY)).toBe("beta"));
    first.unmount();

    render(<HomePage />);
    await waitFor(() => expect(switcherLabel()).toContain("Beta"));
    expect(switcherLabel()).not.toContain("Alpha");
  });

  it("falls back to the first workspace when the saved one no longer exists", async () => {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, "removed-workspace");

    render(<HomePage />);

    await waitFor(() => expect(switcherLabel()).toContain("Alpha"));
    await waitFor(() => expect(window.localStorage.getItem(LAST_WORKSPACE_KEY)).toBe("alpha"));
  });
});
