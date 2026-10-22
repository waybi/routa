import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children, workspaceId }: { children: ReactNode; workspaceId?: string | null }) => (
    <div data-testid="desktop-shell-root" data-workspace-id={workspaceId ?? ""}>{children}</div>
  ),
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: "ws-1", title: "Workspace One" }],
    loading: false,
    createWorkspace: vi.fn(),
  }),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

vi.mock("@/client/components/canvas-viewer", () => ({
  CanvasViewer: ({ canvasId }: { canvasId: string }) => <div data-testid="canvas-viewer">{canvasId}</div>,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => "/",
}));

import A2APage from "@/app/a2a/page";
import AGUIPage from "@/app/ag-ui/page";
import { CanvasViewerClient } from "@/app/canvas/[id]/canvas-viewer-client";
import { AcpReplayDebugPageClient } from "@/app/debug/acp-replay/page-client";
import MessagesPage from "@/app/messages/page";

const headers = en.pagesRedesign.headers;

function expectShellAndHeader(title: string) {
  const shell = screen.getByTestId("desktop-shell-root");
  const pageHeaders = within(shell).getAllByTestId("settings-page-header");
  expect(pageHeaders).toHaveLength(1);
  const heading = within(pageHeaders[0]).getByRole("heading", { level: 1 });
  expect(heading.textContent).toBe(title);
  return { shell, header: pageHeaders[0] };
}

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

describe("redesign page shells", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("EventSource", FakeEventSource);
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders /messages inside the app shell without the old hand-drawn header", () => {
    const { container } = render(<MessagesPage />);
    expectShellAndHeader(headers.messages.title);
    expect(screen.getByTestId("desktop-shell-root").getAttribute("data-workspace-id")).toBe("ws-1");
    expect(container.innerHTML).not.toContain("bg-[#fafafa]");
    expect(container.querySelector('img[alt="Routa"]')).toBeNull();
    expect(screen.getByRole("button", { name: en.pagesRedesign.messagesPage.tabTasks })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.pagesRedesign.messagesPage.tabLogs })).toBeTruthy();
  });

  it("renders the /messages copy from the dictionary in Chinese too", async () => {
    window.localStorage.setItem("routa.locale", "zh");
    const { default: zh } = await import("@/i18n/locales/zh");
    const { I18nProvider } = await import("@/i18n");
    render(<I18nProvider><MessagesPage /></I18nProvider>);
    expect(await screen.findByRole("button", { name: zh.pagesRedesign.messagesPage.tabTasks })).toBeTruthy();
    expect(screen.queryByText("Background Tasks")).toBeNull();
    expect(screen.queryByText("PR Agent & Background Tasks")).toBeNull();
    window.localStorage.removeItem("routa.locale");
  });

  it("renders /a2a inside the app shell", async () => {
    render(<A2APage />);
    const { header } = expectShellAndHeader(headers.a2a.title);
    expect(within(header).getByText("Live")).toBeTruthy();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  });

  it("renders /ag-ui inside the app shell and keeps its controls in the header actions", () => {
    render(<AGUIPage />);
    const { header } = expectShellAndHeader(headers.agUi.title);
    expect(screen.getByTestId("ag-ui-page-title").textContent).toBe(headers.agUi.title);
    expect(within(header).getByTestId("protocol-toggle-ag-ui")).toBeTruthy();
    expect(within(header).getByTestId("event-counter").textContent).toBe("0 events");
  });

  it("renders /canvas/:id inside the app shell", () => {
    render(<CanvasViewerClient canvasId="canvas-1" />);
    expectShellAndHeader(headers.canvas.title);
    expect(screen.getByTestId("canvas-viewer").textContent).toBe("canvas-1");
  });

  it("renders /debug/acp-replay inside the app shell", () => {
    render(<AcpReplayDebugPageClient />);
    expectShellAndHeader(headers.acpReplay.title);
  });
});
