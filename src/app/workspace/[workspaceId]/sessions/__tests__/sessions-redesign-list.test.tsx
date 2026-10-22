import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en";

import { SessionsPageClient } from "../sessions-page-client";

const copy = en.sessionsRedesign;

const { mockPush, mockFetch, mockConfirm, mockToastError } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockFetch: vi.fn(),
  mockConfirm: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "default" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/client/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

// HomeInput stand-in: an editable field like the real Tiptap editor.
vi.mock("@/client/components/home-input", () => ({
  HomeInput: () => <div contentEditable suppressContentEditableWarning data-testid="home-input-editor" tabIndex={0} />,
}));

vi.mock("@/client/hooks/use-workspaces", () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: "default", title: "Default Workspace" }],
    loading: false,
    createWorkspace: vi.fn(async () => null),
  }),
}));

vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch: mockFetch }));
vi.mock("@/client/components/confirm-dialog", () => ({ useConfirm: () => mockConfirm }));
vi.mock("@/client/components/toast", () => ({ toast: { error: mockToastError, success: vi.fn(), info: vi.fn() } }));

const LIST_URL = "/api/sessions?workspaceId=default&limit=100";

const SESSIONS = [
  { sessionId: "abc12345-0000", name: "Fix login redirect", provider: "dsh", role: "CRAFTER", workspaceId: "default", cwd: "/", createdAt: "2026-10-22T10:00:00.000Z" },
  { sessionId: "def67890-0000", name: "Refactor board lanes", provider: "dsh", role: "GATE", workspaceId: "default", cwd: "/", createdAt: "2026-10-22T09:00:00.000Z" },
];

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function listResponder(overrides: Partial<Record<string, () => Promise<Response>>> = {}) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = `${init?.method ?? "GET"} ${url}`;
    if (overrides[key]) return overrides[key]!();
    if (url === LIST_URL) return ok({ sessions: SESSIONS });
    return ok({});
  });
}

function rows() {
  return screen.queryAllByTestId("session-row");
}

describe("SessionsPageClient redesign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC1: filters rows by name or session-ID prefix and shows the filter-empty state", async () => {
    listResponder();
    render(<SessionsPageClient />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    // 8-char monospace ID on each row
    expect(screen.getByText("abc12345")).toBeTruthy();

    const search = screen.getByRole("searchbox", { name: copy.searchSessions });
    fireEvent.change(search, { target: { value: "login" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Fix login redirect")).toBeTruthy();

    fireEvent.change(search, { target: { value: "DEF6" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Refactor board lanes")).toBeTruthy();

    fireEvent.change(search, { target: { value: "nothing-like-this" } });
    expect(rows()).toHaveLength(0);
    expect(screen.getByText(copy.filterEmptyTitle)).toBeTruthy();
    expect(screen.queryByText(copy.emptyTitle)).toBeNull();
  });

  it("AC1: the New session button moves focus into the HomeInput editor", async () => {
    listResponder();
    render(<SessionsPageClient />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("sessions-new-session"));
    expect(document.activeElement).toBe(screen.getByTestId("home-input-editor"));
  });

  it("AC2: shows a skeleton while the first read is in flight", async () => {
    let resolve: (value: Response) => void = () => {};
    mockFetch.mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
    render(<SessionsPageClient />);
    expect(screen.getByTestId("ui-skeleton")).toBeTruthy();
    await act(async () => resolve(ok({ sessions: SESSIONS })));
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it("AC2: shows the empty state with a next step when there are no sessions", async () => {
    mockFetch.mockResolvedValue(ok({ sessions: [] }));
    render(<SessionsPageClient />);
    expect(await screen.findByText(copy.emptyTitle)).toBeTruthy();
    expect(screen.getByText(copy.emptyDescription)).toBeTruthy();
  });

  it("AC2: a failed read shows the error state, keeps the old list and Reload reads again", async () => {
    listResponder();
    render(<SessionsPageClient />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    mockFetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    fireEvent.click(screen.getByRole("button", { name: en.common.refresh }));
    expect(await screen.findByTestId("ui-error-state")).toBeTruthy();
    expect(rows()).toHaveLength(2);

    const before = mockFetch.mock.calls.filter(([url]) => String(url) === LIST_URL).length;
    listResponder();
    fireEvent.click(within(screen.getByTestId("ui-error-state")).getByRole("button", { name: copy.reload }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.filter(([url]) => String(url) === LIST_URL).length).toBe(before + 1);
    });
    await waitFor(() => expect(screen.queryByTestId("ui-error-state")).toBeNull());
  });

  it("AC2: a first read that fails shows the error state instead of an empty list", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));
    render(<SessionsPageClient />);
    expect(await screen.findByTestId("ui-error-state")).toBeTruthy();
    expect(screen.queryByText(copy.emptyTitle)).toBeNull();
  });

  it("AC3: delete goes through the in-app confirm and never window.confirm", async () => {
    const windowConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    listResponder();
    render(<SessionsPageClient />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: `${copy.deleteAction} Fix login redirect` }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/sessions/abc12345-0000", { method: "DELETE" });
    });
    expect(windowConfirm).not.toHaveBeenCalled();
  });

  it("AC3: cancelling the confirm sends no DELETE", async () => {
    mockConfirm.mockResolvedValue(false);
    listResponder();
    render(<SessionsPageClient />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: `${copy.deleteAction} Fix login redirect` }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  });

  it("AC3: a failed delete shows an inline error and a sticky error toast", async () => {
    listResponder({
      "DELETE /api/sessions/abc12345-0000": async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response,
    });
    render(<SessionsPageClient />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: `${copy.deleteAction} Fix login redirect` }));
    const inline = await screen.findByTestId("session-row-error");
    expect(inline.getAttribute("role")).toBe("alert");
    expect(inline.textContent).toContain(copy.deleteFailed);
    expect(mockToastError).toHaveBeenCalledWith(copy.deleteFailed, expect.objectContaining({ description: "HTTP 500" }));
  });

  it("AC3: a failed rename shows an inline error and an error toast", async () => {
    listResponder({
      "PATCH /api/sessions/abc12345-0000": async () => { throw new Error("network down"); },
    });
    render(<SessionsPageClient />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: `${copy.renameAction} Fix login redirect` }));
    const input = screen.getByRole("textbox", { name: copy.renameAction });
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findByTestId("session-row-error")).textContent).toContain(copy.renameFailed);
    expect(mockToastError).toHaveBeenCalledWith(copy.renameFailed, expect.objectContaining({ description: "network down" }));
  });

  it("AC14: the search box and the row Open action are keyboard-focusable", async () => {
    listResponder();
    render(<SessionsPageClient />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    const search = screen.getByRole("searchbox", { name: copy.searchSessions });
    const open = within(rows()[0]).getByRole("button", { name: copy.openSessionAction });
    for (const element of [search, open]) {
      expect(element.getAttribute("tabindex")).not.toBe("-1");
      element.focus();
      expect(document.activeElement).toBe(element);
    }
    fireEvent.click(open);
    expect(mockPush).toHaveBeenCalledWith("/workspace/default/sessions/abc12345-0000");
  });
});
