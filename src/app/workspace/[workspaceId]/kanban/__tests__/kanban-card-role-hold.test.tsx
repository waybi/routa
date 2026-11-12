/**
 * Card a00fb67b (L400; C7, C8): the role hold badge. Only "hold:<role>"
 * labels show "暂停：<roles>"; the whole-card hold keeps its own badge and a
 * card shows at most one hold badge.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nContext } from "@/i18n/context";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import type { KanbanColumnInfo, TaskInfo } from "../../types";
import { KanbanCard } from "../kanban-card";
import { formatHoldBadge } from "../kanban-hold-badge";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn(), transform: null }),
}));

const DICT = { zh, en } as const;

describe.each(["zh", "en"] as const)("C7 (%s): formatHoldBadge", (lang) => {
  const t = DICT[lang];
  const sep = lang === "zh" ? "、" : ", ";

  it("only hold → the original badge text", () => {
    expect(formatHoldBadge({ labels: ["hold"] }, t)).toEqual({ kind: "card", text: t.kanbanHold.badge, tooltip: t.kanbanHold.tooltip });
  });

  it("only hold:kanban-main-pusher → the role name in text and tooltip", () => {
    const badge = formatHoldBadge({ labels: ["hold:kanban-main-pusher"] }, t);
    expect(badge?.kind).toBe("role");
    expect(badge?.text).toBe(lang === "zh" ? "暂停：kanban-main-pusher" : "Paused: kanban-main-pusher");
    expect(badge?.tooltip).toContain("kanban-main-pusher");
    expect(badge?.tooltip).toContain(lang === "zh" ? "其他岗位照常" : "other roles run as usual");
  });

  it(`two roles → joined by "${sep}"`, () => {
    const badge = formatHoldBadge({ labels: ["hold:kanban-main-pusher", "hold:kanban-done-reporter"] }, t);
    expect(badge?.text).toContain(`kanban-main-pusher${sep}kanban-done-reporter`);
  });

  it("hold + hold:x → only the original badge", () => {
    expect(formatHoldBadge({ labels: ["hold:x", "hold"] }, t)?.kind).toBe("card");
  });

  it("no hold labels (or an empty role) → no badge", () => {
    expect(formatHoldBadge({ labels: ["hold:", "req:x"] }, t)).toBeNull();
    expect(formatHoldBadge({ labels: null }, t)).toBeNull();
  });
});

const columns: KanbanColumnInfo[] = [
  { id: "todo", name: "Todo", position: 0, stage: "todo" },
  {
    id: "dev", name: "Dev", position: 1, stage: "dev",
    automation: { enabled: true, steps: [{ id: "crafter", providerId: "claude", role: "CRAFTER", specialistId: "kanban-dev-crafter" }] },
  },
];

function task(labels: string[]): TaskInfo {
  return {
    id: "task-1", title: "追踪项", objective: "只追踪", status: "IN_PROGRESS", boardId: "board-1", columnId: "dev",
    position: 0, priority: "high", labels, createdAt: "2025-01-01T00:00:00.000Z",
    lastSyncError: "attention:blocked 旧原因",
    artifactSummary: { total: 1, byType: { logs: 1 } },
  } as TaskInfo;
}

function renderCard(lang: "zh" | "en", labels: string[]) {
  return render(
    <I18nContext.Provider value={{ locale: lang, setLocale: () => {}, t: DICT[lang] }}>
      <KanbanCard
        task={task(labels)}
        boardColumns={columns}
        specialistLanguage={lang === "zh" ? "zh-CN" : "en"}
        availableProviders={[]}
        specialists={[]}
        codebases={[]}
        allCodebaseIds={[]}
        worktreeCache={{}}
        onOpenDetail={vi.fn()}
        onDelete={vi.fn()}
        onPatchTask={vi.fn()}
        onRetryTrigger={vi.fn()}
        onRefresh={vi.fn()}
      />
    </I18nContext.Provider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe.each(["zh", "en"] as const)("C8 (%s): role hold badge on the card", (lang) => {
  it("only hold:kanban-main-pusher: neutral badge with icon, tooltip, placed after priority and before run; no fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderCard(lang, ["req:a", "hold:kanban-main-pusher"]);
    expect(screen.queryByTestId("kanban-card-hold")).toBeNull();
    const hold = screen.getByTestId("kanban-card-role-hold");
    expect(hold.tagName).toBe("SPAN");
    expect(hold.getAttribute("title")).toContain("kanban-main-pusher");
    const badge = hold.firstElementChild as HTMLElement;
    expect(badge.getAttribute("data-tone")).toBe("neutral");
    expect(badge.className).toContain("[overflow-wrap:anywhere]");
    expect(badge.className).not.toMatch(/bg-red-|bg-yellow-|danger|attention|information|success/);
    expect(badge.textContent).toContain("kanban-main-pusher");
    const icon = badge.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(badge.firstElementChild).toBe(icon);
    expect(hold.querySelector("button, input, select")).toBeNull();

    const order = Array.from(hold.parentElement!.children).map((node) => node.getAttribute("data-testid"));
    expect(order.indexOf("kanban-card-priority-size")).toBeLessThan(order.indexOf("kanban-card-role-hold"));
    expect(order.indexOf("kanban-card-role-hold")).toBeLessThan(order.indexOf("kanban-card-run"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([[["hold"]], [["hold", "hold:x"]]])("labels %j: only the original hold badge", (labels) => {
    renderCard(lang, labels);
    expect(screen.getByTestId("kanban-card-hold").getAttribute("title")).toBe(DICT[lang].kanbanHold.tooltip);
    expect(screen.queryByTestId("kanban-card-role-hold")).toBeNull();
  });
});
