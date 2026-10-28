/**
 * Card 4877583c, row level: handler / handling / "Hand to AI" are rendered
 * directly in every row, the reason falls back to the newest plain comment,
 * and the existing fields stay where they were (C2, C3, C6, design checks).
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import { buttonClassName } from "@/client/components/ui/button";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { buildWorkspaceInbox, inboxRowView, type InboxRow } from "../inbox-rules";
import { INBOX_SOURCE_MAX_CHARS, InboxRowItem, type InboxRowHandOff } from "../inbox-row";
import { HOUR, NOW, card, iso } from "./inbox-fixtures";
import { RECORD_BODY, blockedCard, blockedRun, comment, resolution, resolverBoard } from "./handler-fixtures";

const WS = { id: "w1", title: "Workspace One" };

/**
 * Resolved categories (landed / superseded / handed_off / waiting) take a
 * card out of the list, so the row is built without the resolution and the
 * resolution is put back on the row's card afterwards.
 */
function rowFor(task: TaskInfo, board: KanbanBoardInfo): InboxRow {
  const { attentionResolution, ...rest } = task;
  const listed = attentionResolution?.category === "needs_owner" ? task : (rest as TaskInfo);
  const [row] = buildWorkspaceInbox(WS, [listed], [board], NOW, () => []).active;
  return attentionResolution ? { ...row, task: { ...row.task, attentionResolution } } : row;
}

function renderRow(task: TaskInfo, board: KanbanBoardInfo = resolverBoard(), handOff?: InboxRowHandOff) {
  const row = rowFor(task, board);
  render(
    <I18nProvider>
      <InboxRowItem row={row} now={NOW} dismissed={false} showWorkspace onToggleDismiss={vi.fn()} view={inboxRowView(row, board)} handOff={handOff} />
    </I18nProvider>,
  );
  return screen.getByTestId("inbox-row");
}

function dd(testId: string): HTMLElement {
  return screen.getByTestId(testId).querySelector("dd")!;
}

/** The reason text the row shows: the headline of a parsed comment, else the plain cell. */
function reasonShown(): string {
  return screen.queryByTestId("inbox-row-reason-why")?.firstChild?.textContent ?? dd("inbox-row-reason").textContent ?? "";
}

afterEach(() => {
  window.localStorage.clear();
});

describe("reason fallback from comments (C3, AC3)", () => {
  const at = (second: number) => iso(Date.UTC(2026, 9, 27, 6, 53, second));
  it.each<[string, Partial<TaskInfo>, string, string | null]>([
    ["has lastSyncError", { lastSyncError: "push rejected", comments: [comment("p", "评论", at(0))] }, "Blocked: push rejected", null],
    ["only a plain comment", { comments: [comment("p", "推送冲突\n\n详情", at(0))] }, "推送冲突", "推送冲突\n\n详情"],
    ["plain later than the record", { comments: [comment("p", "后写的普通评论", at(39)), comment("r", RECORD_BODY, at(1))] }, "后写的普通评论", "后写的普通评论"],
    ["plain earlier than the record", { comments: [comment("r", RECORD_BODY, at(40)), comment("p", "先写的普通评论", at(0))] }, "先写的普通评论", "先写的普通评论"],
    ["only a record", { comments: [comment("r", RECORD_BODY, at(0))] }, "Blocked, reason not recorded", null],
    ["no comments", {}, "Blocked, reason not recorded", null],
  ])("%s", (_name, overrides, text, title) => {
    renderRow(blockedCard("a", { attentionResolution: undefined, ...overrides }));
    expect(reasonShown()).toBe(text);
    expect(dd("inbox-row-reason").getAttribute("title")).toBe(title);
  });

  it("d5549adc shape: shows the 06:53:39 report, not the array's last comment", () => {
    const raw = "主干推送中止：`git rebase origin/main` 冲突，已 `git rebase --abort`，未推送。";
    const report = raw.replaceAll("`", "");
    renderRow(blockedCard("d5549adc", {
      comments: [comment("report", `${raw}\n\n冲突文件…`, at(39)), comment("record", RECORD_BODY, at(1)), comment("old", "旧评论", iso(Date.UTC(2026, 9, 27, 6)))],
    }));
    expect(reasonShown()).toBe(report);
    expect(dd("inbox-row-reason").getAttribute("title")).toBe(`${raw}\n\n冲突文件…`);
  });

  it("truncates a 200-char first paragraph to 160 + … and keeps the whole comment in the title", () => {
    const body = `${"原".repeat(200)}\n\n第二段`;
    renderRow(blockedCard("a", { comments: [comment("p", body, at(0))] }));
    expect(reasonShown()).toBe(`${"原".repeat(INBOX_SOURCE_MAX_CHARS)}…`);
    expect(dd("inbox-row-reason").getAttribute("title")).toBe(body);
  });

  it("keeps the reason row's classes (C30)", () => {
    renderRow(blockedCard("a", { comments: [comment("p", "评论", at(0))] }));
    const fallback = [screen.getByTestId("inbox-row-reason").className, dd("inbox-row-reason").className];
    cleanup();
    renderRow(blockedCard("b", { lastSyncError: "x" }));
    expect([screen.getByTestId("inbox-row-reason").className, dd("inbox-row-reason").className]).toEqual(fallback);
  });
});

describe("handler (C1 rendered, C22)", () => {
  it.each<[string, TaskInfo, KanbanBoardInfo, string, string]>([
    ["owner: board without resolver", blockedCard("a"), resolverBoard({ enabled: false } as never), "owner", "You"],
    ["aiRunning", blockedCard("a", { laneSessions: [blockedRun(NOW - HOUR, "running")] }), resolverBoard(), "aiRunning", "AI resolver · working"],
    ["aiQueued", blockedCard("a"), resolverBoard(), "aiQueued", "AI resolver · queued"],
  ])("%s", (_name, task, board, handler, text) => {
    renderRow(task, board);
    const value = dd("inbox-row-handler").querySelector("[data-handler]")!;
    expect(value.getAttribute("data-handler")).toBe(handler);
    expect(value.textContent).toBe(text);
  });

  it("uses the same meta classes and dl as the reason row (C20) and the design order (C21)", () => {
    const row = renderRow(blockedCard("a"));
    const handler = screen.getByTestId("inbox-row-handler");
    expect(handler.className).toBe(screen.getByTestId("inbox-row-reason").className);
    expect(handler.parentElement).toBe(screen.getByTestId("inbox-row-reason").parentElement);
    const labels = [...row.querySelectorAll("dl > div > dt")].map((node) => node.textContent);
    expect(labels).toEqual(["Workspace", "Handled by", "Handling", "Reason", "Source", "Happened", "Next step"]);
  });

  it("needs_owner: handler badge is attention, the only danger badge is the top one (C43)", () => {
    const row = renderRow(blockedCard("a", { attentionResolution: resolution("needs_owner") }));
    expect(dd("inbox-row-handler").querySelector("[data-handler]")!.getAttribute("data-handler")).toBe("owner");
    expect(within(row).getByTestId("inbox-row-needs-owner").textContent).toBe("Needs owner");
    expect(dd("inbox-row-handling").textContent).toContain("conclusion needs_owner");
  });
});

describe("handling (C2, AC2)", () => {
  const EN = { landed: "Landed on main", superseded: "Superseded", handed_off: "Handed off to a patch card", waiting: "Waiting for the fix card" };
  const ZH = { landed: "已进主干", superseded: "被取代", handed_off: "已转交补丁卡", waiting: "等待修复卡" };
  it.each(Object.entries(EN))("en %s: category + conclusion + ref", (category, label) => {
    renderRow(blockedCard("a", { attentionResolution: resolution(category, { conclusion: "原文结论 verbatim" }) }));
    expect(dd("inbox-row-handling").textContent).toBe(`${label}原文结论 verbatimRelated: abc1234`);
  });

  it.each(Object.entries(ZH))("zh %s: category + conclusion + ref", (category, label) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    renderRow(blockedCard("a", { attentionResolution: resolution(category, { conclusion: "原文结论" }) }));
    expect(dd("inbox-row-handling").textContent).toBe(`${label}原文结论相关：abc1234`);
  });

  it("zh needs_owner: the row shows 需要老板 once, handling shows the conclusion", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    const row = renderRow(blockedCard("a", { attentionResolution: resolution("needs_owner", { conclusion: "请老板拍板" }) }));
    expect(within(row).getByText("需要老板")).toBeTruthy();
    expect(dd("inbox-row-handling").textContent).toBe("请老板拍板相关：abc1234");
    expect(dd("inbox-row-handler").textContent).toBe("你");
  });

  it("no ref → no 'Related:'", () => {
    renderRow(blockedCard("a", { attentionResolution: resolution("waiting", { ref: "" }) }));
    expect(dd("inbox-row-handling").textContent).toBe("Waiting for the fix cardconclusion waiting");
  });

  it("long conclusion is truncated with the full text in the title (C23)", () => {
    const conclusion = "c".repeat(200);
    renderRow(blockedCard("a", { attentionResolution: resolution("waiting", { conclusion }) }));
    const span = dd("inbox-row-handling").querySelector(`[title="${conclusion}"]`)!;
    expect(span.textContent).toBe(`${"c".repeat(INBOX_SOURCE_MAX_CHARS)}…`);
  });

  it.each<[string, Partial<TaskInfo>]>([
    ["no resolution", {}],
    ["unknown category", { attentionResolution: resolution("rolled_back") }],
  ])("%s → the row's next step, no badge (C25)", (_name, overrides) => {
    renderRow(blockedCard("a", overrides));
    expect(dd("inbox-row-handling").textContent).toBe(dd("inbox-row-next").textContent);
    expect(dd("inbox-row-handling").querySelector("span")).toBeNull();
  });

  it("not in effect (left Blocked) → next step", () => {
    renderRow(card("a", { status: "PENDING", columnId: "review", attentionResolution: resolution("handed_off"), laneSessions: [blockedRun(NOW - 2 * HOUR, "failed", "review")], triggerSessionId: `review-${NOW - 2 * HOUR}` }));
    expect(dd("inbox-row-handling").textContent).toBe(dd("inbox-row-next").textContent);
  });
});

describe("Hand to AI button (AC4 row level, C26–C28)", () => {
  const handOff = (): InboxRowHandOff => ({ disabled: false, state: undefined, onHandOff: vi.fn() });
  it.each<[string, TaskInfo, KanbanBoardInfo, string]>([
    ["not in Blocked", card("a", { status: "PENDING", columnId: "review", laneSessions: [blockedRun(NOW - HOUR, "failed", "review")], triggerSessionId: `review-${NOW - HOUR}` }), resolverBoard(), "The card is not in Blocked; the resolver only handles Blocked cards"],
    ["no resolver", blockedCard("a"), resolverBoard({ enabled: false } as never), "This board's Blocked lane has no Blocked Resolver; turn on Automation for it in board settings"],
    ["resolver running", blockedCard("a", { laneSessions: [blockedRun(NOW - HOUR, "running")] }), resolverBoard(), "The Blocked Resolver is already working on this card"],
  ])("disabled when %s, with a hover reason", (_name, task, board, title) => {
    const controls = handOff();
    renderRow(task, board, controls);
    const button = screen.getByTestId("inbox-row-hand-off") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe(title);
    fireEvent.click(button);
    expect(controls.onHandOff).not.toHaveBeenCalled();
  });

  it("clickable in Blocked with an idle resolver; secondary sm, text only, between rerun and open (C26, C27)", () => {
    const controls = handOff();
    const row = renderRow(blockedCard("a"), resolverBoard(), controls);
    const button = screen.getByTestId("inbox-row-hand-off") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.type).toBe("button");
    expect(button.className).toBe(buttonClassName("secondary", "sm"));
    expect(button.querySelector("svg")).toBeNull();
    expect(button.textContent).toBe("Hand to AI");
    const actions = [...button.parentElement!.children].map((node) => node.getAttribute("data-testid"));
    expect(actions).toEqual(["inbox-row-hand-off", "inbox-row-open", "inbox-row-dismiss"]);
    fireEvent.click(button);
    expect(controls.onHandOff).toHaveBeenCalledTimes(1);
    expect(row.querySelector("details")).toBeNull();
  });

  it("renders (disabled) even without controls", () => {
    renderRow(blockedCard("a"));
    expect((screen.getByTestId("inbox-row-hand-off") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("zh copy (C9 counterpart)", () => {
  it("renders labels, handler and button in Chinese", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    renderRow(blockedCard("a", { laneSessions: [blockedRun(NOW - HOUR, "running")] }));
    expect(screen.getByTestId("inbox-row-handler").querySelector("dt")!.textContent).toBe("处理人");
    expect(screen.getByTestId("inbox-row-handling").querySelector("dt")!.textContent).toBe("处理方式");
    expect(dd("inbox-row-handler").textContent).toBe("AI 处理员 · 处理中");
    expect(screen.getByTestId("inbox-row-hand-off").textContent).toBe("交给 AI 处理");
    expect(screen.getByTestId("inbox-row-hand-off").getAttribute("title")).toBe("阻塞处理员正在处理这张卡");
  });
});
