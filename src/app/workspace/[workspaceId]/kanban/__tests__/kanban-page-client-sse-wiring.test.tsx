import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The board page is the only caller of useKanbanEvents. This test mounts the
// page with the real hook to prove the self-healing reconnect reaches it.
const { desktopAwareFetch, stable } = vi.hoisted(() => ({
  stable: {
    acp: { connected: true, loading: false, providers: [], connect: () => {} },
    workspaces: { workspaces: [], loading: false, createWorkspace: () => {} },
    codebases: [] as unknown[],
    router: { push: () => {} },
    params: { workspaceId: "workspace-1" },
    translation: { locale: "en", t: { workspace: { defaultWorkspace: "Default" }, feedback: {} } },
    lifecycle: () => {},
  },
  desktopAwareFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => stable.params,
  useRouter: () => stable.router,
}));
vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch, getDesktopApiBaseUrl: () => "" }));
vi.mock("@/client/hooks/use-acp", () => ({ useAcp: () => stable.acp }));
vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => stable.workspaces,
  useCodebases: () => ({ codebases: stable.codebases, fetchCodebases: async () => {} }),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("../kanban-tab", () => ({ KanbanTab: () => null }));
vi.mock("../use-task-lifecycle-notifications", () => ({ useTaskLifecycleNotifications: () => stable.lifecycle }));
vi.mock("../kanban-task-change-signal", () => ({ publishKanbanTaskChanges: vi.fn() }));
vi.mock("@/i18n", () => ({ useTranslation: () => stable.translation }));

import { KanbanPageClient } from "../kanban-page-client";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  readonly listenerTypes: string[] = [];
  readonly close = vi.fn(() => {
    this.readyState = 2;
  });
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string) {
    this.listenerTypes.push(type);
  }
  removeEventListener() {}
}

describe("KanbanPageClient event stream wiring", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    desktopAwareFetch.mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  it("listens for server pings and reconnects when the tab comes back", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    render(<KanbanPageClient />);
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    const source = MockEventSource.instances[0];
    expect(source.url).toContain("/api/kanban/events?workspaceId=workspace-1");
    expect(source.listenerTypes).toContain("ping");
    expect(addSpy.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => source.onerror?.(new Event("error")));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(MockEventSource.instances).toHaveLength(2);
    addSpy.mockRestore();
  });
});
