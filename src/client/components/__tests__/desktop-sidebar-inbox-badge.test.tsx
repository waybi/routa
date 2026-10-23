/**
 * Card 2156f853: the Needs-you count badge in the sidebar after merging with
 * the collapsible (compact) sidebar. Contract items C1–C5, C10, C11.
 * Expected counts are written out from the requirement (one blocked card is
 * one Needs-you row), not computed by the code under test.
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KanbanBoardInfo, TaskInfo } from "@/app/workspace/[workspaceId]/types";
import type { OverviewWorkspaceData } from "@/app/workspace/[workspaceId]/kanban/use-kanban-overview-data";
import { resetAttentionDismissalsForTests } from "@/app/workspace/[workspaceId]/kanban/use-kanban-attention-dismissals";
import { I18nProvider } from "@/i18n";

const NOW = Date.UTC(2026, 9, 21, 12);

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/ws1/kanban",
}));
vi.mock("@/client/components/home/relative-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/components/home/relative-time")>();
  return { ...actual, useMinuteClock: () => NOW };
});

import { InboxBadgeDataProvider } from "../shell/inbox-badge-data-context";
import { DesktopSidebar } from "../desktop-sidebar";

function board(id: string): KanbanBoardInfo {
  return {
    id,
    name: id,
    isDefault: true,
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
    ],
  } as unknown as KanbanBoardInfo;
}

function ready(n: number): OverviewWorkspaceData {
  const tasks = Array.from({ length: n }, (_, index) => ({
    id: `ws1-c${index}`,
    title: `card ${index}`,
    status: "PENDING",
    boardId: "ws1-b",
    columnId: "blocked",
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    updatedAt: new Date(NOW - 3_600_000).toISOString(),
  })) as unknown as TaskInfo[];
  return { status: "ready", tasks, boards: [board("ws1-b")] };
}

function wrapper(n: number) {
  return function Provided({ children }: { children: React.ReactNode }) {
    return (
      <I18nProvider>
        <InboxBadgeDataProvider workspaces={[{ id: "ws1", title: "One" }]} workspacesLoading={false} data={{ ws1: ready(n) }}>
          {children}
        </InboxBadgeDataProvider>
      </I18nProvider>
    );
  };
}

type Mode = { name: string; collapsed: boolean; drawerOpen: boolean; compact: boolean };
const EXPANDED: Mode = { name: "expanded", collapsed: false, drawerOpen: false, compact: false };
const COMPACT: Mode = { name: "collapsed rail", collapsed: true, drawerOpen: false, compact: true };
const COLLAPSED_DRAWER: Mode = { name: "collapsed + drawer open", collapsed: true, drawerOpen: true, compact: false };

function renderSidebar(mode: Mode, n: number) {
  return render(
    <DesktopSidebar workspaceId="ws1" collapsed={mode.collapsed} drawerOpen={mode.drawerOpen} onDrawerClose={vi.fn()} />,
    { wrapper: wrapper(n) },
  );
}

function inboxLink(): HTMLElement {
  return screen.getByTestId("desktop-shell-sidebar").querySelector<HTMLElement>('[data-nav-id="inbox"]')!;
}

function navIdsWithBadge(): Array<string | null> {
  return Array.from(screen.getByTestId("desktop-shell-sidebar").querySelectorAll<HTMLElement>("[data-nav-id]"))
    .filter((link) => within(link).queryByTestId("inbox-nav-badge"))
    .map((link) => link.getAttribute("data-nav-id"));
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("routa.locale", "en");
  resetAttentionDismissalsForTests();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("not used", { status: 404 }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("needs-you badge in the collapsible sidebar", () => {
  for (const locale of ["en", "zh"] as const) {
    it(`C1/C5 collapsed rail (${locale}): no label, badge 3 in rail style, link is relative`, () => {
      window.localStorage.setItem("routa.locale", locale);
      renderSidebar(COMPACT, 3);
      expect(screen.getByTestId("desktop-shell-sidebar").getAttribute("data-collapsed")).toBe("true");
      const link = inboxLink();
      expect(link.querySelector("span.truncate")).toBeNull();
      const el = within(link).getByTestId("inbox-nav-badge");
      expect(el.textContent).toBe("3");
      expect(el.className).toContain("absolute");
      expect(el.className).not.toContain("ml-auto");
      expect(link.className.split(/\s+/)).toContain("relative");
      expect(el.getAttribute("aria-label")).toBe(locale === "en" ? "Needs you, 3 items" : "需要你处理，3 项");
      expect(navIdsWithBadge()).toEqual(["inbox"]);
    });

    it(`C2/C5 expanded (${locale}): badge 3 right of the label in row style, only on inbox`, () => {
      window.localStorage.setItem("routa.locale", locale);
      renderSidebar(EXPANDED, 3);
      expect(screen.getByTestId("desktop-shell-sidebar").getAttribute("data-collapsed")).toBe("false");
      const link = inboxLink();
      expect(link.querySelector("span.truncate")?.textContent).toBe(locale === "en" ? "Needs you" : "需要你处理");
      const el = within(link).getByTestId("inbox-nav-badge");
      expect(el.textContent).toBe("3");
      expect(el.className).toContain("ml-auto");
      expect(el.className).not.toContain("absolute");
      expect(navIdsWithBadge()).toEqual(["inbox"]);
    });
  }

  for (const mode of [EXPANDED, COMPACT]) {
    it(`C3 ${mode.name}: 0 rows → no badge`, () => {
      renderSidebar(mode, 0);
      expect(screen.getByTestId("desktop-shell-sidebar").getAttribute("data-collapsed")).toBe(mode.compact ? "true" : "false");
      expect(screen.queryByTestId("inbox-nav-badge")).toBeNull();
    });
  }

  it("C4 collapsed but drawer open: treated as expanded, label shown, row badge", () => {
    renderSidebar(COLLAPSED_DRAWER, 3);
    expect(screen.getByTestId("desktop-shell-sidebar").getAttribute("data-collapsed")).toBe("false");
    const link = inboxLink();
    expect(link.querySelector("span.truncate")?.textContent).toBe("Needs you");
    const el = within(link).getByTestId("inbox-nav-badge");
    expect(el.textContent).toBe("3");
    expect(el.className).toContain("ml-auto");
    expect(el.className).not.toContain("absolute");
  });

  it("C10 120 rows: rail and row show the same text (99+)", () => {
    const view = renderSidebar(COMPACT, 120);
    const railText = screen.getByTestId("inbox-nav-badge").textContent;
    view.unmount();
    renderSidebar(EXPANDED, 120);
    expect(screen.getByTestId("inbox-nav-badge").textContent).toBe(railText);
    expect(railText).toBe("99+");
  });

  it("C11 collapsed rail: link accessible name is the label only (records current behavior)", () => {
    renderSidebar(COMPACT, 3);
    expect(inboxLink().getAttribute("aria-label")).toBe("Needs you");
  });
});
