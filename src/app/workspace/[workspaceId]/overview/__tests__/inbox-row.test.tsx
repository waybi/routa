import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n";
import { LOCALE_STORAGE_KEY } from "@/i18n/types";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { buildWorkspaceInbox, type InboxRow } from "../inbox-rules";
import { INBOX_SOURCE_MAX_CHARS, InboxRowItem } from "../inbox-row";
import { NOW, interruptedCard, makeBoard } from "./inbox-fixtures";

const WS = { id: "w1", title: "Workspace One" };
const none = () => [] as const;

function rowFor(task: TaskInfo, boards: KanbanBoardInfo[] = [makeBoard("b1", true)]): InboxRow {
  const [row] = buildWorkspaceInbox(WS, [task], boards, NOW, none).active;
  return row;
}

function renderRow(row: InboxRow) {
  return render(
    <I18nProvider>
      <InboxRowItem row={row} now={NOW} dismissed={false} showWorkspace onToggleDismiss={vi.fn()} />
    </I18nProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe("interrupted row copy (en)", () => {
  it.each([
    ["failed", "Dev run interrupted: failed"],
    ["timed_out", "Dev run interrupted: timed out"],
  ] as const)("reason for a %s run names the lane and the status", (status, text) => {
    renderRow(rowFor(interruptedCard("i", "dev", status, { title: "Card I" })));
    const row = screen.getByTestId("inbox-row");
    expect(row.getAttribute("data-reason")).toBe("interrupted");
    expect(within(row).getByTestId("inbox-row-reason").textContent).toBe(`Reason${text}`);
    expect(row.textContent).not.toContain("reason not recorded");
    expect(within(row).getByText("Interrupted")).toBeTruthy();
    expect(within(row).getByText("P1 · Failed")).toBeTruthy();
    expect(within(row).getByTestId("inbox-row-next").textContent).toContain("Check the cause, then rerun");
    expect(within(row).getByTestId("inbox-row-open").getAttribute("href")).toBe("/workspace/w1/kanban?boardId=b1&taskId=i");
    expect(row.textContent).toContain("Workspace One");
  });

  it("truncates a long lastSyncError and keeps the full text in the title", () => {
    const error = `usage_limit_reached ${"x".repeat(300)}`;
    renderRow(rowFor(interruptedCard("i", "dev", "failed", { lastSyncError: error })));
    const source = screen.getByTestId("inbox-row-source").querySelector("dd")!;
    expect(source.getAttribute("title")).toBe(error);
    expect(source.textContent).toBe(`${error.slice(0, INBOX_SOURCE_MAX_CHARS)}…`);
  });

  it.each([["empty", "   "], ["missing", undefined]])("says the card recorded no error when lastSyncError is %s", (_name, lastSyncError) => {
    renderRow(rowFor(interruptedCard("i", "dev", "failed", { lastSyncError })));
    const source = screen.getByTestId("inbox-row-source").querySelector("dd")!;
    expect(source.textContent).toBe("The card recorded no error");
    expect(source.getAttribute("title")).toBe("The card recorded no error");
  });

  it("lane name falls back to the run's columnName, then the column id", () => {
    const view = renderRow(rowFor(interruptedCard("i", "review", "failed", {}, { columnName: "Code review" })));
    expect(screen.getByTestId("inbox-row-reason").textContent).toContain("Code review run interrupted");
    view.unmount();
    renderRow(rowFor(interruptedCard("j", "review", "failed")));
    expect(screen.getByTestId("inbox-row-reason").textContent).toContain("review run interrupted");
  });
});

describe("interrupted row copy (zh)", () => {
  it("renders the Chinese reason, badge, source fallback and next step", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    renderRow(rowFor(interruptedCard("i", "dev", "timed_out")));
    const row = screen.getByTestId("inbox-row");
    expect(within(row).getByTestId("inbox-row-reason").textContent).toBe("原因Dev 施工中断：超时");
    expect(within(row).getByText("已中断")).toBeTruthy();
    expect(within(row).getByTestId("inbox-row-source").textContent).toContain("卡片没有记录错误");
    expect(within(row).getByTestId("inbox-row-next").textContent).toContain("确认原因后重新运行，可勾选批量重新运行");
  });
});
