/**
 * Card 64f2e31c (AC5, AC7, C4, C8): cards the Blocked resolver concluded as
 * landed / superseded / handed off / waiting leave "Needs you" (board strip
 * and inbox) and show up in the "Handled by AI" section; needs_owner stays
 * and sorts first. Existing inbox controls stay visible.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { collectAttentionItems, collectTaskAttentionItems } from "../../kanban/kanban-attention-rules";
import { buildResolvedRows, buildWorkspaceInbox } from "../inbox-rules";
import { DAY, HOUR, NOW, card, doneCard, iso, makeBoard, report } from "./inbox-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ workspaceId: "w1" }),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));

import { InboxPageClient } from "../inbox-page-client";
import { __resetKanbanOverviewCacheForTests } from "../../kanban/use-kanban-overview-data";
import { resetAttentionDismissalsForTests } from "../../kanban/use-kanban-attention-dismissals";

const WS = { id: "w1", title: "Alpha" };
const board = makeBoard("b1", true);
const resolution = (category: string, extra: Record<string, string> = {}) => ({
  category, conclusion: `结论 ${category}`, resolvedAt: iso(NOW - HOUR), ...extra,
}) as TaskInfo["attentionResolution"];

const RECORD = "## 自动处理记录\n### 卡在哪\nattention:doneFailed\n### 判断\nlanded\n### 做了什么\nPATCH\n### 结果核对\nok\n### 没做什么、为什么\n无";

describe("collectTaskAttentionItems with attentionResolution (C4)", () => {
  const failed = (overrides: Partial<TaskInfo> = {}) => doneCard("x", "failed", overrides);
  const opts = { hasMainPusher: true, now: NOW };

  it.each(["landed", "superseded", "handed_off", "waiting"])("%s leaves the attention list", (category) => {
    expect(collectTaskAttentionItems(failed({ attentionResolution: resolution(category) }), opts)).toEqual([]);
    expect(collectTaskAttentionItems(card("b", { columnId: "blocked", attentionResolution: resolution(category) }), opts)).toEqual([]);
  });

  it("needs_owner stays", () => {
    expect(collectTaskAttentionItems(failed({ attentionResolution: resolution("needs_owner") }), opts).map((item) => item.kind))
      .toEqual(["doneFailed"]);
  });

  it("a card without the field is judged as before", () => {
    expect(collectTaskAttentionItems(failed(), opts).map((item) => item.kind)).toEqual(["doneFailed"]);
    expect(collectTaskAttentionItems(failed({ attentionResolution: undefined }), opts).map((item) => item.kind)).toEqual(["doneFailed"]);
  });

  it("empty laneSessions and missing fields do not throw", () => {
    expect(() => collectTaskAttentionItems({ id: "e", laneSessions: [] } as unknown as TaskInfo, opts)).not.toThrow();
    expect(() => collectTaskAttentionItems({ id: "e" } as unknown as TaskInfo, opts)).not.toThrow();
  });

  it("the board strip (collectAttentionItems) and the inbox drop the same resolved card (F4)", () => {
    const tasks = [failed({ id: "r", attentionResolution: resolution("landed") }), doneCard("o", "failed")];
    expect(collectAttentionItems(tasks, board, NOW).map((item) => item.taskId)).toEqual(["o"]);
    expect(buildWorkspaceInbox(WS, tasks, [board], NOW, () => []).active.map((row) => row.task.id)).toEqual(["o"]);
  });

  it("needs_owner sorts first even below a P1 failure", () => {
    const tasks = [
      doneCard("p1", "failed", { title: "P1 failure" }),
      card("own", { title: "Owner", columnId: "blocked", attentionResolution: resolution("needs_owner"), updatedAt: iso(NOW - 3 * DAY) }),
    ];
    const rows = buildWorkspaceInbox(WS, tasks, [board], NOW, () => []).active;
    expect(rows.map((row) => row.task.id)).toEqual(["own", "p1"]);
    expect(rows[0].needsOwner).toBe(true);
  });

  it("buildResolvedRows lists resolved cards newest first and skips needs_owner and old ones", () => {
    const tasks = [
      doneCard("a", "failed", { attentionResolution: resolution("landed", { resolvedAt: iso(NOW - 2 * HOUR) }) }),
      card("b", { columnId: "blocked", attentionResolution: resolution("waiting", { resolvedAt: iso(NOW - HOUR) }) }),
      card("c", { columnId: "blocked", attentionResolution: resolution("needs_owner") }),
      card("d", { columnId: "blocked", attentionResolution: resolution("landed", { resolvedAt: iso(NOW - 9 * DAY) }) }),
    ];
    const rows = buildResolvedRows([WS], { w1: { tasks, boards: [board] } }, NOW);
    expect(rows.map((row) => [row.task.id, row.category])).toEqual([["b", "waiting"], ["a", "landed"]]);
  });
});

let DATA: Record<string, { tasks: TaskInfo[]; boards: KanbanBoardInfo[] }>;

function respond(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  const ws = parsed.searchParams.get("workspaceId") ?? "";
  if (parsed.pathname === "/api/workspaces") {
    return Response.json({ workspaces: [{ id: "w1", title: "Alpha", status: "active", metadata: {}, createdAt: iso(0), updatedAt: iso(0) }] });
  }
  if (parsed.pathname === "/api/tasks") return Response.json({ tasks: DATA[ws]?.tasks ?? [] });
  if (parsed.pathname === "/api/kanban/boards") return Response.json({ boards: DATA[ws]?.boards ?? [] });
  return new Response("not found", { status: 404 });
}

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
}

beforeEach(() => {
  __resetKanbanOverviewCacheForTests();
  resetAttentionDismissalsForTests();
  window.localStorage.clear();
  DATA = {
    w1: {
      tasks: [
        doneCard("landed", "failed", {
          title: "Landed card", attentionResolution: resolution("landed", { ref: "abc1234" }), autoResolutionRecord: RECORD,
        }),
        card("owner", { title: "Owner card", columnId: "blocked", attentionResolution: resolution("needs_owner"), updatedAt: iso(NOW - 2 * DAY) }),
        doneCard("plain", "failed", { title: "Plain card" }),
        doneCard("ok", "completed", { title: "Reported card", completionReport: report }),
      ],
      boards: [{ ...board, workspaceId: "w1" } as KanbanBoardInfo],
    },
  };
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(respond(String(url)))));
  window.history.replaceState(null, "", "/workspace/w1/overview");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function renderReady() {
  render(<I18nProvider><InboxPageClient now={NOW} /></I18nProvider>);
  await waitFor(() => expect(screen.getByTestId("inbox-resolved")).toBeTruthy());
}

describe("inbox page: Handled by AI section (C8, AC7)", () => {
  it("shows the resolved card in the section and not in the list; needs_owner is first", async () => {
    await renderReady();
    const list = screen.getByTestId("inbox-list");
    const titles = within(list).getAllByTestId("inbox-row").map((row) => row.querySelector("h3")?.textContent);
    expect(titles).toEqual(["Owner card", "Plain card"]);
    expect(within(within(list).getAllByTestId("inbox-row")[0]).getByTestId("inbox-row-needs-owner")).toBeTruthy();

    const resolved = screen.getByTestId("inbox-resolved");
    const row = within(resolved).getByTestId("inbox-resolved-row");
    expect(row.getAttribute("data-task-id")).toBe("landed");
    expect(within(row).getByText("Landed card")).toBeTruthy();
    expect(within(row).getByText("Landed on main")).toBeTruthy();
    expect(within(row).getByTestId("inbox-resolved-conclusion").textContent).toBe("结论 landed");
    expect(within(row).getByTestId("inbox-resolved-time").textContent).toBe("1 h ago");
    expect(within(row).queryByTestId("inbox-resolved-record")).toBeNull();

    fireEvent.click(within(row).getByTestId("inbox-resolved-toggle"));
    expect(within(row).getByTestId("inbox-resolved-record").textContent).toBe(RECORD);
  });

  it("keeps the existing controls visible: hide locally, open card, scope toggle", async () => {
    await renderReady();
    const list = screen.getByTestId("inbox-list");
    expect(within(list).getAllByTestId("inbox-row-dismiss").length).toBe(2);
    expect(within(list).getAllByTestId("inbox-row-open").length).toBe(2);
    expect(screen.getByTestId("inbox-scope-all")).toBeTruthy();
    expect(screen.getByTestId("inbox-scope-workspace")).toBeTruthy();
    expect(screen.getByTestId("inbox-resolved").closest("details")).toBeNull();
  });

  it("uses the zh-CN copy when the locale is Chinese", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    await renderReady();
    const resolved = screen.getByTestId("inbox-resolved");
    expect(within(resolved).getByText("AI 已处理（1）")).toBeTruthy();
    expect(within(resolved).getByText("已进主干")).toBeTruthy();
    expect(within(resolved).getByText("查看处理记录")).toBeTruthy();
    expect(within(screen.getByTestId("inbox-list")).getByText("需要老板")).toBeTruthy();
  });

  it("the new component hardcodes no Chinese or English copy", () => {
    const source = readFileSync(path.join(__dirname, "..", "inbox-resolved-section.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "");
    const jsxText = source.match(/>\s*[^<>{}\s][^<>{}]*</gu) ?? [];
    expect(jsxText).toEqual([]);
    expect(source).not.toMatch(/[\u4e00-\u9fff]/u);
  });
});
