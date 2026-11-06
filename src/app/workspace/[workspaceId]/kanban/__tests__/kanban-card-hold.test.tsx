/**
 * Card beb29624 (AC6, C8, C16): the "暂不派 / On hold" badge of a card with
 * the hold label, in both languages; every other card element stays.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nContext } from "@/i18n/context";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import type { KanbanColumnInfo, TaskInfo } from "../../types";
import { KanbanCard } from "../kanban-card";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn(), transform: null }),
}));

const columns: KanbanColumnInfo[] = [
  { id: "todo", name: "Todo", position: 0, stage: "todo" },
  {
    id: "dev", name: "Dev", position: 1, stage: "dev",
    automation: { enabled: true, steps: [{ id: "crafter", providerId: "claude", role: "CRAFTER", specialistId: "kanban-dev-crafter" }] },
  },
  { id: "review", name: "Review", position: 2, stage: "review", automation: { enabled: false, requiredArtifacts: ["screenshot"] } },
];

const TEXT = {
  zh: { badge: "暂不派", tooltip: "带 hold 标签，Routa 不会自动派施工者；去掉标签后点重跑" },
  en: { badge: "On hold", tooltip: "Has the hold label: Routa will not auto-start an agent. Remove the label, then click Rerun." },
} as const;

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
    <I18nContext.Provider value={{ locale: lang, setLocale: () => {}, t: lang === "zh" ? zh : en }}>
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

const testIds = (root: HTMLElement) => Array.from(root.querySelectorAll("[data-testid]")).map((node) => node.getAttribute("data-testid"));

describe.each(["zh", "en"] as const)("C8 (%s): hold badge", (lang) => {
  it("a held card shows the neutral badge with icon, tooltip, place and the run button", () => {
    const { container } = renderCard(lang, ["req:a", "deploy:b", "hold"]);
    const hold = screen.getByTestId("kanban-card-hold");
    expect(hold.tagName).toBe("SPAN");
    expect(hold.getAttribute("title")).toBe(TEXT[lang].tooltip);
    const badge = hold.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe(TEXT[lang].badge);
    expect(badge.getAttribute("data-tone")).toBe("neutral");
    expect(badge.className).toContain("bg-subtle text-secondary");
    expect(badge.className).not.toMatch(/bg-red-|bg-yellow-|danger|attention|information/);
    const icon = badge.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(badge.firstElementChild).toBe(icon);

    const row = hold.parentElement!;
    const order = Array.from(row.children).map((node) => node.getAttribute("data-testid"));
    expect(order.indexOf("kanban-card-priority-size")).toBeLessThan(order.indexOf("kanban-card-hold"));
    expect(order.indexOf("kanban-card-hold")).toBeLessThan(order.indexOf("kanban-card-run"));
    expect(within(row).getByTestId("kanban-card-run")).toBeTruthy();

    // The tooltip is hover-only; the raw hold label still counts in the label row (+1).
    expect(container.textContent).not.toContain(TEXT[lang].tooltip);
    expect(container.textContent).toContain("+1");
  });

  it("C16: held and plain cards differ only by the hold badge", () => {
    const held = testIds(renderCard(lang, ["req:a", "deploy:b", "hold"]).container);
    const plain = testIds(renderCard(lang, ["req:a", "deploy:b", "x"]).container);
    expect(held.filter((id) => id !== "kanban-card-hold")).toEqual(plain);
    expect(plain).not.toContain("kanban-card-hold");
    expect(held).toContain("kanban-card-hold");
  });
});

describe("C8: dictionaries", () => {
  it("both languages carry the kanbanHold entries", () => {
    expect(zh.kanbanHold).toEqual(TEXT.zh);
    expect(en.kanbanHold).toEqual(TEXT.en);
  });
});
